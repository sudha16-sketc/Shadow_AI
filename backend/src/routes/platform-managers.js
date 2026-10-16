// backend/src/routes/platform-managers.js
/**
 * Platform manager administration — super administrators only.
 *
 * Managers are trusted platform identities with read-oriented monitoring and
 * investigation access (see platform-monitoring.js). They can never manage
 * platform accounts, change roles, or perform super-admin operations. Password
 * hashes are never returned.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PlatformAdmin } from '../models/index.js';
import { platformAdminAuthMiddleware, requirePlatformRole } from '../middleware/auth.js';

const router = Router();
const BCRYPT_COST = 12;

const CreateManagerSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(16).max(128),
}).strict();

const UpdateManagerSchema = z.object({
  isActive: z.boolean(),
}).strict();

const PasswordSchema = z.object({
  password: z.string().min(16).max(128),
}).strict();

function publicManager(admin) {
  return {
    id: admin._id,
    email: admin.email,
    role: admin.role ?? 'super_admin',
    isActive: admin.isActive !== false,
    createdAt: admin.createdAt ?? null,
    updatedAt: admin.updatedAt ?? null,
  };
}

router.use(platformAdminAuthMiddleware, requirePlatformRole('super_admin'));

router.get('/', async (_req, res) => {
  try {
    const managers = await PlatformAdmin.find({ role: 'manager' }).sort({ createdAt: -1 }).lean();
    return res.json({ managers: managers.map(publicManager) });
  } catch {
    return res.status(500).json({ error: 'Manager listing failed' });
  }
});

router.post('/', async (req, res) => {
  const parsed = CreateManagerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid email and 16+ character password required' });

  const email = parsed.data.email.toLowerCase();
  try {
    const existing = await PlatformAdmin.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Platform identity already exists' });

    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_COST);
    const manager = await PlatformAdmin.create({
      email,
      passwordHash,
      role: 'manager',
      isActive: true,
      authVersion: 0,
    });
    return res.status(201).json({ manager: publicManager(manager) });
  } catch {
    return res.status(500).json({ error: 'Manager creation failed' });
  }
});

router.patch('/:managerId', async (req, res) => {
  const parsed = UpdateManagerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'isActive boolean required' });

  try {
    const manager = await PlatformAdmin.findOne({ _id: req.params.managerId, role: 'manager' });
    if (!manager) return res.status(404).json({ error: 'Manager not found' });

    // Deactivation bumps authVersion so already-issued tokens stop working.
    const update = parsed.data.isActive
      ? { $set: { isActive: true } }
      : { $set: { isActive: false }, $inc: { authVersion: 1 } };
    const updated = await PlatformAdmin.findOneAndUpdate(
      { _id: req.params.managerId, role: 'manager' },
      update,
      { new: true },
    ).lean();
    return res.json({ manager: publicManager(updated) });
  } catch {
    return res.status(500).json({ error: 'Manager update failed' });
  }
});

router.patch('/:managerId/password', async (req, res) => {
  const parsed = PasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Password must be at least 16 characters' });

  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_COST);
    const updated = await PlatformAdmin.findOneAndUpdate(
      { _id: req.params.managerId, role: 'manager' },
      { $set: { passwordHash }, $inc: { authVersion: 1 } },
      { new: true },
    ).lean();
    if (!updated) return res.status(404).json({ error: 'Manager not found' });
    return res.json({ manager: publicManager(updated) });
  } catch {
    return res.status(500).json({ error: 'Password update failed' });
  }
});

router.delete('/:managerId', async (req, res) => {
  try {
    const manager = await PlatformAdmin.findOneAndUpdate(
      { _id: req.params.managerId, role: 'manager' },
      { $set: { isActive: false }, $inc: { authVersion: 1 } },
      { new: true },
    ).lean();
    if (!manager) return res.status(404).json({ error: 'Manager not found' });
    return res.json({ revoked: true, manager: publicManager(manager) });
  } catch {
    return res.status(500).json({ error: 'Manager revocation failed' });
  }
});

export default router;
