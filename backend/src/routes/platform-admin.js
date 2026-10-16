import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { JWT_SECRET } from '../config/security.js';
import { Org, PlatformAdmin, PlatformAuditLog, TenantInvitation, User } from '../models/index.js';
import { platformAdminAuthMiddleware, requirePlatformRole } from '../middleware/auth.js';
import { createEnrollmentCode, hashDeviceCredential } from '../utils/device-credentials.js';
import { revokeWebSocketTenant } from '../services/websocket.js';
import { recordAuthEvent } from '../utils/telemetry.js';

const router = Router();
const PLATFORM_TOKEN_TTL = '15m';
const DUMMY_PASSWORD_HASH = "$2a$12$9SFTaJVQ/06RHQqYPMx/SeHSyFNMt.rSWqWw5WEGa18sT0zUTPh2y";
const INVITATION_TTL_MS = 24 * 60 * 60_000;
const TenantProvisionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  adminName: z.string().trim().min(1).max(100),
  adminEmail: z.string().trim().email().max(254),
}).strict();
const InvitationAcceptSchema = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(12).max(128),
}).strict();
const TenantStatusSchema = z.object({ lifecycleStatus: z.enum(['active', 'suspended']) }).strict();
const TenantAdminInviteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
}).strict();

router.post('/auth/login', async (req, res) => {
  const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).strict().safeParse(req.body);
  if (!credentials.success) return res.status(400).json({ error: 'Email and password required' });

  try {
    const email = credentials.data.email.toLowerCase();
    const admin = await PlatformAdmin.findOne({ email, isActive: true });
    const isMatch = await bcrypt.compare(credentials.data.password, admin?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!admin || !isMatch) {
      recordAuthEvent({ outcome: 'failure', scope: 'platform', email, ip: req.ip, reason: 'invalid_credentials' });
      return res.status(401).json({ error: 'Invalid platform administrator credentials' });
    }

    const role = admin.role ?? 'super_admin';
    const token = jwt.sign({
      tokenType: 'platform_admin',
      platformAdminId: admin._id,
      role,
      authVersion: admin.authVersion ?? 0,
    }, JWT_SECRET, { expiresIn: PLATFORM_TOKEN_TTL, algorithm: 'HS256' });

    recordAuthEvent({ outcome: 'success', scope: 'platform', email, ip: req.ip });
    return res.json({
      token,
      platformAdmin: { id: admin._id, email: admin.email, role },
    });
  } catch {
    return res.status(500).json({ error: 'Platform administrator login failed' });
  }
});

router.post('/invitations/accept', async (req, res) => {
  const parsed = InvitationAcceptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid invitation token and password required' });

  try {
    const now = new Date();
    const tokenHash = hashDeviceCredential(parsed.data.token);
    const invitationFilter = { tokenHash, status: 'pending', usedAt: null, expiresAt: { $gt: now } };
    const availableInvitation = await TenantInvitation.findOne(invitationFilter);
    const invitationOrg = availableInvitation
      ? await Org.findOne({ _id: availableInvitation.orgId, lifecycleStatus: 'pending_admin' })
      : null;
    const existingUser = availableInvitation
      ? await User.findOne({ email: availableInvitation.email })
      : null;
    if (!availableInvitation || !invitationOrg || (existingUser && (String(existingUser.orgId) !== String(availableInvitation.orgId) || existingUser.role !== 'admin'))) {
      return res.status(401).json({ error: 'Invitation is invalid, expired, or already used' });
    }

    const invitation = await TenantInvitation.findOneAndUpdate(
      invitationFilter,
      { $set: { status: 'accepted', usedAt: now } },
      { new: true }
    );
    if (!invitation) return res.status(401).json({ error: 'Invitation is invalid, expired, or already used' });

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = existingUser
      ? await User.findOneAndUpdate(
        { _id: existingUser._id, orgId: invitation.orgId, role: 'admin' },
        { $set: { passwordHash, name: invitation.name, isActive: false }, $inc: { authVersion: 1 } },
        { new: true }
      )
      : await User.create({
        email: invitation.email,
        passwordHash,
        name: invitation.name,
        orgId: invitation.orgId,
        role: 'admin',
        isActive: false,
      });
    if (!user) return res.status(409).json({ error: 'Tenant admin identity could not be prepared' });

    const activatedUser = await User.findOneAndUpdate(
      { _id: user._id, orgId: invitation.orgId, isActive: false },
      { $set: { isActive: true } },
      { new: true }
    );
    if (!activatedUser) return res.status(409).json({ error: 'Tenant activation could not be completed' });

    const activatedOrg = await Org.findOneAndUpdate(
      { _id: invitation.orgId, lifecycleStatus: 'pending_admin' },
      { $set: { lifecycleStatus: 'active', activatedAt: now } },
      { new: true }
    );
    if (!activatedOrg) return res.status(409).json({ error: 'Tenant activation could not be completed' });
    await PlatformAuditLog.create({
      actorAdminId: invitation.issuedByAdminId,
      action: 'tenant_admin_activated',
      tenantId: invitation.orgId,
      targetId: String(user._id),
      changes: { email: invitation.email, lifecycleStatus: 'active' },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ activated: true, tenantId: invitation.orgId, email: invitation.email });
  } catch {
    return res.status(500).json({ error: 'Invitation activation failed' });
  }
});

router.use(platformAdminAuthMiddleware);

// GET /api/platform-admin/tenants — list tenants for the platform console.
// Returns lifecycle status and the email of any outstanding invitation. The
// invitation token itself is only ever returned once, at creation/re-issue.
router.get('/tenants', async (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 200)
    : 100;

  try {
    const orgs = await Org.find({}).sort({ createdAt: -1 }).limit(limit).lean();
    const orgIds = orgs.map(org => org._id);
    const pendingInvitations = orgIds.length === 0
      ? []
      : await TenantInvitation.find({
        orgId: { $in: orgIds },
        status: 'pending',
        usedAt: null,
        expiresAt: { $gt: new Date() },
      }).lean();

    const pendingByOrg = new Map(
      pendingInvitations.map(invitation => [String(invitation.orgId), invitation.email]),
    );

    return res.json({
      tenants: orgs.map(org => ({
        id: org._id,
        name: org.name,
        lifecycleStatus: org.lifecycleStatus,
        activatedAt: org.activatedAt ?? null,
        createdAt: org.createdAt ?? null,
        pendingInvitationEmail: pendingByOrg.get(String(org._id)) ?? null,
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Tenant listing failed' });
  }
});

router.post('/tenants', requirePlatformRole('super_admin'), async (req, res) => {
  const parsed = TenantProvisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid tenant provisioning request' });

  try {
    const adminEmail = parsed.data.adminEmail.toLowerCase();
    const now = new Date();
    await TenantInvitation.updateMany(
      { email: adminEmail, status: 'pending', expiresAt: { $lte: now } },
      { $set: { status: 'revoked' } }
    );
    const [existingUser, existingPlatformAdmin, existingInvitation] = await Promise.all([
      User.findOne({ email: adminEmail }),
      PlatformAdmin.findOne({ email: adminEmail }),
      TenantInvitation.findOne({ email: adminEmail, status: 'pending', expiresAt: { $gt: now } }),
    ]);
    if (existingUser || existingPlatformAdmin || existingInvitation) return res.status(409).json({ error: 'Admin identity is already assigned or invited' });

    const org = await Org.create({
      name: parsed.data.name,
      lifecycleStatus: 'pending_admin',
      activatedAt: null,
      securityScore: 100,
      monitoredDomains: ['chat.openai.com', 'claude.ai', 'gemini.google.com'],
      policyVersion: 1,
      settings: { blockOnHigh: true, requireJustification: true, alertOnMedium: true, defaultAction: 'BLOCK' },
    });
    const invitationToken = createEnrollmentCode();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    await TenantInvitation.create({
      orgId: org._id,
      email: adminEmail,
      name: parsed.data.adminName,
      tokenHash: hashDeviceCredential(invitationToken),
      expiresAt,
      usedAt: null,
      status: 'pending',
      issuedByAdminId: req.platformAdmin.id,
    });

    await PlatformAuditLog.create({
      actorAdminId: req.platformAdmin.id,
      action: 'tenant_created',
      tenantId: org._id,
      targetId: String(org._id),
      changes: { name: org.name, lifecycleStatus: org.lifecycleStatus },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    await PlatformAuditLog.create({
      actorAdminId: req.platformAdmin.id,
      action: 'tenant_admin_invited',
      tenantId: org._id,
      targetId: adminEmail,
      changes: { expiresAt },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      tenant: { id: org._id, name: org.name, lifecycleStatus: org.lifecycleStatus },
      invitation: { email: adminEmail, token: invitationToken, expiresAt },
    });
  } catch {
    return res.status(500).json({ error: 'Tenant provisioning failed' });
  }
});

router.post('/tenants/:tenantId/invitations', requirePlatformRole('super_admin'), async (req, res) => {
  const parsed = TenantAdminInviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid tenant administrator invitation' });

  try {
    const org = await Org.findOne({ _id: req.params.tenantId, lifecycleStatus: 'pending_admin' });
    if (!org) return res.status(404).json({ error: 'Pending tenant not found' });

    const email = parsed.data.email.toLowerCase();
    const now = new Date();
    await TenantInvitation.updateMany(
      { email, status: 'pending', expiresAt: { $lte: now } },
      { $set: { status: 'revoked' } }
    );
    const [existingUser, existingPlatformAdmin, existingInvitation] = await Promise.all([
      User.findOne({ email }),
      PlatformAdmin.findOne({ email }),
      TenantInvitation.findOne({ email, status: 'pending', expiresAt: { $gt: now } }),
    ]);
    const userBelongsToOtherIdentity = existingUser && (
      String(existingUser.orgId) !== String(org._id) || existingUser.role !== 'admin'
    );
    if (userBelongsToOtherIdentity || existingPlatformAdmin || existingInvitation) {
      return res.status(409).json({ error: 'Admin identity is already assigned or invited' });
    }

    const token = createEnrollmentCode();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    await TenantInvitation.create({
      orgId: org._id,
      email,
      name: parsed.data.name,
      tokenHash: hashDeviceCredential(token),
      expiresAt,
      status: 'pending',
      usedAt: null,
      issuedByAdminId: req.platformAdmin.id,
    });
    await PlatformAuditLog.create({
      actorAdminId: req.platformAdmin.id,
      action: 'tenant_admin_invited',
      tenantId: org._id,
      targetId: email,
      changes: { expiresAt, replacement: true },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ email, token, expiresAt });
  } catch {
    return res.status(500).json({ error: 'Tenant administrator invitation failed' });
  }
});

router.patch('/tenants/:tenantId/status', requirePlatformRole('super_admin'), async (req, res) => {
  const parsed = TenantStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid tenant lifecycle transition' });

  try {
    const org = await Org.findOneAndUpdate(
      { _id: req.params.tenantId, lifecycleStatus: { $in: ['active', 'suspended'] } },
      { $set: { lifecycleStatus: parsed.data.lifecycleStatus } },
      { new: true }
    );
    if (!org) return res.status(404).json({ error: 'Tenant not found' });

    await PlatformAuditLog.create({
      actorAdminId: req.platformAdmin.id,
      action: parsed.data.lifecycleStatus === 'suspended' ? 'tenant_suspended' : 'tenant_reactivated',
      tenantId: org._id,
      targetId: String(org._id),
      changes: { lifecycleStatus: org.lifecycleStatus },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    if (org.lifecycleStatus === 'suspended') revokeWebSocketTenant(org._id);
    return res.json({ id: org._id, lifecycleStatus: org.lifecycleStatus });
  } catch {
    return res.status(500).json({ error: 'Tenant lifecycle update failed' });
  }
});

export default router;
