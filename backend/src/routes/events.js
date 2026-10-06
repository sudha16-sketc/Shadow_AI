/**
 * Shadow AI Auditor — Events Routes
 * POST /api/events       — single event from an authenticated user or device
 * POST /api/events/batch — batch events from an authenticated user or device
 * GET  /api/events       — dashboard (auth required)
 */
import { Router } from 'express';
import { z } from 'zod';
import { Event, EventReplay, User, Org, AuditLog } from '../models/index.js';
import { authMiddleware, requireDeviceAuth, requireUserAuth } from '../middleware/auth.js';
import { sendSlackAlert, sendEmailAlert } from '../services/alerting.js';
import { recalcSecurityScore } from '../services/scoring.js';
import { evaluatePolicy } from '../services/policy-engine.js';
import { createEventFingerprint, EVENT_REPLAY_WINDOW_MS } from '../utils/event-replay.js';
import { clampPagination } from '../utils/pagination.js';
import { broadcastTenantAlert } from '../services/websocket.js';
import logger from '../utils/logger.js';

const router = Router();

const EventSchema = z.object({
  idempotencyKey: z.string().min(16).max(128),
  domain: z.string().trim().toLowerCase().min(1).max(253).regex(/^[a-z0-9.-]+$/),
  eventType: z.enum(['paste', 'typing', 'modal_cancel', 'modal_proceed']),
  riskScore: z.number().min(0).max(100),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']), // Added CRITICAL for client telemetry if they send it
  maskedPreview: z.string().max(200).optional(),
  findingLabels: z.array(z.string().max(60)).max(20).optional(),
  timestamp: z.string().datetime().refine(value => {
    const age = Date.now() - Date.parse(value);
    return age <= 10 * 60_000 && age >= -60_000;
  }, 'timestamp outside accepted window'),
}).strict();

export function resolveAuthenticatedEventContext(req) {
  if (req.user?.authType !== 'device' || !req.user.deviceId) {
    throw Object.assign(new Error('Registered device authentication required'), { status: 403 });
  }
  return {
    orgId: req.user.orgId,
    userId: req.user.userId,
    deviceId: req.user.deviceId,
  };
}

router.post('/', authMiddleware, requireDeviceAuth, async (req, res) => {
  try {
    const context = resolveAuthenticatedEventContext(req);
    const data = EventSchema.parse(req.body);
    const result = await ingestEvent(data, context, req);
    return res.status(202).json({ ok: true, requestPrevented: false, ...result });
  } catch (err) {
    if (err?.status === 401) return res.status(401).json({ error: err.message });
    if (err?.status === 403) return res.status(403).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Validation error' });
    if (err?.code === 11000) return res.status(202).json({ ok: true, duplicate: true });
    logger.error('Event POST error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/batch', authMiddleware, requireDeviceAuth, async (req, res) => {
  try {
    const context = resolveAuthenticatedEventContext(req);
    const events = req.body?.events;
    if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be array' });
    if (events.length > 200) return res.status(400).json({ error: 'batch too large' });

    const parsedEvents = events.map(payload => EventSchema.parse(payload));
    const results = await Promise.allSettled(parsedEvents.map(data => ingestEvent(data, context, req)));
    const saved = results.filter(result => result.status === 'fulfilled' && !result.value.duplicate).length;
    const duplicates = results.filter(result => result.status === 'fulfilled' && result.value.duplicate).length;
    return res.status(202).json({ ok: true, requestPrevented: false, saved, duplicates, rejected: results.length - saved - duplicates });
  } catch (err) {
    if (err?.status === 401) return res.status(401).json({ error: err.message });
    if (err?.status === 403) return res.status(403).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Validation error' });
    logger.error('Event batch POST error', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/', authMiddleware, requireUserAuth, async (req, res) => {
  const { severity, domain, from, to } = req.query;
  const { page, limit, skip } = clampPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const filter = { orgId: req.user.orgId };

  if (severity) filter.severity = String(severity).toUpperCase();
  if (domain) filter.domain = String(domain).slice(0, 253);
  if (from || to) {
    filter.timestamp = {};
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (fromDate && !Number.isNaN(fromDate.getTime())) filter.timestamp.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) filter.timestamp.$lte = toDate;
    if (Object.keys(filter.timestamp).length === 0) delete filter.timestamp;
  }

  const [events, total] = await Promise.all([
    Event.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userRef', 'name email department'),
    Event.countDocuments(filter),
  ]);

  res.json({ events, total, page, limit });
});

router.get('/stats', authMiddleware, requireUserAuth, async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const filter = { orgId: req.user.orgId };

  const [bySeverity, byDomain, recentCount, totalCount] = await Promise.all([
    Event.aggregate([
      { $match: { ...filter, timestamp: { $gte: since } } },
      { $group: { _id: '$severity', count: { $sum: 1 }, avgScore: { $avg: '$riskScore' } } },
    ]),
    Event.aggregate([
      { $match: { ...filter, timestamp: { $gte: since } } },
      { $group: { _id: '$domain', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Event.countDocuments({ ...filter, timestamp: { $gte: since } }),
    Event.countDocuments(filter),
  ]);

  res.json({ bySeverity, byDomain, recentCount, totalCount });
});

export async function ingestEvent(data, context, req) {
  const keyFilter = { orgId: context.orgId, deviceId: context.deviceId, idempotencyKey: data.idempotencyKey };
  if (await Event.findOne(keyFilter)) return { duplicate: true };

  const now = new Date();
  const fingerprint = createEventFingerprint(context, data);
  const replayFilter = { orgId: context.orgId, deviceId: context.deviceId, fingerprint };
  await EventReplay.deleteOne({ ...replayFilter, expiresAt: { $lte: now } });
  if (await EventReplay.findOne({ ...replayFilter, expiresAt: { $gt: now } })) return { duplicate: true };

  const replayRecord = { ...replayFilter, expiresAt: new Date(now.getTime() + EVENT_REPLAY_WINDOW_MS) };
  try {
    await EventReplay.create(replayRecord);
  } catch (err) {
    if (err?.code === 11000) return { duplicate: true };
    throw err;
  }

  try {
    const event = await processEvent(data, context, req);
    return { duplicate: false, eventId: event?._id };
  } catch (err) {
    if (err?.code === 11000) return { duplicate: true };
    throw err;
  }
}

export async function processEvent(data, context, req) {
  const org = await Org.findOne({ _id: context.orgId, lifecycleStatus: 'active' });
  if (!org) {
    throw Object.assign(new Error('Organization not found'), { status: 403 });
  }

  const userRef = await User.findOne({ _id: context.userId, orgId: context.orgId, isActive: true });
  if (!userRef || userRef.optedOut) {
    throw Object.assign(new Error('Active event owner required'), { status: 403 });
  }

  const findingLabels = data.findingLabels ?? [];
  const decision = await evaluatePolicy({
    orgId: context.orgId,
    userRef,
    findingLabels,
    orgSettings: org.settings
  });

  const receivedAt = new Date();
  const clientTelemetry = {
    riskScore: data.riskScore,
    severity: data.severity,
    findingLabels: findingLabels,
    maskedPreview: data.maskedPreview ?? '',
    clientTimestamp: data.timestamp,
  };

  const event = await Event.create({
    orgId: context.orgId,
    deviceId: context.deviceId,
    userId: String(userRef.extensionUserId ?? userRef._id),
    userRef: userRef._id,
    idempotencyKey: data.idempotencyKey,
    clientTelemetry,
    domain: data.domain,
    eventType: data.eventType,
    // Server-derived values override client claims for the top-level schema
    riskScore: decision.riskScore,
    severity: decision.severity,
    findingLabels: findingLabels,
    maskedPreview: clientTelemetry.maskedPreview,
    policyDecision: decision.decision,
    policyReason: decision.reason,
    policyVersion: decision.policyVersion ?? 0,
    timestamp: receivedAt,
  });

  await AuditLog.create({
    orgId: context.orgId,
    action: 'event_policy_decision',
    actor: userRef._id,
    target: event._id.toString(),
    changes: {
      decision: decision.decision,
      reason: decision.reason,
      policyVersion: decision.policyVersion,
      clientReportedSeverity: clientTelemetry.severity,
      serverCalculatedSeverity: decision.severity,
    },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  if ((decision.severity === 'HIGH' || decision.severity === 'CRITICAL') && !event.alerted) {
    try {
      await Promise.all([sendSlackAlert(event), sendEmailAlert(event)]);
      await Event.findOneAndUpdate({ _id: event._id, orgId: context.orgId }, { $set: { alerted: true } });
    } catch (err) {
      logger.warn('Alert send failed', err.message);
    }

    broadcastTenantAlert(event.toObject());
  }

  recalcSecurityScore(context.orgId).catch(() => {});
  return event;
}

export default router;
