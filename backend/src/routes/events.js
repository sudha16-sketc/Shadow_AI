/**
 * Shadow AI Auditor — Events Routes
 * POST /api/events       — single event from extension
 * POST /api/events/batch — batch events from service worker
 * GET  /api/events       — dashboard (auth required)
 */
import { Router } from 'express';
import { z } from 'zod';
import { Event, User } from '../models/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendSlackAlert, sendEmailAlert } from '../services/alerting.js';
import { broadcastAlert } from '../server.js';
import { recalcSecurityScore } from '../services/scoring.js';
import logger from '../utils/logger.js';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const EventSchema = z.object({
  userId:        z.string().max(64),
  domain:        z.string().max(100),
  eventType:     z.enum(['paste','typing','modal_cancel','modal_proceed']),
  riskScore:     z.number().min(0).max(100),
  severity:      z.enum(['LOW','MEDIUM','HIGH']),
  maskedPreview: z.string().max(200).optional(),
  findingLabels: z.array(z.string().max(60)).max(20).optional(),
  timestamp:     z.string().datetime().optional(),
});

// ─── POST /api/events — single event ─────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const data = EventSchema.parse(req.body);
    await processEvent(data);
    res.status(202).json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    logger.error('Event POST error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── POST /api/events/batch ───────────────────────────────────────────────────

router.post('/batch', async (req, res) => {
  const events = req.body?.events;
  if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be array' });
  if (events.length > 200) return res.status(400).json({ error: 'batch too large' });

  const results = await Promise.allSettled(
    events.map(e => {
      try { return processEvent(EventSchema.parse(e)); }
      catch { return Promise.resolve(); } // skip invalid
    })
  );

  const saved = results.filter(r => r.status === 'fulfilled').length;
  res.status(202).json({ ok: true, saved });
});

// ─── GET /api/events — list (auth required) ───────────────────────────────────

router.get('/', authMiddleware, async (req, res) => {
  const { severity, domain, limit = 50, page = 1, from, to } = req.query;
  const filter = {};

  if (severity) filter.severity = severity.toUpperCase();
  if (domain)   filter.domain   = domain;
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = new Date(from);
    if (to)   filter.timestamp.$lte = new Date(to);
  }

  const [events, total] = await Promise.all([
    Event.find(filter)
      .sort({ timestamp: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .populate('userRef', 'name email department'),
    Event.countDocuments(filter),
  ]);

  res.json({ events, total, page: +page, limit: +limit });
});

// ─── GET /api/events/stats ─────────────────────────────────────────────────────

router.get('/stats', authMiddleware, async (req, res) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30d

  const [bySeverity, byDomain, recentCount, totalCount] = await Promise.all([
    Event.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$severity', count: { $sum: 1 }, avgScore: { $avg: '$riskScore' } } },
    ]),
    Event.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$domain', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Event.countDocuments({ timestamp: { $gte: since } }),
    Event.countDocuments(),
  ]);

  res.json({ bySeverity, byDomain, recentCount, totalCount });
});

// ─── Core event processing ─────────────────────────────────────────────────────

async function processEvent(data) {
  // Attempt to resolve userId → User
  const userRef = data.userId
    ? await User.findOne({ extensionUserId: data.userId }).select('_id').lean()
    : null;

  const event = await Event.create({
    ...data,
    userRef: userRef?._id,
    timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
  });

  // Trigger alerts for HIGH severity
  if (data.severity === 'HIGH' && !event.alerted) {
    try {
      await Promise.all([
        sendSlackAlert(event),
        sendEmailAlert(event),
      ]);
      await Event.findByIdAndUpdate(event._id, { alerted: true });
    } catch (err) {
      logger.warn('Alert send failed', err.message);
    }

    // Real-time WebSocket broadcast to open dashboard tabs
    broadcastAlert(event.toObject());
  }

  // Recalculate org security score async (don't await — non-blocking)
  recalcSecurityScore().catch(() => {});

  return event;
}

export default router;