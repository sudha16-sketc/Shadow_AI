/**
 * Authentication & tenant-onboarding regression tests.
 *
 * Evidence for docs/AUTHENTICATION_TEST_REPORT.md. Covers the properties behind
 * the login fix: platform administrators and tenant users are distinct account
 * types with distinct endpoints, invitations are single-use and time-boxed, and
 * tenant isolation is preserved. No MongoDB and no network: models are in-memory
 * and `fetch` is a spy (see tests/helpers/mock-app.js).
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = await import('./helpers/mock-app.js');
const {
  state, resetState, start, stop, httpRequest, seedOrg, seedUser, userToken, TEST_SECRET,
} = app;

beforeAll(async () => { await start(); });
afterAll(async () => { await stop(); });
beforeEach(() => resetState());

const PLATFORM_EMAIL = 'platform-admin@example.test';
const PLATFORM_PASSWORD = 'platform-admin-password-01';

async function seedPlatformAdmin(overrides = {}) {
  const admin = {
    _id: `platform-admin-${Math.random().toString(36).slice(2)}`,
    email: PLATFORM_EMAIL,
    passwordHash: await bcrypt.hash(PLATFORM_PASSWORD, 4),
    authVersion: 0,
    isActive: true,
    ...overrides,
  };
  state.platformAdmins.push(admin);
  return admin;
}

const loginPlatform = (body) => httpRequest('/api/platform-admin/auth/login', { method: 'POST', body });
const loginTenant = (body) => httpRequest('/api/auth/login', { method: 'POST', body });

describe('account-type separation', () => {
  it('authenticates a provisioned platform administrator through the platform-admin endpoint', async () => {
    await seedPlatformAdmin();

    const res = await loginPlatform({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.data.platformAdmin.email).toBe(PLATFORM_EMAIL);
    const decoded = jwt.verify(res.data.token, TEST_SECRET, { algorithms: ['HS256'] });
    expect(decoded.tokenType).toBe('platform_admin');
    expect(decoded.platformAdminId).toBeDefined();
  });

  it('rejects platform-admin credentials on the tenant login endpoint', async () => {
    await seedPlatformAdmin();

    const res = await loginTenant({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.data).toEqual({ error: 'Invalid credentials' });
  });

  it('authenticates a valid tenant administrator through the tenant endpoint', async () => {
    const org = seedOrg();
    const passwordHash = await bcrypt.hash('tenant-admin-password-01', 4);
    const user = seedUser(org, { email: 'tenant-admin@example.test', role: 'admin', passwordHash });

    const res = await loginTenant({ email: user.email, password: 'tenant-admin-password-01' });

    expect(res.status).toBe(200);
    expect(res.data.user.orgId).toBe(org._id);
    const decoded = jwt.verify(res.data.token, TEST_SECRET, { algorithms: ['HS256'] });
    expect(decoded.tokenType).toBe('user');
  });

  it('rejects tenant-user tokens on platform-admin endpoints', async () => {
    const org = seedOrg();
    const user = seedUser(org, { role: 'admin' });

    const res = await httpRequest('/api/platform-admin/tenants', {
      token: userToken(user),
      method: 'POST',
      body: { name: 'Ghost', adminName: 'Ghost', adminEmail: 'ghost@example.test' },
    });

    expect(res.status).toBe(401);
  });

  it('requires a platform credential to list tenants', async () => {
    const res = await httpRequest('/api/platform-admin/tenants');
    expect(res.status).toBe(401);
  });
});

describe('password verification', () => {
  it('compares against a bcrypt hash rather than storing plaintext', async () => {
    const org = seedOrg();
    const plaintext = 'super-secret-password-01';
    const passwordHash = await bcrypt.hash(plaintext, 4);
    const user = seedUser(org, { email: 'bcrypt@example.test', passwordHash });

    expect(passwordHash.startsWith('$2')).toBe(true);
    expect(passwordHash).not.toBe(plaintext);
    expect((await loginTenant({ email: user.email, password: plaintext })).status).toBe(200);
  });

  it('rejects incorrect passwords for both account types', async () => {
    await seedPlatformAdmin();
    const org = seedOrg();
    const passwordHash = await bcrypt.hash('correct-password-0001', 4);
    const user = seedUser(org, { email: 'wrong-pass@example.test', passwordHash });

    expect((await loginPlatform({ email: PLATFORM_EMAIL, password: 'wrong-password-0001' })).status).toBe(401);
    expect((await loginTenant({ email: user.email, password: 'wrong-password-0001' })).status).toBe(401);
  });

  it('rejects inactive accounts and tenants that are not active', async () => {
    await seedPlatformAdmin({ isActive: false });
    expect((await loginPlatform({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD })).status).toBe(401);

    const activeOrg = seedOrg();
    const inactiveUser = seedUser(activeOrg, {
      email: 'inactive@example.test',
      isActive: false,
      passwordHash: await bcrypt.hash('tenant-admin-password-02', 4),
    });
    expect((await loginTenant({ email: inactiveUser.email, password: 'tenant-admin-password-02' })).status).toBe(401);

    const pendingOrg = seedOrg({ lifecycleStatus: 'pending_admin' });
    const pendingAdmin = seedUser(pendingOrg, {
      email: 'pending@example.test',
      role: 'admin',
      passwordHash: await bcrypt.hash('tenant-admin-password-03', 4),
    });
    expect((await loginTenant({ email: pendingAdmin.email, password: 'tenant-admin-password-03' })).status).toBe(401);
  });
});

describe('token validation', () => {
  it('rejects missing, malformed, wrong-type, and context-less tokens', async () => {
    expect((await httpRequest('/api/users')).status).toBe(401);
    expect((await httpRequest('/api/users', { token: 'not-a-jwt' })).status).toBe(401);

    const wrongType = jwt.sign(
      { tokenType: 'platform_admin', platformAdminId: 'someone' },
      TEST_SECRET,
      { algorithm: 'HS256', expiresIn: '5m' },
    );
    expect((await httpRequest('/api/users', { token: wrongType })).status).toBe(401);

    const missingOrg = jwt.sign({ tokenType: 'user', userId: 'user-x' }, TEST_SECRET, { algorithm: 'HS256' });
    expect((await httpRequest('/api/users', { token: missingOrg })).status).toBe(401);
  });

  it('enforces tenant isolation on tenant-scoped routes', async () => {
    const orgA = seedOrg();
    const orgB = seedOrg();
    const passwordHash = await bcrypt.hash('tenant-admin-password-04', 4);
    const userA = seedUser(orgA, { email: 'a@example.test', role: 'admin', passwordHash });

    const login = await loginTenant({ email: userA.email, password: 'tenant-admin-password-04' });
    expect(login.status).toBe(200);

    const own = await httpRequest('/api/settings/org', { token: login.data.token });
    expect(own.status).toBe(200);

    const forged = await httpRequest(`/api/settings/org?orgId=${orgB._id}`, { token: login.data.token });
    expect(forged.status).toBe(403);
  });
});

describe('invitation onboarding', () => {
  async function provisionTenant(overrides = {}) {
    await seedPlatformAdmin();
    const platform = await loginPlatform({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD });
    const created = await httpRequest('/api/platform-admin/tenants', {
      token: platform.data.token,
      method: 'POST',
      body: { name: 'Acme Corp', adminName: 'Sec Admin', adminEmail: 'sec@example.test', ...overrides },
    });
    return { platformToken: platform.data.token, created };
  }

  it('accepts an invitation and produces a usable tenant administrator', async () => {
    const { created } = await provisionTenant();
    expect(created.status).toBe(201);
    expect(created.data.tenant.lifecycleStatus).toBe('pending_admin');
    const storedInvitation = state.invitations[0];
    expect(storedInvitation.tokenHash).not.toBe(created.data.invitation.token);

    const accepted = await httpRequest('/api/platform-admin/invitations/accept', {
      method: 'POST',
      body: { token: created.data.invitation.token, password: 'tenant-admin-password-05' },
    });
    expect(accepted.status).toBe(201);

    const login = await loginTenant({ email: 'sec@example.test', password: 'tenant-admin-password-05' });
    expect(login.status).toBe(200);

    const dashboard = await httpRequest('/api/settings/org', { token: login.data.token });
    expect(dashboard.status).toBe(200);
    expect(state.orgs.find(org => String(org._id) === String(created.data.tenant.id)).lifecycleStatus).toBe('active');
    expect(state.users.find(user => user.email === 'sec@example.test')).toMatchObject({ role: 'admin', isActive: true });
  });

  it('rejects reused and expired invitations', async () => {
    const { created } = await provisionTenant();
    const accept = (token) => httpRequest('/api/platform-admin/invitations/accept', {
      method: 'POST',
      body: { token, password: 'tenant-admin-password-06' },
    });

    expect((await accept(created.data.invitation.token)).status).toBe(201);
    expect((await accept(created.data.invitation.token)).status).toBe(401);

    const second = await provisionTenant({ adminEmail: 'expired@example.test' });
    const invitation = state.invitations.find(
      record => String(record.orgId) === String(second.created.data.tenant.id),
    );
    invitation.expiresAt = new Date(Date.now() - 1);

    expect((await accept(second.created.data.invitation.token)).status).toBe(401);
    expect(state.orgs.find(org => String(org._id) === String(second.created.data.tenant.id)).lifecycleStatus).toBe('pending_admin');
    expect(state.users.some(user => user.email === 'expired@example.test')).toBe(false);
  });

  it('lists tenants for the platform console without leaking tokens', async () => {
    const { platformToken, created } = await provisionTenant();

    const list = await httpRequest('/api/platform-admin/tenants', { token: platformToken });

    expect(list.status).toBe(200);
    const tenant = list.data.tenants.find(item => String(item.id) === String(created.data.tenant.id));
    expect(tenant).toMatchObject({ lifecycleStatus: 'pending_admin', pendingInvitationEmail: 'sec@example.test' });
    expect(JSON.stringify(list.data)).not.toContain(created.data.invitation.token);
    expect(tenant.tokenHash).toBeUndefined();
  });
});
