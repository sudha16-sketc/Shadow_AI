// backend/src/middleware/auth.js for authentication and authorization 
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/security.js';
import { Device, Org, PlatformAdmin, User } from '../models/index.js';
import { hashDeviceCredential } from '../utils/device-credentials.js';

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

export function getBearerToken(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  return authorization.slice(7).trim() || null;
}

export async function authMiddleware(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    if (token.startsWith('dvc_')) {
      const device = await Device.findOne({ tokenHash: hashDeviceCredential(token), isActive: true, revokedAt: null });
      if (!device) return res.status(401).json({ error: 'Invalid or revoked device credential' });

      const user = await User.findOne({ _id: device.userId, orgId: device.orgId, isActive: true });
      if (!user) return res.status(401).json({ error: 'Device owner is inactive' });
      const org = await Org.findOne({ _id: device.orgId, lifecycleStatus: 'active' });
      if (!org) return res.status(401).json({ error: 'Tenant is not active' });

      req.user = {
        userId: String(user._id),
        orgId: String(user.orgId),
        role: 'device',
        authType: 'device',
        deviceId: String(device.deviceId),
      };
      req.authUser = user;
      req.tenantId = req.user.orgId;
      Device.updateOne({ _id: device._id, orgId: device.orgId, isActive: true }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
      return next();
    }

    const decoded = verifyToken(token);
    if (decoded?.tokenType !== 'user' || !decoded?.userId || !decoded?.orgId) {
      return res.status(401).json({ error: 'Token missing user tenant context' });
    }

    const user = await User.findOne({ _id: decoded.userId, orgId: decoded.orgId, isActive: true });
    if (!user || (decoded.authVersion ?? 0) !== (user.authVersion ?? 0)) {
      return res.status(401).json({ error: 'Invalid or revoked user credential' });
    }
    const org = await Org.findOne({ _id: user.orgId, lifecycleStatus: 'active' });
    if (!org) return res.status(401).json({ error: 'Tenant is not active' });

    req.user = {
      userId: String(user._id),
      orgId: String(user.orgId),
      role: user.role,
      authType: 'user',
    };
    req.authUser = user;
    req.tenantId = req.user.orgId;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireUserAuth(req, res, next) {
  if (req.user?.authType !== 'user') return res.status(403).json({ error: 'User authentication required' });
  next();
}

export function requireDeviceAuth(req, res, next) {
  if (req.user?.authType !== 'device') return res.status(403).json({ error: 'Registered device authentication required' });
  next();
}

export function requireTenantAccess(req, res, next) {
  const userOrgId = req.user?.orgId?.toString();
  if (!userOrgId) {
    return res.status(403).json({ error: 'Tenant context missing' });
  }

  const params = req.params ?? {};
  const query = req.query ?? {};
  const body = req.body ?? {};

  const candidateOrgId = (
    params.orgId ??
    query.orgId ??
    body.orgId ??
    body.tenantId ??
    body.organizationId
  )?.toString();

  if (candidateOrgId && candidateOrgId !== userOrgId) {
    return res.status(403).json({ error: 'Cross-tenant access denied' });
  }

  req.tenantId = userOrgId;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

export async function platformAdminAuthMiddleware(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = verifyToken(token);
    if (decoded?.tokenType !== 'platform_admin' || !decoded?.platformAdminId) {
      return res.status(401).json({ error: 'Platform administrator credential required' });
    }

    const admin = await PlatformAdmin.findOne({ _id: decoded.platformAdminId, isActive: true });
    if (!admin || (decoded.authVersion ?? 0) !== (admin.authVersion ?? 0)) {
      return res.status(401).json({ error: 'Invalid or revoked platform credential' });
    }

    // Role is resolved from the server-side record on every request so a
    // downgraded or revoked role cannot be preserved by a previously issued
    // token claim.
    req.platformAdmin = {
      id: String(admin._id),
      email: admin.email,
      role: admin.role ?? 'super_admin',
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired platform credential' });
  }
}

/**
 * Restrict a platform route to one or more platform roles.
 * Must run after platformAdminAuthMiddleware.
 */
export function requirePlatformRole(...roles) {
  return (req, res, next) => {
    if (!req.platformAdmin || !roles.includes(req.platformAdmin.role)) {
      return res.status(403).json({ error: 'Insufficient platform privileges' });
    }
    return next();
  };
}