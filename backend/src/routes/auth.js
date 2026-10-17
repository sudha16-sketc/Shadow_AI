// backend/src/routes/auth.js
/**
 * Shadow AI Auditor — Auth Routes
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from 'zod';
import { JWT_SECRET } from "../config/security.js";
import { AccessRequest, AuditLog, Device, Org, TenantInvitation, User } from "../models/index.js";
import { authMiddleware, requireRole, requireUserAuth } from "../middleware/auth.js";
import { issueWebSocketTicket, revokeWebSocketUser } from '../services/websocket.js';
import { createDeviceCredential, createDeviceId, createEnrollmentCode, hashDeviceCredential } from '../utils/device-credentials.js';
import { recordAuthEvent } from '../utils/telemetry.js';

const router = Router();
const TOKEN_TTL = "7d";
// Compare against a throwaway hash when no account matches so that the
// response time of a missing account matches that of a wrong password.
const DUMMY_PASSWORD_HASH = "$2a$12$9SFTaJVQ/06RHQqYPMx/SeHSyFNMt.rSWqWw5WEGa18sT0zUTPh2y";
const LoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();
const EnrollmentSchema = z.object({ label: z.string().trim().min(1).max(100).optional() }).strict();
const RegistrationSchema = z.object({ code: z.string().min(32).max(128) }).strict();
const AccessRequestSchema = z.object({ email: z.string().trim().email().max(254) }).strict();
// Identical acknowledgement for every outcome so the endpoint never reveals
// whether an account exists or is eligible for activation.
const ACCESS_REQUEST_ACK = {
  message: 'If a provisioned account matches that email, an access request has been recorded.',
};

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const { email, password } = parsed.data;

    const user = await User.findOne({
      email: email.toLowerCase(),
    });

    // Always run one bcrypt comparison so timing does not reveal account existence.
    const isMatch = await bcrypt.compare(password, user?.passwordHash || DUMMY_PASSWORD_HASH);

    if (!user || !user.passwordHash || !user.isActive || !user.orgId || !isMatch) {
      recordAuthEvent({ outcome: 'failure', scope: 'tenant', email, ip: req.ip, reason: 'invalid_credentials' });
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    const org = await Org.findOne({ _id: user.orgId, lifecycleStatus: 'active' });
    if (!org) {
      recordAuthEvent({ outcome: 'failure', scope: 'tenant', email, ip: req.ip, reason: 'tenant_inactive' });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        tokenType: 'user',
        userId: user._id,
        orgId: user.orgId,
        authVersion: user.authVersion ?? 0,
      },
      JWT_SECRET,
      {
        expiresIn: TOKEN_TTL,
        algorithm: 'HS256',
      }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        orgId: user.orgId,
        role: user.role,
      },
    });
    recordAuthEvent({ outcome: 'success', scope: 'tenant', email, ip: req.ip });
  } catch (err) {
    res.status(500).json({
      error: 'Login failed',
    });
  }
});


router.post("/signup", async (req, res) => {
  return res.status(403).json({ error: 'Account enrollment requires an organization invitation' });
});

// POST /api/auth/access-request
// A provisioned-but-inactive account asks to be activated. The reviewer scope
// (platform for tenant admins, the tenant's own admin for everyone else) and
// the tenant are always derived from the matching account record — never from
// the request body — so a caller cannot target another tenant or escalate.
router.post('/access-request', async (req, res) => {
  const parsed = AccessRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A valid email address is required' });

  try {
    const email = parsed.data.email.toLowerCase();
    const user = await User.findOne({ email });
    let target = null;
    if (user && user.orgId && user.isActive === false) {
      // An existing inactive account (a developer, or a returning administrator).
      target = {
        scope: user.role === 'admin' ? 'tenant_admin' : 'developer',
        orgId: user.orgId,
        userId: user._id,
      };
    } else if (!user) {
      // A first-time tenant administrator is still identified by their pending
      // invitation; the account itself is created at approval time.
      const invitation = await TenantInvitation.findOne({
        email, status: 'pending', usedAt: null, expiresAt: { $gt: new Date() },
      });
      if (invitation) target = { scope: 'tenant_admin', orgId: invitation.orgId, userId: null };
    }

    if (target) {
      const existing = await AccessRequest.findOne({ orgId: target.orgId, email, status: 'pending' });
      if (!existing) {
        await AccessRequest.create({
          ...target,
          email,
          status: 'pending',
          requestedAt: new Date(),
        });
        await AuditLog.create({
          orgId: target.orgId,
          action: 'access_requested',
          actor: target.userId ?? null,
          target: email,
          changes: { scope: target.scope },
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }
    return res.status(202).json(ACCESS_REQUEST_ACK);
  } catch {
    return res.status(500).json({ error: 'Access request could not be processed' });
  }
});

router.get('/check-auth', authMiddleware, requireUserAuth, (req, res) => {
  res.json({ authenticated: true, userId: req.user.userId, orgId: req.user.orgId, role: req.user.role });
});

router.post('/logout', authMiddleware, requireUserAuth, async (req, res) => {
  await User.updateOne({ _id: req.user.userId, orgId: req.user.orgId }, { $inc: { authVersion: 1 } });
  revokeWebSocketUser(req.user.userId);
  res.json({ success: true });
});

router.post('/device/enrollment-code', authMiddleware, requireUserAuth, async (req, res) => {
  try {
    const { label } = EnrollmentSchema.parse(req.body ?? {});
    const code = createEnrollmentCode();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const device = await Device.create({
      orgId: req.user.orgId,
      userId: req.user.userId,
      deviceId: createDeviceId(),
      label: label ?? 'Browser Extension',
      tokenHash: hashDeviceCredential(code),
      enrollmentExpiresAt: expiresAt,
      isActive: false,
      revokedAt: null,
    });
    return res.status(201).json({ code, expiresAt, deviceId: device.deviceId });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid enrollment request' });
    return res.status(500).json({ error: 'Failed to create device enrollment' });
  }
});

router.post('/device/register', async (req, res) => {
  const parsed = RegistrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid enrollment code required' });

  try {
    const now = new Date();
    const pending = await Device.findOne({
      tokenHash: hashDeviceCredential(parsed.data.code),
      isActive: false,
      enrollmentExpiresAt: { $gt: now },
    });
    if (!pending) return res.status(401).json({ error: 'Enrollment code is invalid or expired' });

    const owner = await User.findOne({ _id: pending.userId, orgId: pending.orgId, isActive: true });
    const org = await Org.findOne({ _id: pending.orgId, lifecycleStatus: 'active' });
    if (!owner || !org) return res.status(401).json({ error: 'Enrollment code is invalid or expired' });

    const token = createDeviceCredential();
    const device = await Device.findOneAndUpdate(
      { _id: pending._id, tokenHash: hashDeviceCredential(parsed.data.code), isActive: false, enrollmentExpiresAt: { $gt: now } },
      { $set: { tokenHash: hashDeviceCredential(token), isActive: true, enrollmentExpiresAt: null, lastSeenAt: now } },
      { new: true, runValidators: true }
    );
    if (!device) return res.status(401).json({ error: 'Enrollment code is invalid or expired' });

    return res.status(201).json({ token, deviceId: device.deviceId, label: device.label });
  } catch {
    return res.status(500).json({ error: 'Device registration failed' });
  }
});

router.post('/device/:deviceId/revoke', authMiddleware, requireUserAuth, async (req, res) => {
  const filter = { orgId: req.user.orgId, deviceId: req.params.deviceId, isActive: true };
  if (req.user.role !== 'admin') filter.userId = req.user.userId;

  const device = await Device.findOneAndUpdate(
    filter,
    { $set: { isActive: false, revokedAt: new Date() } },
    { new: true }
  );
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json({ ok: true });
});

router.post('/ws-ticket', authMiddleware, requireUserAuth, requireRole('admin', 'manager'), (req, res) => {
  res.json(issueWebSocketTicket(req.user));
});

export default router;
