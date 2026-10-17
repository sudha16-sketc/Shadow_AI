import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { JWT_SECRET } from '../config/security.js';
import { AccessRequest, Org, PlatformAdmin, PlatformAuditLog, TenantInvitation, User } from '../models/index.js';
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
  // When supplied, the tenant and its first administrator are activated
  // immediately and no invitation is issued.
  adminPassword: z.string().min(12).max(128).optional(),
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
const AccessReviewSchema = z.object({
  // Only required when the target account has no credential yet.
  password: z.string().min(12).max(128).optional(),
  note: z.string().trim().max(500).optional(),
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

// ─── Tenant administrator access requests ────────────────────────────────────
// A provisioned-but-inactive tenant administrator may ask to be activated.
// Super administrators review these. The tenant and target account are always
// derived from the stored request, never from the caller.
function serializeAccessRequest(request, { user, org } = {}) {
  return {
    id: request._id,
    scope: request.scope,
    status: request.status,
    tenantId: request.orgId,
    tenantName: org?.name ?? null,
    email: request.email,
    hasPassword: Boolean(user?.passwordHash),
    requestedAt: request.requestedAt ?? null,
    reviewedBy: request.reviewedBy ?? null,
    reviewedAt: request.reviewedAt ?? null,
    reviewNote: request.reviewNote ?? '',
  };
}

router.get('/access-requests', async (req, res) => {
  const { status } = req.query;
  const filter = { scope: 'tenant_admin' };
  if (['pending', 'approved', 'rejected'].includes(status)) filter.status = status;

  try {
    const requests = await AccessRequest.find(filter).sort({ requestedAt: -1 }).limit(200).lean();
    const orgs = requests.length
      ? await Org.find({ _id: { $in: requests.map(r => r.orgId) } }).lean()
      : [];
    const userIds = requests.filter(r => r.userId).map(r => r.userId);
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } }).lean()
      : [];
    const orgMap = new Map(orgs.map(o => [String(o._id), o]));
    const userMap = new Map(users.map(u => [String(u._id), u]));

    return res.json({
      requests: requests.map(r => serializeAccessRequest(r, {
        org: orgMap.get(String(r.orgId)),
        user: r.userId ? userMap.get(String(r.userId)) : null,
      })),
    });
  } catch {
    return res.status(500).json({ error: 'Access request listing failed' });
  }
});

router.post('/access-requests/:id/approve', requirePlatformRole('super_admin'), async (req, res) => {
  const parsed = AccessReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid access review' });

  try {
    const request = await AccessRequest.findOne({ _id: req.params.id, scope: 'tenant_admin' });
    if (!request) return res.status(404).json({ error: 'Access request not found' });
    if (request.status !== 'pending') return res.status(409).json({ error: 'Access request already reviewed' });

    const existingUser = request.userId
      ? await User.findOne({ _id: request.userId, orgId: request.orgId })
      : null;
    const invitation = await TenantInvitation.findOne({
      orgId: request.orgId, email: request.email, status: 'pending',
    });
    if (!existingUser && !invitation) {
      return res.status(409).json({ error: 'No provisioned account matches this request' });
    }
    // A password is required only when the account has no credential yet.
    if (!existingUser?.passwordHash && !parsed.data.password) {
      return res.status(400).json({ error: 'A password is required to activate this account' });
    }

    const now = new Date();
    const claimed = await AccessRequest.findOneAndUpdate(
      { _id: request._id, status: 'pending' },
      { $set: { status: 'approved', reviewedBy: String(req.platformAdmin.id), reviewedAt: now, reviewNote: parsed.data.note ?? '' } },
      { new: true }
    );
    if (!claimed) return res.status(409).json({ error: 'Access request already reviewed' });

    const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 12) : undefined;
    let user = existingUser;
    if (user) {
      const update = { $set: {} };
      if (passwordHash) update.$set.passwordHash = passwordHash;
      if (!user.isActive) update.$set.isActive = true;
      if (Object.keys(update.$set).length > 0) {
        update.$inc = { authVersion: 1 };
        user = await User.findOneAndUpdate({ _id: user._id, orgId: request.orgId }, update, { new: true });
      }
    } else {
      user = await User.create({
        email: request.email,
        passwordHash,
        name: invitation.name,
        orgId: request.orgId,
        role: 'admin',
        isActive: true,
      });
    }
    if (!user) {
      await AccessRequest.updateOne(
        { _id: claimed._id },
        { $set: { status: 'pending', reviewedBy: null, reviewedAt: null, reviewNote: '' } }
      );
      return res.status(409).json({ error: 'Account could not be activated' });
    }

    if (invitation) {
      await TenantInvitation.updateOne(
        { _id: invitation._id, status: 'pending' },
        { $set: { status: 'accepted', usedAt: now } }
      );
    }
    await Org.updateOne(
      { _id: request.orgId, lifecycleStatus: 'pending_admin' },
      { $set: { lifecycleStatus: 'active', activatedAt: now } }
    );
    await PlatformAuditLog.create({
      actorAdminId: req.platformAdmin.id,
      action: 'tenant_admin_access_approved',
      tenantId: request.orgId,
      targetId: String(user._id),
      changes: { email: request.email, passwordProvisioned: Boolean(passwordHash) },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      id: claimed._id,
      status: 'approved',
      tenantId: request.orgId,
      email: request.email,
    });
  } catch {
    return res.status(500).json({ error: 'Access request approval failed' });
  }
});

router.post('/access-requests/:id/reject', requirePlatformRole('super_admin'), async (req, res) => {
  const parsed = AccessReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid access review' });

  try {
    const request = await AccessRequest.findOne({ _id: req.params.id, scope: 'tenant_admin' });
    if (!request) return res.status(404).json({ error: 'Access request not found' });

    const reviewed = await AccessRequest.findOneAndUpdate(
      { _id: request._id, status: 'pending' },
      { $set: { status: 'rejected', reviewedBy: String(req.platformAdmin.id), reviewedAt: new Date(), reviewNote: parsed.data.note ?? '' } },
      { new: true }
    );
    if (!reviewed) return res.status(409).json({ error: 'Access request already reviewed' });

    await PlatformAuditLog.create({
      actorAdminId: req.platformAdmin.id,
      action: 'tenant_admin_access_rejected',
      tenantId: request.orgId,
      targetId: request.email,
      changes: { note: parsed.data.note ?? '' },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ id: reviewed._id, status: 'rejected' });
  } catch {
    return res.status(500).json({ error: 'Access request rejection failed' });
  }
});

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

    if (parsed.data.adminPassword) {
      // Direct provisioning: an administrator-set credential activates both the
      // tenant and its first administrator immediately, with no invitation.
      const passwordHash = await bcrypt.hash(parsed.data.adminPassword, 12);
      const org = await Org.create({
        name: parsed.data.name,
        lifecycleStatus: 'active',
        activatedAt: now,
        securityScore: 100,
        monitoredDomains: ['chat.openai.com', 'claude.ai', 'gemini.google.com'],
        policyVersion: 1,
        settings: { blockOnHigh: true, requireJustification: true, alertOnMedium: true, defaultAction: 'BLOCK' },
      });
      await User.create({
        email: adminEmail,
        passwordHash,
        name: parsed.data.adminName,
        orgId: org._id,
        role: 'admin',
        isActive: true,
      });
      await PlatformAuditLog.create({
        actorAdminId: req.platformAdmin.id,
        action: 'tenant_created',
        tenantId: org._id,
        targetId: String(org._id),
        changes: { name: org.name, lifecycleStatus: 'active' },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      await PlatformAuditLog.create({
        actorAdminId: req.platformAdmin.id,
        action: 'tenant_admin_provisioned',
        tenantId: org._id,
        targetId: adminEmail,
        changes: { activatedAt: now },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return res.status(201).json({
        tenant: { id: org._id, name: org.name, lifecycleStatus: 'active' },
        provisioned: { email: adminEmail },
      });
    }

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
