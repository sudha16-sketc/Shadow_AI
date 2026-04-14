// backend/src/routes/users.js
/**
 * Shadow AI Auditor — Users Routes
 *
 * All routes require JWT auth (mounted with authMiddleware in server.js).
 *
 * GET    /api/users              — list all users (admin/manager)
 * GET    /api/users/:id          — get single user + their recent events
 * POST   /api/users              — create user (admin only)
 * PATCH  /api/users/:id          — update user (admin only)
 * DELETE /api/users/:id          — soft-delete / deactivate (admin only)
 * PATCH  /api/users/:id/opt-out  — toggle extension opt-out for a user
 * GET    /api/users/:id/events   — paginated event history for one user
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User, Event } from '../models/index.js';
import { requireRole } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const CreateUserSchema = z.object({
  email:      z.string().email().max(254),
  password:   z.string().min(8).max(128),
  name:       z.string().min(1).max(100),
  role:       z.enum(['admin', 'manager', 'viewer']).default('viewer'),
  department: z.string().max(100).optional().default(''),
  extensionUserId: z.string().max(64).optional(),
});

const UpdateUserSchema = z.object({
  name:       z.string().min(1).max(100).optional(),
  role:       z.enum(['admin', 'manager', 'viewer']).optional(),
  department: z.string().max(100).optional(),
  extensionUserId: z.string().max(64).optional(),
  isActive:   z.boolean().optional(),
  // Password update is handled separately (requires current password check)
});

// ─── GET /api/users  ──────────────────────────────────────────────────────────
// List all users with their event stats aggregated

router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { search, department, role, page = 1, limit = 30 } = req.query;
    const filter = {};

    if (search) {
      filter.$or = [
        { name:  { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    if (department) filter.department = department;
    if (role)       filter.role = role;

    const since = new Date(Date.now() - 30 * 86400000);

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-passwordHash')               // never expose hashed passwords
        .sort({ createdAt: -1 })
        .skip((+page - 1) * +limit)
        .limit(+limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    // Enrich each user with their 30-day event stats in one aggregation
    const userIds = users.map(u => u._id);
    const stats = await Event.aggregate([
      { $match: { userRef: { $in: userIds }, timestamp: { $gte: since } } },
      {
        $group: {
          _id:        '$userRef',
          total:      { $sum: 1 },
          highRisk:   { $sum: { $cond: [{ $eq: ['$severity', 'HIGH']   }, 1, 0] } },
          mediumRisk: { $sum: { $cond: [{ $eq: ['$severity', 'MEDIUM'] }, 1, 0] } },
          avgScore:   { $avg: '$riskScore' },
          lastSeen:   { $max: '$timestamp' },
        },
      },
    ]);

    // Map stats by userId for O(1) lookup
    const statsMap = Object.fromEntries(stats.map(s => [s._id.toString(), s]));

    const enriched = users.map(u => ({
      ...u,
      stats: statsMap[u._id.toString()] ?? {
        total: 0, highRisk: 0, mediumRisk: 0, avgScore: 0, lastSeen: null,
      },
    }));

    res.json({ users: enriched, total, page: +page, limit: +limit });
  } catch (err) {
    logger.error('GET /users error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /api/users/departments  ──────────────────────────────────────────────
// Returns distinct department list for filter dropdowns

router.get('/departments', requireRole('admin', 'manager'), async (_req, res) => {
  const departments = await User.distinct('department', { department: { $ne: '' } });
  res.json({ departments: departments.sort() });
});

// ─── GET /api/users/:id  ──────────────────────────────────────────────────────
// Single user profile with recent event history

router.get('/:id', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const since = new Date(Date.now() - 30 * 86400000);

    // Recent events + aggregate stats in parallel
    const [recentEvents, stats] = await Promise.all([
      Event.find({ userRef: user._id })
        .sort({ timestamp: -1 })
        .limit(20)
        .lean(),
      Event.aggregate([
        { $match: { userRef: user._id, timestamp: { $gte: since } } },
        {
          $group: {
            _id:      null,
            total:    { $sum: 1 },
            highRisk: { $sum: { $cond: [{ $eq: ['$severity', 'HIGH']   }, 1, 0] } },
            medRisk:  { $sum: { $cond: [{ $eq: ['$severity', 'MEDIUM'] }, 1, 0] } },
            avgScore: { $avg: '$riskScore' },
            lastSeen: { $max: '$timestamp' },
            topDomains: { $push: '$domain' },
          },
        },
      ]),
    ]);

    res.json({ user, recentEvents, stats: stats[0] ?? {} });
  } catch (err) {
    logger.error('GET /users/:id error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── POST /api/users  ─────────────────────────────────────────────────────────
// Admin creates a new user account

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const data = CreateUserSchema.parse(req.body);

    const exists = await User.findOne({ email: data.email.toLowerCase() });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(data.password, 12);
    const { password: _, ...rest } = data;       // strip plaintext password
    const user = await User.create({ ...rest, passwordHash });

    logger.info(`User created: ${user.email} by admin ${req.user.userId}`);
    res.status(201).json({
      id: user._id, email: user.email, name: user.name, role: user.role,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Validation error' });
    logger.error('POST /users error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PATCH /api/users/:id  ────────────────────────────────────────────────────
// Admin updates a user's profile fields

router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const updates = UpdateUserSchema.parse(req.body);

    // Prevent an admin from accidentally demoting themselves
    if (req.params.id === req.user.userId && updates.role && updates.role !== 'admin') {
      return res.status(400).json({ error: 'Cannot demote your own admin account' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-passwordHash');

    if (!user) return res.status(404).json({ error: 'User not found' });

    logger.info(`User ${user.email} updated by admin ${req.user.userId}`);
    res.json(user);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Validation error' });
    logger.error('PATCH /users/:id error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PATCH /api/users/:id/password  ──────────────────────────────────────────
// Admin resets a user's password (no current-password check — admin privilege)

router.patch('/:id/password', requireRole('admin'), async (req, res) => {
  try {
    const { newPassword } = req.body ?? {};
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { passwordHash } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    logger.error('PATCH /users/:id/password error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PATCH /api/users/:id/opt-out  ────────────────────────────────────────────
// Toggle extension monitoring opt-out for a user (admin or the user themselves)

router.patch('/:id/opt-out', async (req, res) => {
  // Allow if admin, OR if the user is updating their own record
  const isSelf  = req.params.id === req.user.userId;
  const isAdmin = req.user.role === 'admin';
  if (!isSelf && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { optedOut } = req.body ?? {};
    if (typeof optedOut !== 'boolean') {
      return res.status(400).json({ error: 'optedOut must be a boolean' });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id, { $set: { optedOut } }, { new: true }
    ).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user._id, optedOut: user.optedOut });
  } catch (err) {
    logger.error('PATCH /users/:id/opt-out error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── DELETE /api/users/:id  ───────────────────────────────────────────────────
// Soft-delete: sets isActive = false, preserving event history

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (req.params.id === req.user.userId) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id, { $set: { isActive: false } }, { new: true }
    ).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });

    logger.info(`User ${user.email} deactivated by admin ${req.user.userId}`);
    res.json({ ok: true, id: user._id });
  } catch (err) {
    logger.error('DELETE /users/:id error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /api/users/:id/events  ───────────────────────────────────────────────
// Paginated event log scoped to a single user

router.get('/:id/events', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { page = 1, limit = 20, severity } = req.query;
    const filter = { userRef: req.params.id };
    if (severity) filter.severity = severity.toUpperCase();

    const [events, total] = await Promise.all([
      Event.find(filter).sort({ timestamp: -1 }).skip((+page - 1) * +limit).limit(+limit).lean(),
      Event.countDocuments(filter),
    ]);

    res.json({ events, total, page: +page, limit: +limit });
  } catch (err) {
    logger.error('GET /users/:id/events error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;