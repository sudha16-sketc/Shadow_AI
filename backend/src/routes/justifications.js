// backend/src/routes/justifications.js
/**
 * Shadow AI Auditor — Justifications Routes
 *
 * Handles user justifications for flagged events and manager approvals.
 *
 * POST   /api/justifications           — user submits justification for an event
 * GET    /api/justifications/pending   — list pending justifications (manager/admin)
 * GET    /api/justifications           — list all justifications (admin/manager)
 * PATCH  /api/justifications/:id/approve — manager approves a justification
 * PATCH  /api/justifications/:id/reject  — manager rejects a justification
 */
import { Router } from 'express';
import { z } from 'zod';
import { Justification, Event, User, AuditLog } from '../models/index.js';
import { authMiddleware, requireRole, requireTenantAccess } from '../middleware/auth.js';
import { clampPagination } from '../utils/pagination.js';
import logger from '../utils/logger.js';

const router = Router();
router.use(requireTenantAccess);

// ─── Validation schemas ───────────────────────────────────────────────────────

const SubmitJustificationSchema = z.object({
  eventId: z.string().length(24),
  reason:  z.string().min(10).max(500),
});

const ApproveSchema = z.object({
  approved: z.boolean(),
  reason:   z.string().max(500).optional(),
});

// ─── POST /api/justifications  ────────────────────────────────────────────────
// User submits a justification for why they were sending sensitive data

router.post('/', authMiddleware, async (req, res) => {
  try {
    const data = SubmitJustificationSchema.parse(req.body);

    // Verify event exists and belongs to user
    const event = await Event.findOne({ _id: data.eventId, orgId: req.user.orgId });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!event.userRef || event.userRef.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Cannot justify another user\'s event' });
    }

    // Check if justification already exists
    const existing = await Justification.findOne({ orgId: req.user.orgId, eventId: data.eventId });
    if (existing) return res.status(409).json({ error: 'Justification already submitted' });

    const justification = await Justification.create({
      orgId: req.user.orgId,
      eventId: data.eventId,
      userId: req.user.userId,
      reason: data.reason,
      approved: null, // pending
    });

    res.status(201).json(justification);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message });
    logger.error('POST /justifications error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /api/justifications/pending  ──────────────────────────────────────────
// List pending justifications awaiting manager approval

router.get('/pending', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { page, limit, skip } = clampPagination(req.query, { defaultLimit: 20, maxLimit: 100 });

    const [justifications, total] = await Promise.all([
      Justification.find({ orgId: req.user.orgId, approved: null })
        .populate('userId', 'name email department')
        .populate('eventId', 'domain severity riskScore maskedPreview')
        .sort({ timestamp: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Justification.countDocuments({ orgId: req.user.orgId, approved: null }),
    ]);

    res.json({ justifications, total, page, limit });
  } catch (err) {
    logger.error('GET /justifications/pending error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /api/justifications  ──────────────────────────────────────────────────
// List all justifications with filters

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { approved } = req.query;
    const { page, limit, skip } = clampPagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const filter = {};
    if (approved !== undefined) filter.approved = approved === 'true';

    const [justifications, total] = await Promise.all([
      Justification.find({ ...filter, orgId: req.user.orgId })
        .populate('userId', 'name email')
        .populate('eventId', 'domain severity riskScore')
        .populate('approvedBy', 'name email')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Justification.countDocuments({ ...filter, orgId: req.user.orgId }),
    ]);

    res.json({ justifications, total, page, limit });
  } catch (err) {
    logger.error('GET /justifications error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /api/justifications/:id  ──────────────────────────────────────────────

router.get('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const just = await Justification.findOne({ _id: req.params.id, orgId: req.user.orgId })
      .populate('userId', 'name email department')
      .populate('eventId')
      .populate('approvedBy', 'name email');
    if (!just) return res.status(404).json({ error: 'Not found' });
    res.json(just);
  } catch (err) {
    logger.error('GET /justifications/:id error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PATCH /api/justifications/:id/approve  ───────────────────────────────────
// Manager approves or rejects justification

router.patch('/:id/approve', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const data = ApproveSchema.parse(req.body);

    const justification = await Justification.findOneAndUpdate(
      { _id: req.params.id, orgId: req.user.orgId },
      {
        $set: {
          approved: data.approved,
          approvedBy: req.user.userId,
          approvalReason: data.reason || '',
        },
      },
      { new: true }
    );

    if (!justification) return res.status(404).json({ error: 'Not found' });

    // Log audit trail
    await AuditLog.create({
      orgId: req.user.orgId,
      action: 'justification_' + (data.approved ? 'approved' : 'rejected'),
      actor: req.user.userId,
      target: req.params.id,
      changes: { approved: data.approved, reason: data.reason },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json(justification);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message });
    logger.error('PATCH /justifications/:id/approve error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
