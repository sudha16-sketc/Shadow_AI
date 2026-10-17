/**
 * Access-approval workflow tests.
 *
 * Covers the tenant/developer activation flow end to end: the public request
 * endpoint, platform review of tenant-administrator requests, tenant review of
 * developer requests, tenant isolation, and the no-enumeration guarantees.
 * No MongoDB and no network: models are in-memory and `fetch` is a spy (see
 * tests/helpers/mock-app.js).
 */
import bcrypt from 'bcryptjs';

const app = await import('./helpers/mock-app.js');
const {
  state, resetState, start, stop, httpRequest,
  seedOrg, seedUser, userToken, platformToken, seedPlatformAdmin,
} = app;

beforeAll(async () => { await start(); });
afterAll(async () => { await stop(); });
beforeEach(() => resetState());

const TENANT_ADMIN_PASSWORD = 'tenant-admin-password-01';
const DEVELOPER_PASSWORD = 'developer-password-01';
const ADMIN_PASSWORD = 'admin-password-01';

const requestAccess = (email) =>
  httpRequest('/api/auth/access-request', { method: 'POST', body: { email } });

const listPlatformRequests = (token, query = '?status=pending') =>
  httpRequest(`/api/platform-admin/access-requests${query}`, { token });

const approvePlatform = (token, id, body) =>
  httpRequest(`/api/platform-admin/access-requests/${id}/approve`, { token, method: 'POST', body });

const rejectPlatform = (token, id, body = {}) =>
  httpRequest(`/api/platform-admin/access-requests/${id}/reject`, { token, method: 'POST', body });

const listTenantRequests = (token, query = '?status=pending') =>
  httpRequest(`/api/users/access-requests${query}`, { token });

const approveTenant = (token, id, body) =>
  httpRequest(`/api/users/access-requests/${id}/approve`, { token, method: 'POST', body });

const rejectTenant = (token, id, body = {}) =>
  httpRequest(`/api/users/access-requests/${id}/reject`, { token, method: 'POST', body });

function seedPendingInvitation(org, overrides = {}) {
  const invitation = {
    _id: `invitation-${Math.random().toString(36).slice(2)}`,
    orgId: org._id,
    email: 'new-admin@example.test',
    name: 'New Admin',
    tokenHash: `hash-${Math.random().toString(36).slice(2)}`,
    expiresAt: new Date(Date.now() + 60 * 60_000),
    usedAt: null,
    status: 'pending',
    issuedByAdminId: 'platform-admin-x',
    ...overrides,
  };
  state.invitations.push(invitation);
  return invitation;
}

async function seedAdminUser(org, overrides = {}) {
  return seedUser(org, {
    email: 'tenant-admin@example.test',
    role: 'admin',
    passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 4),
    ...overrides,
  });
}

async function loginTenant(email, password) {
  return httpRequest('/api/auth/login', { method: 'POST', body: { email, password } });
}

// ─── Public request endpoint ─────────────────────────────────────────────────

describe('POST /api/auth/access-request', () => {
  it('records a tenant-administrator request for a pending invitation and returns a generic ack', async () => {
    const org = seedOrg({ lifecycleStatus: 'pending_admin' });
    seedPendingInvitation(org, { email: 'new-admin@example.test' });

    const res = await requestAccess('new-admin@example.test');

    expect(res.status).toBe(202);
    expect(res.data.message).toMatch(/access request/i);
    expect(state.accessRequests).toHaveLength(1);
    expect(state.accessRequests[0]).toMatchObject({
      scope: 'tenant_admin',
      status: 'pending',
      orgId: org._id,
      userId: null,
      email: 'new-admin@example.test',
    });
    expect(state.audits.some(a => a.action === 'access_requested')).toBe(true);
  });

  it('scopes a developer request to the inactive account and its tenant', async () => {
    const org = seedOrg();
    const dev = seedUser(org, {
      email: 'dev@example.test',
      role: 'viewer',
      isActive: false,
      passwordHash: await bcrypt.hash(DEVELOPER_PASSWORD, 4),
    });

    const res = await requestAccess('dev@example.test');

    expect(res.status).toBe(202);
    expect(state.accessRequests[0]).toMatchObject({
      scope: 'developer',
      orgId: org._id,
      userId: dev._id,
    });
  });

  it('classifies an inactive administrator as a tenant-administrator request', async () => {
    const org = seedOrg();
    const admin = seedUser(org, {
      email: 'reader@example.test',
      role: 'admin',
      isActive: false,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 4),
    });

    await requestAccess('reader@example.test');

    expect(state.accessRequests[0]).toMatchObject({ scope: 'tenant_admin', userId: admin._id });
  });

  it('returns the same acknowledgement for unknown emails and records nothing', async () => {
    const ack = (await requestAccess('new-admin@example.test')).data.message;
    const unknown = await requestAccess('nobody@example.test');

    expect(unknown.status).toBe(202);
    expect(unknown.data.message).toBe(ack);
    expect(state.accessRequests).toHaveLength(0);
  });

  it('ignores already-active accounts', async () => {
    const org = seedOrg();
    seedUser(org, { email: 'active@example.test', isActive: true, passwordHash: await bcrypt.hash('x', 4) });

    const res = await requestAccess('active@example.test');

    expect(res.status).toBe(202);
    expect(state.accessRequests).toHaveLength(0);
  });

  it('does not create a second pending request for the same account', async () => {
    const org = seedOrg({ lifecycleStatus: 'pending_admin' });
    seedPendingInvitation(org, { email: 'new-admin@example.test' });

    await requestAccess('new-admin@example.test');
    await requestAccess('new-admin@example.test');

    expect(state.accessRequests).toHaveLength(1);
  });

  it('rejects malformed email input and extra fields', async () => {
    expect((await requestAccess('not-an-email')).status).toBe(400);
    const extra = await httpRequest('/api/auth/access-request', {
      method: 'POST', body: { email: 'a@example.test', scope: 'tenant_admin' },
    });
    expect(extra.status).toBe(400);
  });
});

// ─── Platform review of tenant-administrator requests ────────────────────────

describe('platform review of tenant-administrator requests', () => {
  async function arrange() {
    const org = seedOrg({ lifecycleStatus: 'pending_admin' });
    const invitation = seedPendingInvitation(org, { email: 'new-admin@example.test' });
    await requestAccess('new-admin@example.test');
    return { org, invitation, id: state.accessRequests[0]._id, token: platformToken(seedPlatformAdmin()) };
  }

  it('lists pending tenant-administrator requests with tenant context and no credential leakage', async () => {
    const { org, token } = await arrange();

    const res = await listPlatformRequests(token);

    expect(res.status).toBe(200);
    expect(res.data.requests).toHaveLength(1);
    expect(res.data.requests[0]).toMatchObject({
      scope: 'tenant_admin',
      status: 'pending',
      tenantName: org.name,
      email: 'new-admin@example.test',
      hasPassword: false,
    });
    expect(JSON.stringify(res.data)).not.toContain('passwordHash');
  });

  it('hides developer requests from the platform console', async () => {
    const org = seedOrg();
    seedUser(org, { email: 'dev@example.test', role: 'viewer', isActive: false, passwordHash: await bcrypt.hash('x', 4) });
    await requestAccess('dev@example.test');
    const token = platformToken(seedPlatformAdmin());

    const res = await listPlatformRequests(token);

    expect(res.status).toBe(200);
    expect(res.data.requests).toHaveLength(0);
  });

  it('lets managers list but not approve or reject, and blocks anonymous callers', async () => {
    const { id, token } = await arrange();
    const manager = platformToken(seedPlatformAdmin({ role: 'manager' }));

    expect((await listPlatformRequests(manager)).status).toBe(200);
    expect((await approvePlatform(manager, id, { password: TENANT_ADMIN_PASSWORD })).status).toBe(403);
    expect((await rejectPlatform(manager, id)).status).toBe(403);
    expect((await listPlatformRequests(undefined)).status).toBe(401);
  });

  it('activates the tenant and administrator when approved with a password', async () => {
    const { org, invitation, id, token } = await arrange();

    const res = await approvePlatform(token, id, { password: TENANT_ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ status: 'approved', tenantId: org._id, email: 'new-admin@example.test' });

    const user = state.users.find(u => u.email === 'new-admin@example.test');
    expect(user).toMatchObject({ role: 'admin', isActive: true, orgId: org._id });
    expect(user.passwordHash).toBeTruthy();
    expect(state.orgs.find(o => String(o._id) === String(org._id)).lifecycleStatus).toBe('active');
    expect(state.invitations.find(i => String(i._id) === String(invitation._id)).status).toBe('accepted');
    expect(state.platformAudits.some(a => a.action === 'tenant_admin_access_approved')).toBe(true);

    const login = await loginTenant('new-admin@example.test', TENANT_ADMIN_PASSWORD);
    expect(login.status).toBe(200);
  });

  it('requires a password when the account has no credential yet', async () => {
    const { id, token } = await arrange();

    const res = await approvePlatform(token, id, {});

    expect(res.status).toBe(400);
    expect(state.accessRequests[0].status).toBe('pending');
    expect(state.users.some(u => u.email === 'new-admin@example.test')).toBe(false);
  });

  it('activates an existing inactive administrator without a new password', async () => {
    const org = seedOrg();
    const admin = seedUser(org, {
      email: 'reader@example.test',
      role: 'admin',
      isActive: false,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 4),
    });
    await requestAccess('reader@example.test');
    const token = platformToken(seedPlatformAdmin());
    const id = state.accessRequests[0]._id;

    const res = await approvePlatform(token, id, {});

    expect(res.status).toBe(200);
    expect(state.users.find(u => String(u._id) === String(admin._id)).isActive).toBe(true);
    expect((await loginTenant('reader@example.test', ADMIN_PASSWORD)).status).toBe(200);
  });

  it('rejects a request without activating the account, and allows a fresh request afterwards', async () => {
    const { id, token } = await arrange();

    const res = await rejectPlatform(token, id, { note: 'Not eligible' });

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('rejected');
    expect(state.users.some(u => u.email === 'new-admin@example.test')).toBe(false);
    expect(state.platformAudits.some(a => a.action === 'tenant_admin_access_rejected')).toBe(true);

    await requestAccess('new-admin@example.test');
    expect(state.accessRequests.filter(r => r.status === 'pending')).toHaveLength(1);
  });

  it('refuses to review the same request twice and rejects unknown ids', async () => {
    const { id, token } = await arrange();

    expect((await approvePlatform(token, id, { password: TENANT_ADMIN_PASSWORD })).status).toBe(200);
    expect((await approvePlatform(token, id, { password: TENANT_ADMIN_PASSWORD })).status).toBe(409);
    expect((await rejectPlatform(token, id)).status).toBe(409);
    expect((await approvePlatform(token, 'missing-id', { password: TENANT_ADMIN_PASSWORD })).status).toBe(404);
  });

  it('never returns credentials or secrets in review responses', async () => {
    const { id, token } = await arrange();

    const res = await approvePlatform(token, id, { password: TENANT_ADMIN_PASSWORD });

    const body = JSON.stringify(res.data);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain(TENANT_ADMIN_PASSWORD);
  });
});

// ─── Direct tenant provisioning with a password ──────────────────────────────

describe('direct provisioning with an administrator password', () => {
  async function provision(body) {
    return httpRequest('/api/platform-admin/tenants', {
      token: platformToken(seedPlatformAdmin()), method: 'POST', body,
    });
  }

  it('creates an active tenant and administrator without an invitation', async () => {
    const res = await provision({
      name: 'Direct Co', adminName: 'Boss', adminEmail: 'boss@example.test', adminPassword: 'direct-admin-password-01',
    });

    expect(res.status).toBe(201);
    expect(res.data.provisioned).toMatchObject({ email: 'boss@example.test' });
    expect(res.data.invitation).toBeUndefined();
    const org = state.orgs.find(o => o.name === 'Direct Co');
    expect(org.lifecycleStatus).toBe('active');
    expect(state.users.find(u => u.email === 'boss@example.test')).toMatchObject({ role: 'admin', isActive: true });
    expect(state.invitations).toHaveLength(0);

    expect((await loginTenant('boss@example.test', 'direct-admin-password-01')).status).toBe(200);
  });

  it('still issues an invitation when no password is supplied', async () => {
    const res = await provision({ name: 'Invite Co', adminName: 'Boss', adminEmail: 'invite@example.test' });

    expect(res.status).toBe(201);
    expect(res.data.invitation).toMatchObject({ email: 'invite@example.test' });
    expect(state.accessRequests).toHaveLength(0);
  });

  it('rejects an administrator password below the minimum length', async () => {
    const res = await provision({
      name: 'Short Co', adminName: 'Boss', adminEmail: 'short@example.test', adminPassword: 'too-short',
    });

    expect(res.status).toBe(400);
  });
});

// ─── Developer activation by the tenant administrator ────────────────────────

describe('tenant review of developer requests', () => {
  it('lets an administrator list and approve a developer, who can then log in', async () => {
    const org = seedOrg();
    const admin = await seedAdminUser(org);
    const dev = seedUser(org, {
      email: 'dev@example.test',
      role: 'viewer',
      isActive: false,
      passwordHash: await bcrypt.hash(DEVELOPER_PASSWORD, 4),
    });
    await requestAccess('dev@example.test');
    const token = userToken(admin);

    const list = await listTenantRequests(token);
    expect(list.status).toBe(200);
    expect(list.data.requests).toHaveLength(1);
    expect(list.data.requests[0]).toMatchObject({ email: 'dev@example.test', name: dev.name, hasPassword: true });

    const res = await approveTenant(token, state.accessRequests[0]._id, {});
    expect(res.status).toBe(200);
    expect(state.users.find(u => String(u._id) === String(dev._id)).isActive).toBe(true);
    expect((await loginTenant('dev@example.test', DEVELOPER_PASSWORD)).status).toBe(200);
  });

  it('requires a password when the developer account has no credential', async () => {
    const org = seedOrg();
    const admin = await seedAdminUser(org);
    seedUser(org, { email: 'dev@example.test', role: 'viewer', isActive: false });
    await requestAccess('dev@example.test');
    const token = userToken(admin);
    const id = state.accessRequests[0]._id;

    const missing = await approveTenant(token, id, {});
    expect(missing.status).toBe(400);

    const supplied = await approveTenant(token, id, { password: DEVELOPER_PASSWORD });
    expect(supplied.status).toBe(200);
    const dev = state.users.find(u => u.email === 'dev@example.test');
    expect(dev.isActive).toBe(true);
    expect(dev.passwordHash).toBeTruthy();
  });

  it('rejects a developer request without activating the account', async () => {
    const org = seedOrg();
    const admin = await seedAdminUser(org);
    seedUser(org, { email: 'dev@example.test', role: 'viewer', isActive: false, passwordHash: await bcrypt.hash('x', 4) });
    await requestAccess('dev@example.test');
    const token = userToken(admin);

    const res = await rejectTenant(token, state.accessRequests[0]._id, { note: 'No' });

    expect(res.status).toBe(200);
    expect(state.accessRequests[0].status).toBe('rejected');
    expect(state.users.find(u => u.email === 'dev@example.test').isActive).toBe(false);
    expect(state.audits.some(a => a.action === 'developer_access_rejected')).toBe(true);
  });

  it('hides and refuses another tenant\'s developer request', async () => {
    const orgA = seedOrg();
    const orgB = seedOrg();
    const adminA = await seedAdminUser(orgA);
    seedUser(orgB, { email: 'devb@example.test', role: 'viewer', isActive: false, passwordHash: await bcrypt.hash('x', 4) });
    await requestAccess('devb@example.test');
    const token = userToken(adminA);
    const id = state.accessRequests[0]._id;

    const list = await listTenantRequests(token);
    expect(list.status).toBe(200);
    expect(list.data.requests).toHaveLength(0);

    expect((await approveTenant(token, id, { password: DEVELOPER_PASSWORD })).status).toBe(404);
    expect((await rejectTenant(token, id)).status).toBe(404);
  });

  it('restricts developer review to administrators', async () => {
    const org = seedOrg();
    const viewer = seedUser(org, { role: 'viewer', passwordHash: await bcrypt.hash(DEVELOPER_PASSWORD, 4) });
    const token = userToken(viewer);

    expect((await listTenantRequests(token)).status).toBe(403);
    expect((await approveTenant(token, 'some-id', { password: DEVELOPER_PASSWORD })).status).toBe(403);
  });
});

// ─── User creation activation flag ───────────────────────────────────────────

describe('POST /api/users activation flag', () => {
  async function createUser(token, body) {
    return httpRequest('/api/users', { token, method: 'POST', body });
  }

  it('provisions an inactive account when activate is false', async () => {
    const org = seedOrg();
    const admin = await seedAdminUser(org);

    const res = await createUser(userToken(admin), {
      email: 'pending@example.test', password: DEVELOPER_PASSWORD, name: 'Pending', role: 'viewer', activate: false,
    });

    expect(res.status).toBe(201);
    const created = state.users.find(u => u.email === 'pending@example.test');
    expect(created.isActive).toBe(false);
    expect(JSON.stringify(res.data)).not.toContain('passwordHash');
  });

  it('activates by default and permits a subsequent request-and-approval cycle', async () => {
    const org = seedOrg();
    const admin = await seedAdminUser(org);

    const active = await createUser(userToken(admin), {
      email: 'live@example.test', password: DEVELOPER_PASSWORD, name: 'Live', role: 'viewer',
    });
    expect(active.status).toBe(201);
    expect(state.users.find(u => u.email === 'live@example.test').isActive).toBe(true);

    const pending = await createUser(userToken(admin), {
      email: 'later@example.test', password: DEVELOPER_PASSWORD, name: 'Later', role: 'viewer', activate: false,
    });
    expect(pending.status).toBe(201);

    await requestAccess('later@example.test');
    const review = await approveTenant(userToken(admin), state.accessRequests[0]._id, {});
    expect(review.status).toBe(200);
    expect(state.users.find(u => u.email === 'later@example.test').isActive).toBe(true);
  });
});
