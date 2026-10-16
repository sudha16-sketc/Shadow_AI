// backend/src/routes/platform-monitoring.js
/**
 * Platform-wide monitoring API (super administrators and platform managers).
 *
 * Every endpoint requires a valid platform credential (see
 * platformAdminAuthMiddleware). Nothing here is tenant-scoped by client input:
 * results always span the whole platform and can only be reached by a platform
 * identity. Responses contain masked previews and detection metadata only —
 * never raw prompt content, password hashes, or tokens.
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import {
  Org, User, Device, Event, AuditLog, PlatformAuditLog, PlatformAdmin, AuthEvent,
} from '../models/index.js';
import { platformAdminAuthMiddleware } from '../middleware/auth.js';
import { getRecentErrors } from '../services/metrics.js';

const router = Router();

const SAMPLE_CAP = 2000;          // bounded scan for in-process aggregation
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const ORG_METRIC_CAP = 100;

const APPLICATION_BY_DOMAIN = {
  'chat.openai.com': 'ChatGPT',
  'chatgpt.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'bard.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'perplexity.ai': 'Perplexity',
  'poe.com': 'Poe',
  'character.ai': 'Character.AI',
};

function applicationFor(domain) {
  return APPLICATION_BY_DOMAIN[domain] ?? domain ?? 'unknown';
}

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function parseWindow(query) {
  const now = new Date();
  if (query.from || query.to) {
    const from = query.from ? new Date(query.from) : new Date(now.getTime() - 7 * 86400000);
    const to = query.to ? new Date(query.to) : now;
    return {
      from: Number.isNaN(from.getTime()) ? new Date(now.getTime() - 7 * 86400000) : from,
      to: Number.isNaN(to.getTime()) ? now : to,
    };
  }
  const days = clampInt(query.days, 7, 1, 90);
  return { from: new Date(now.getTime() - days * 86400000), to: now };
}

function isValidId(value) {
  return mongoose.Types.ObjectId.isValid(value) || /^[a-z]+-[0-9a-f-]{8,}$/i.test(String(value ?? ''));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Authorized, redacted view of an event. Never includes raw content.
function sanitizeEvent(event) {
  if (!event) return null;
  return {
    id: event._id,
    orgId: event.orgId ?? null,
    tenantName: event.tenantName ?? null,
    userId: event.userId ?? null,
    deviceId: event.deviceId ?? null,
    domain: event.domain ?? null,
    application: applicationFor(event.domain),
    eventType: event.eventType ?? null,
    severity: event.severity ?? null,
    riskScore: event.riskScore ?? null,
    policyDecision: event.policyDecision ?? null,
    policyReason: event.policyReason ?? null,
    enforcementStatus: event.enforcementStatus ?? 'NOT_ATTEMPTED',
    requestForwarded: Boolean(event.requestForwarded),
    upstreamStatus: event.upstreamStatus ?? null,
    sanitizedRedactions: event.sanitizedRedactions ?? 0,
    findingLabels: Array.isArray(event.findingLabels) ? event.findingLabels.slice(0, 30) : [],
    responseFindingLabels: Array.isArray(event.responseFindingLabels) ? event.responseFindingLabels.slice(0, 30) : [],
    // Masked preview only — the raw prompt is never stored.
    maskedPreview: typeof event.maskedPreview === 'string' ? event.maskedPreview.slice(0, 200) : null,
    alerted: Boolean(event.alerted),
    investigation: {
      status: event.investigation?.status ?? 'open',
      note: event.investigation?.note ?? '',
      updatedBy: event.investigation?.updatedBy ?? null,
      updatedAt: event.investigation?.updatedAt ?? null,
    },
    timestamp: event.timestamp ?? null,
  };
}

router.use(platformAdminAuthMiddleware);

// ─── Overview ────────────────────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  const { from, to } = parseWindow(req.query);
  try {
    const [
      totalTenants, activeTenants, suspendedTenants, pendingTenants,
      totalUsers, activeUsers, activeDevices,
      totalPlatformAdmins, activeManagers,
      events, authFailures, authSuccesses, recentAuthFailures,
    ] = await Promise.all([
      Org.countDocuments({}),
      Org.countDocuments({ lifecycleStatus: 'active' }),
      Org.countDocuments({ lifecycleStatus: 'suspended' }),
      Org.countDocuments({ lifecycleStatus: 'pending_admin' }),
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      Device.countDocuments({ isActive: true, revokedAt: null }),
      PlatformAdmin.countDocuments({}),
      PlatformAdmin.countDocuments({ role: 'manager', isActive: true }),
      Event.find({ timestamp: { $gte: from, $lte: to } }).sort({ timestamp: -1 }).limit(SAMPLE_CAP).lean(),
      AuthEvent.countDocuments({ outcome: 'failure', at: { $gte: from, $lte: to } }),
      AuthEvent.countDocuments({ outcome: 'success', at: { $gte: from, $lte: to } }),
      AuthEvent.find({ outcome: 'failure' }).sort({ at: -1 }).limit(10).lean(),
    ]);

    const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    const byDecision = { ALLOW: 0, WARN: 0, SANITIZE: 0, BLOCK: 0 };
    const byCategory = {};
    const byApplication = {};
    const timeline = {};
    let highRisk = 0;
    let prevented = 0;
    let sanitized = 0;

    for (const event of events) {
      if (bySeverity[event.severity] !== undefined) bySeverity[event.severity] += 1;
      if (byDecision[event.policyDecision] !== undefined) byDecision[event.policyDecision] += 1;
      if (event.severity === 'HIGH' || event.severity === 'CRITICAL') highRisk += 1;
      if (event.policyDecision === 'BLOCK' || event.enforcementStatus === 'PREVENTED') prevented += 1;
      if (event.policyDecision === 'SANITIZE' || event.enforcementStatus === 'SANITIZED') sanitized += 1;
      for (const label of event.findingLabels ?? []) {
        byCategory[label] = (byCategory[label] ?? 0) + 1;
      }
      const app = applicationFor(event.domain);
      byApplication[app] = (byApplication[app] ?? 0) + 1;
      const day = event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : 'unknown';
      timeline[day] = (timeline[day] ?? 0) + 1;
    }

    const recentIncidents = events
      .filter(event => event.severity === 'HIGH' || event.severity === 'CRITICAL')
      .slice(0, 10)
      .map(sanitizeEvent);

    const mongooseState = mongoose.connection.readyState;
    const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongooseState] ?? 'unknown';

    return res.json({
      window: { from: from.toISOString(), to: to.toISOString() },
      tenants: {
        total: totalTenants,
        active: activeTenants,
        suspended: suspendedTenants,
        pending: pendingTenants,
      },
      users: { total: totalUsers, active: activeUsers },
      devices: { active: activeDevices },
      platform: { totalAdmins: totalPlatformAdmins, activeManagers },
      events: {
        total: events.length,
        highRisk,
        prevented,
        sanitized,
        bySeverity,
        byDecision,
        byCategory,
        byApplication,
        timeline,
      },
      authentication: {
        failures: authFailures,
        successes: authSuccesses,
        recentFailures: recentAuthFailures.map(entry => ({
          at: entry.at,
          scope: entry.scope,
          emailMasked: entry.emailMasked,
          reason: entry.reason ?? null,
        })),
      },
      recentIncidents,
      health: {
        database: dbState,
        uptimeSeconds: Math.round(process.uptime()),
        recentErrorCount: getRecentErrors().length,
      },
    });
  } catch {
    return res.status(500).json({ error: 'Monitoring overview failed' });
  }
});

// ─── Event explorer ──────────────────────────────────────────────────────────
router.get('/events', async (req, res) => {
  const page = clampInt(req.query.page, 1, 1, 100000);
  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const { from, to } = parseWindow(req.query);

  const filter = { timestamp: { $gte: from, $lte: to } };
  if (req.query.orgId) filter.orgId = req.query.orgId;
  if (req.query.severity) filter.severity = req.query.severity;
  if (req.query.decision) filter.policyDecision = req.query.decision;
  if (req.query.domain) filter.domain = req.query.domain;
  if (req.query.eventType) filter.eventType = req.query.eventType;
  if (req.query.category) filter.findingLabels = req.query.category;
  if (req.query.status) filter['investigation.status'] = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q).slice(0, 120), 'i');
    filter.$or = [{ maskedPreview: rx }, { domain: rx }, { findingLabels: rx }];
  }

  try {
    const [events, total] = await Promise.all([
      Event.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Event.countDocuments(filter),
    ]);

    const orgIds = [...new Set(events.map(event => String(event.orgId)).filter(Boolean))];
    const orgs = orgIds.length
      ? await Org.find({ _id: { $in: orgIds } }).lean()
      : [];
    const orgNames = new Map(orgs.map(org => [String(org._id), org.name]));

    return res.json({
      page,
      limit,
      total,
      events: events.map(event => sanitizeEvent({ ...event, tenantName: orgNames.get(String(event.orgId)) ?? null })),
    });
  } catch {
    return res.status(500).json({ error: 'Event query failed' });
  }
});

router.get('/events/:id', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid event id' });
  try {
    const event = await Event.findById(req.params.id).lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const org = event.orgId ? await Org.findOne({ _id: event.orgId }).lean() : null;
    return res.json({ event: sanitizeEvent({ ...event, tenantName: org?.name ?? null }) });
  } catch {
    return res.status(500).json({ error: 'Event lookup failed' });
  }
});

// Both platform roles may annotate an investigation.
router.patch('/events/:id/investigation', async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid event id' });
  const allowed = ['open', 'investigating', 'resolved', 'dismissed'];
  const { status, note } = req.body ?? {};
  if (status !== undefined && !allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid investigation status' });
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > 1000)) {
    return res.status(400).json({ error: 'Invalid investigation note' });
  }

  const update = {
    'investigation.updatedBy': req.platformAdmin.email,
    'investigation.updatedAt': new Date(),
  };
  if (status !== undefined) update['investigation.status'] = status;
  if (note !== undefined) update['investigation.note'] = note;

  try {
    const event = await Event.findOneAndUpdate({ _id: req.params.id }, { $set: update }, { new: true }).lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });
    return res.json({ event: sanitizeEvent(event) });
  } catch {
    return res.status(500).json({ error: 'Investigation update failed' });
  }
});

// ─── Tenants with metrics ────────────────────────────────────────────────────
router.get('/tenants', async (req, res) => {
  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  try {
    const orgs = await Org.find({}).sort({ createdAt: -1 }).limit(Math.min(limit, ORG_METRIC_CAP)).lean();
    const tenants = await Promise.all(orgs.map(async org => {
      const [users, activeDevices, events, highRisk] = await Promise.all([
        User.countDocuments({ orgId: org._id }),
        Device.countDocuments({ orgId: org._id, isActive: true, revokedAt: null }),
        Event.countDocuments({ orgId: org._id }),
        Event.countDocuments({ orgId: org._id, severity: { $in: ['HIGH', 'CRITICAL'] } }),
      ]);
      return {
        id: org._id,
        name: org.name,
        lifecycleStatus: org.lifecycleStatus,
        securityScore: org.securityScore ?? null,
        activatedAt: org.activatedAt ?? null,
        createdAt: org.createdAt ?? null,
        metrics: { users, activeDevices, events, highRisk },
      };
    }));
    return res.json({ tenants });
  } catch {
    return res.status(500).json({ error: 'Tenant metrics failed' });
  }
});

// ─── Audit explorer (platform + tenant actions) ──────────────────────────────
router.get('/audit', async (req, res) => {
  const page = clampInt(req.query.page, 1, 1, 100000);
  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const { from, to } = parseWindow(req.query);
  const window = { $gte: from, $lte: to };

  const platformFilter = { timestamp: window };
  const tenantFilter = { timestamp: window };
  if (req.query.action) {
    platformFilter.action = new RegExp(escapeRegex(req.query.action), 'i');
    tenantFilter.action = new RegExp(escapeRegex(req.query.action), 'i');
  }
  if (req.query.tenantId) {
    platformFilter.tenantId = req.query.tenantId;
    tenantFilter.orgId = req.query.tenantId;
  }

  const take = page * limit;
  try {
    const [platformLogs, tenantLogs] = await Promise.all([
      PlatformAuditLog.find(platformFilter).sort({ timestamp: -1 }).limit(take).lean(),
      AuditLog.find(tenantFilter).sort({ timestamp: -1 }).limit(take).lean(),
    ]);

    const merged = [
      ...platformLogs.map(entry => ({
        source: 'platform',
        id: entry._id,
        action: entry.action,
        tenantId: entry.tenantId,
        actor: entry.actorAdminId ? String(entry.actorAdminId) : null,
        target: entry.targetId ?? null,
        ip: entry.ip ?? null,
        changes: entry.changes ?? null,
        timestamp: entry.timestamp,
      })),
      ...tenantLogs.map(entry => ({
        source: 'tenant',
        id: entry._id,
        action: entry.action,
        tenantId: entry.orgId,
        actor: entry.actor ? String(entry.actor) : null,
        target: entry.target ?? null,
        ip: entry.ip ?? null,
        changes: entry.changes ?? null,
        timestamp: entry.timestamp,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return res.json({
      page,
      limit,
      entries: merged.slice((page - 1) * limit, page * limit),
    });
  } catch {
    return res.status(500).json({ error: 'Audit query failed' });
  }
});

// ─── Authentication telemetry ────────────────────────────────────────────────
router.get('/auth-events', async (req, res) => {
  const page = clampInt(req.query.page, 1, 1, 100000);
  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const { from, to } = parseWindow(req.query);
  const filter = { at: { $gte: from, $lte: to } };
  if (req.query.outcome) filter.outcome = req.query.outcome;
  if (req.query.scope) filter.scope = req.query.scope;

  try {
    const [entries, total] = await Promise.all([
      AuthEvent.find(filter).sort({ at: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      AuthEvent.countDocuments(filter),
    ]);
    return res.json({
      page,
      limit,
      total,
      entries: entries.map(entry => ({
        at: entry.at,
        outcome: entry.outcome,
        scope: entry.scope,
        emailMasked: entry.emailMasked,
        reason: entry.reason ?? null,
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Auth telemetry query failed' });
  }
});

// ─── Operational health ──────────────────────────────────────────────────────
router.get('/health', async (_req, res) => {
  try {
    const [orgs, users, devices, events, platformAdmins] = await Promise.all([
      Org.countDocuments({}),
      User.countDocuments({}),
      Device.countDocuments({}),
      Event.countDocuments({}),
      PlatformAdmin.countDocuments({}),
    ]);
    const mongooseState = mongoose.connection.readyState;
    return res.json({
      database: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongooseState] ?? 'unknown',
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
      },
      counts: { orgs, users, devices, events, platformAdmins },
      recentErrors: getRecentErrors(),
    });
  } catch {
    return res.status(500).json({ error: 'Health query failed' });
  }
});

export default router;
