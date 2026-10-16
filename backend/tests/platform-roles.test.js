/**
 * Platform role & monitoring regression tests (Phase 2).
 *
 * Verifies the platform-plane privilege model and the platform-wide monitoring
 * API added in the platform-management work:
 *   - platform identities are distinct from tenant users
 *   - roles are resolved server-side (a token cannot claim a higher role)
 *   - only super administrators manage platform accounts / tenants
 *   - managers may monitor and annotate investigations
 *   - authentication telemetry is recorded, masked, and never leaks secrets
 *
 * No MongoDB and no network: models are in-memory and `fetch` is a spy.
 */
import bcrypt from 'bcryptjs';

const app = await import('./helpers/mock-app.js');
const {
  state, resetState, start, stop, httpRequest,
  seedOrg, seedUser, userToken, seedPlatformAdmin, seedEvent, platformToken,
} = app;

beforeAll(async () => { await start(); });
afterAll(async () => { await stop(); });
beforeEach(() => resetState());

const settle = () => new Promise(resolve => setTimeout(resolve, 15));
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('platform-plane authentication', () => {
  it('rejects tenant user tokens on platform endpoints', async () => {
    const org = seedOrg();
    const user = seedUser(org);
    const res = await httpRequest('/api/platform-admin/monitoring/overview', { token: userToken(user) });
    expect(res.status).toBe(401);
  });

  it('rejects requests with no credential', async () => {
    const res = await httpRequest('/api/platform-admin/monitoring/overview');
    expect(res.status).toBe(401);
  });

  it('resolves the role from the database, not the token claim', async () => {
    const manager = seedPlatformAdmin({ role: 'manager' });
    // Forge a token that claims super_admin for a manager account.
    const forged = platformToken({ ...manager, role: 'super_admin' });

    const res = await httpRequest('/api/platform-admin/managers', { method: 'POST', token: forged, body: {
      email: 'new-manager@example.test', password: 'a-very-long-password-16',
    } });

    expect(res.status).toBe(403);
  });

  it('rejects credentials issued before a role/auth-version change', async () => {
    const manager = seedPlatformAdmin({ role: 'manager', authVersion: 0 });
    const token = platformToken(manager);

    const superAdmin = seedPlatformAdmin();
    const deactivate = await httpRequest(`/api/platform-admin/managers/${manager._id}`, {
      method: 'PATCH', token: platformToken(superAdmin), body: { isActive: false },
    });
    expect(deactivate.status).toBe(200);

    const res = await httpRequest('/api/platform-admin/monitoring/overview', { token });
    expect(res.status).toBe(401);
  });
});

describe('super-administrator-only operations', () => {
  it('lets a super administrator list and create managers without leaking hashes', async () => {
    const superAdmin = seedPlatformAdmin();
    seedPlatformAdmin({ role: 'manager' });
    const token = platformToken(superAdmin);

    const list = await httpRequest('/api/platform-admin/managers', { token });
    expect(list.status).toBe(200);
    expect(list.data.managers).toHaveLength(1);
    expect(JSON.stringify(list.data)).not.toMatch(/passwordHash|\$2[aby]\$/);

    const created = await httpRequest('/api/platform-admin/managers', {
      method: 'POST', token, body: { email: 'manager-one@example.test', password: 'manager-password-0001' },
    });
    expect(created.status).toBe(201);
    expect(created.data.manager.role).toBe('manager');
    expect(created.data.manager.passwordHash).toBeUndefined();

    const duplicate = await httpRequest('/api/platform-admin/managers', {
      method: 'POST', token, body: { email: 'manager-one@example.test', password: 'manager-password-0002' },
    });
    expect(duplicate.status).toBe(409);
  });

  it('denies managers the ability to create tenants or manage platform accounts', async () => {
    const manager = seedPlatformAdmin({ role: 'manager' });
    const token = platformToken(manager);

    const createTenant = await httpRequest('/api/platform-admin/tenants', {
      method: 'POST', token, body: { name: 'Acme', adminName: 'A', adminEmail: 'a@acme.test' },
    });
    expect(createTenant.status).toBe(403);

    const createManager = await httpRequest('/api/platform-admin/managers', {
      method: 'POST', token, body: { email: 'x@example.test', password: 'manager-password-0002' },
    });
    expect(createManager.status).toBe(403);

    const listManagers = await httpRequest('/api/platform-admin/managers', { token });
    expect(listManagers.status).toBe(403);
  });

  it('allows super administrators to create tenants', async () => {
    const superAdmin = seedPlatformAdmin();
    const res = await httpRequest('/api/platform-admin/tenants', {
      method: 'POST', token: platformToken(superAdmin),
      body: { name: 'Acme', adminName: 'Admin', adminEmail: 'admin@acme.test' },
    });
    expect(res.status).toBe(201);
  });
});

describe('platform monitoring', () => {
  it('returns a platform-wide overview for managers', async () => {
    const org = seedOrg();
    seedUser(org);
    seedEvent(org, { severity: 'HIGH', riskScore: 80, policyDecision: 'BLOCK', findingLabels: ['PII'] });
    seedEvent(org, { severity: 'LOW', riskScore: 5, policyDecision: 'ALLOW' });

    const manager = seedPlatformAdmin({ role: 'manager' });
    const res = await httpRequest('/api/platform-admin/monitoring/overview?days=7', { token: platformToken(manager) });

    expect(res.status).toBe(200);
    expect(res.data.tenants.total).toBe(1);
    expect(res.data.users.total).toBe(1);
    expect(res.data.events.total).toBe(2);
    expect(res.data.events.highRisk).toBe(1);
    expect(res.data.events.prevented).toBe(1);
    expect(res.data.events.bySeverity.HIGH).toBe(1);
    expect(res.data.recentIncidents).toHaveLength(1);
    expect(res.data.recentIncidents[0].findingLabels).toContain('PII');
    expect(res.data.health.database).toBeDefined();
  });

  it('exposes per-tenant metrics and audit/health endpoints', async () => {
    const org = seedOrg({ name: 'Acme Corp' });
    seedUser(org);
    const token = platformToken(seedPlatformAdmin());

    const tenants = await httpRequest('/api/platform-admin/monitoring/tenants', { token });
    expect(tenants.status).toBe(200);
    expect(tenants.data.tenants[0].name).toBe('Acme Corp');
    expect(tenants.data.tenants[0].metrics.users).toBe(1);

    const audit = await httpRequest('/api/platform-admin/monitoring/audit', { token });
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.data.entries)).toBe(true);

    const health = await httpRequest('/api/platform-admin/monitoring/health', { token });
    expect(health.status).toBe(200);
    expect(health.data.counts.orgs).toBe(1);
    expect(health.data.recentErrors).toEqual([]);
  });

  it('lets managers annotate an investigation but validates input', async () => {
    const org = seedOrg();
    const event = seedEvent(org, { severity: 'HIGH' });
    const token = platformToken(seedPlatformAdmin({ role: 'manager' }));

    const bad = await httpRequest(`/api/platform-admin/monitoring/events/${event._id}/investigation`, {
      method: 'PATCH', token, body: { status: 'bogus' },
    });
    expect(bad.status).toBe(400);

    const ok = await httpRequest(`/api/platform-admin/monitoring/events/${event._id}/investigation`, {
      method: 'PATCH', token, body: { status: 'investigating', note: 'Looking into it' },
    });
    expect(ok.status).toBe(200);
    expect(ok.data.event.investigation.status).toBe('investigating');
    expect(ok.data.event.investigation.note).toBe('Looking into it');

    const detail = await httpRequest(`/api/platform-admin/monitoring/events/${event._id}`, { token });
    expect(detail.status).toBe(200);
    expect(detail.data.event.investigation.status).toBe('investigating');
  });

  it('does not expose raw content or secrets in event listings', async () => {
    const org = seedOrg();
    seedEvent(org, { severity: 'HIGH', maskedPreview: 'My SSN is [REDACTED]' });
    const token = platformToken(seedPlatformAdmin());

    const res = await httpRequest('/api/platform-admin/monitoring/events', { token });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.data)).not.toMatch(/passwordHash|\$2[aby]\$|token/);
    expect(res.data.events[0].maskedPreview).toBe('My SSN is [REDACTED]');
  });
});

describe('authentication telemetry', () => {
  it('records masked failure and success without persisting credentials', async () => {
    const org = seedOrg();
    const passwordHash = await bcrypt.hash('tenant-password-0001', 4);
    seedUser(org, { email: 'alice@acme.test', passwordHash });

    await httpRequest('/api/auth/login', { method: 'POST', body: { email: 'alice@acme.test', password: 'wrong-password-000' } });
    await httpRequest('/api/auth/login', { method: 'POST', body: { email: 'alice@acme.test', password: 'tenant-password-0001' } });
    await httpRequest('/api/platform-admin/auth/login', { method: 'POST', body: { email: 'ghost@example.test', password: 'whatever-0000000' } });
    await settle();

    const serialized = JSON.stringify(state.authEvents);
    expect(serialized).not.toContain('wrong-password-000');
    expect(serialized).not.toContain('tenant-password-0001');
    expect(serialized).not.toContain('alice@acme.test');

    const failures = state.authEvents.filter(e => e.outcome === 'failure');
    const successes = state.authEvents.filter(e => e.outcome === 'success');
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(2);
    expect(state.authEvents.find(e => e.scope === 'platform').emailMasked).toBe('g***@example.test');
  });
});
