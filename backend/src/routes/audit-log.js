// backend/src/routes/audit-log.js
/**
 * Shadow AI Auditor — Audit Log Routes
 *
 * Logs all admin/manager actions for compliance and troubleshooting.
 *
 * GET  /api/audit-log           — list audit events (admin/manager)
 * GET  /api/audit-log/:id       — single audit entry
 * GET  /api/audit-log/export    — export audit logs as CSV or JSON
 */
import { Router } from 'express';
import { AuditLog, User } from '../models/index.js';
import { requireRole, requireTenantAccess } from '../middleware/auth.js';
import { clampPagination, escapeRegex } from '../utils/pagination.js';
import logger from '../utils/logger.js';
import mongoose from 'mongoose';

const router = Router();
router.use(requireTenantAccess);

// ─── GET /api/audit-log  ──────────────────────────────────────────────────────
// List audit events with filters

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { action, actor, from, to } = req.query;
    const { page, limit, skip } = clampPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const filter = { orgId: req.user.orgId };

    if (action) filter.action = { $regex: escapeRegex(String(action).slice(0, 100)), $options: 'i' };
    if (actor)  filter.actor = String(actor).slice(0, 64);
    if (from || to) {
      filter.timestamp = {};
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;
      if (fromDate && !Number.isNaN(fromDate.getTime())) filter.timestamp.$gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) filter.timestamp.$lte = toDate;
      if (Object.keys(filter.timestamp).length === 0) delete filter.timestamp;
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('actor', 'name email')
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ logs, total, page, limit });
  } catch (err) {
    logger.error('GET /audit-log error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /api/audit-log/export  ───────────────────────────────────────────────
// Export audit logs as CSV or JSON

router.get('/export', requireRole('admin'), async (req, res) => {
  try {
    const { format = 'json', from, to } = req.query;
    const filter = { orgId: req.user.orgId };

    if (from || to) {
      filter.timestamp = {};
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;
      if (fromDate && !Number.isNaN(fromDate.getTime())) filter.timestamp.$gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) filter.timestamp.$lte = toDate;
      if (Object.keys(filter.timestamp).length === 0) delete filter.timestamp;
    }

    const EXPORT_MAX_ROWS = Number(process.env.AUDIT_EXPORT_MAX_ROWS ?? 10_000);
    const logs = await AuditLog.find(filter)
      .populate('actor', 'name email')
      .sort({ timestamp: -1 })
      .limit(EXPORT_MAX_ROWS)
      .lean();

    if (format === 'csv') {
      const cell = value => {
        let text = value === null || value === undefined ? '' : String(value);
        // Neutralise spreadsheet formula injection (CSV injection).
        if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
      };
      const csv = [
        'timestamp,action,actor,target,changes,ip',
        ...logs.map(l =>
          [l.timestamp?.toISOString?.() ?? '', l.action, l.actor?.email || 'N/A', l.target || '', JSON.stringify(l.changes) ?? '', l.ip || ''].map(cell).join(',')
        ),
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.csv"`);
      res.send(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.json"`);
      res.json(logs);
    }
  } catch (err) {
    logger.error('GET /audit-log/export error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /api/audit-log/:id  ──────────────────────────────────────────────────

router.get('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const log = await AuditLog.findOne({ _id: req.params.id, orgId: req.user.orgId })
      .populate('actor', 'name email');
    if (!log) return res.status(404).json({ error: 'Not found' });
    res.json(log);
  } catch (err) {
    logger.error('GET /audit-log/:id error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
