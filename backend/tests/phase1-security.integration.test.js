import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { createEventFingerprint } from '../src/utils/event-replay.js';

process.env.JWT_SECRET = randomBytes(48).toString('base64url');
const TEST_SECRET = process.env.JWT_SECRET;
const PLATFORM_ADMIN_EMAIL = 'platform-admin@example.test';
const PLATFORM_ADMIN_PASSWORD = randomBytes(24).toString('base64url');

const state = {
  users: [],
  orgs: [],
  devices: [],
  replays: [],
  events: [],
  audits: [],
  platformAdmins: [],
  invitations: [],
  platformAudits: [],
  justifications: [],
  eventFindFilters: [],
};

function matches(record, filter = {}) {
  if (!record) return false;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some(branch => matches(record, branch));
    const actual = record[key];
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$gt' in expected) return new Date(actual) > new Date(expected.$gt);
      if ('$gte' in expected) return new Date(actual) >= new Date(expected.$gte);
      if ('$lte' in expected) return new Date(actual) <= new Date(expected.$lte);
      if ('$ne' in expected) return String(actual) !== String(expected.$ne);
      if ('$in' in expected) return expected.$in.some(value => String(value) === String(actual));
      if ('$exists' in expected) return (actual !== undefined) === expected.$exists;
    }
    if (expected instanceof Date) return new Date(actual).getTime() === expected.getTime();
    return String(actual) === String(expected);
  });
}

function applyUpdate(record, update = {}) {
  for (const [key, value] of Object.entries(update.$set ?? {})) record[key] = value;
  for (const [key, value] of Object.entries(update.$inc ?? {})) record[key] = (record[key] ?? 0) + value;
  return record;
}

function query(resolve) {
  const result = {
    select() { return result; },
    lean() { return Promise.resolve(resolve()); },
    sort() { return result; },
    skip() { return result; },
    limit() { return result; },
    populate() { return result; },
    then(onFulfilled, onRejected) { return Promise.resolve(resolve()).then(onFulfilled, onRejected); },
    catch(onRejected) { return Promise.resolve(resolve()).catch(onRejected); },
  };
  return result;
}

function model(collection, name) {
  return {
    findOne: jest.fn(filter => query(() => collection.find(record => matches(record, filter)) ?? null)),
    find: jest.fn(filter => query(() => collection.filter(record => matches(record, filter)))),
    countDocuments: jest.fn(filter => query(() => collection.filter(record => matches(record, filter)).length)),
    distinct: jest.fn((field, filter) => query(() => [...new Set(collection.filter(record => matches(record, filter)).map(record => record[field]))])),
    aggregate: jest.fn(() => query(() => [])),
    create: jest.fn(async data => {
      if (name === 'Event' && collection.some(record => record.orgId === data.orgId && record.deviceId === data.deviceId && record.idempotencyKey === data.idempotencyKey)) {
        throw Object.assign(new Error('duplicate key'), { code: 11000 });
      }
      if (name === 'EventReplay' && collection.some(record => record.orgId === data.orgId && record.deviceId === data.deviceId && record.fingerprint === data.fingerprint)) {
        throw Object.assign(new Error('duplicate replay fingerprint'), { code: 11000 });
      }
      if (name === 'User' && collection.some(record => record.email === data.email)) {
        throw Object.assign(new Error('duplicate user'), { code: 11000 });
      }
      if (name === 'TenantInvitation' && collection.some(record => record.tokenHash === data.tokenHash)) {
        throw Object.assign(new Error('duplicate invitation token'), { code: 11000 });
      }
      if (name === 'TenantInvitation' && data.status === 'pending' && collection.some(record => record.email === data.email && record.status === 'pending')) {
        throw Object.assign(new Error('pending invitation already exists'), { code: 11000 });
      }
      const record = { _id: `${name.toLowerCase()}-${randomUUID()}`, ...data };
      record.toObject ??= () => ({ ...record });
      collection.push(record);
      return record;
    }),
    findOneAndUpdate: jest.fn((filter, update) => query(() => {
      const record = collection.find(item => matches(item, filter));
      return record ? applyUpdate(record, update) : null;
    })),
    updateOne: jest.fn(async (filter, update) => {
      const record = collection.find(item => matches(item, filter));
      if (!record) return { matchedCount: 0 };
      applyUpdate(record, update);
      return { matchedCount: 1 };
    }),
    updateMany: jest.fn(async (filter, update) => {
      const matched = collection.filter(item => matches(item, filter));
      matched.forEach(record => applyUpdate(record, update));
      return { matchedCount: matched.length, modifiedCount: matched.length };
    }),
    deleteOne: jest.fn(async filter => {
      const index = collection.findIndex(record => matches(record, filter));
      if (index < 0) return { deletedCount: 0 };
      collection.splice(index, 1);
      return { deletedCount: 1 };
    }),
    findById: jest.fn(id => query(() => collection.find(record => String(record._id) === String(id)) ?? null)),
    findByIdAndUpdate: jest.fn(),
  };
}

const User = model(state.users, 'User');
const Org = model(state.orgs, 'Org');
const Device = model(state.devices, 'Device');
const EventReplay = model(state.replays, 'EventReplay');
const Event = model(state.events, 'Event');
const Justification = model(state.justifications, 'Justification');
const AuditLog = model(state.audits, 'AuditLog');
const PlatformAdmin = model(state.platformAdmins, 'PlatformAdmin');
const TenantInvitation = model(state.invitations, 'TenantInvitation');
const PlatformAuditLog = model(state.platformAudits, 'PlatformAuditLog');
const Policy = {
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([])
    })
  })
};

jest.unstable_mockModule('../src/models/index.js', () => ({
  User, Org, Device, Event, EventReplay, Justification, AuditLog, PlatformAdmin, TenantInvitation, PlatformAuditLog, Team: {}, Policy
}));

const { createApp } = await import('../src/app.js');
const { attachTenantWebSockets, broadcastTenantAlert } = await import('../src/services/websocket.js');

let server;
let wss;
let baseUrl;
let wsUrl;

function makeUserToken(user, overrides = {}) {
  return jwt.sign({
    tokenType: 'user',
    userId: user._id,
    orgId: user.orgId,
    authVersion: user.authVersion ?? 0,
    ...overrides,
  }, TEST_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

function makeEvent(idempotencyKey, overrides = {}) {
  return {
    idempotencyKey,
    domain: 'chat.openai.com',
    eventType: 'paste',
    riskScore: 0,
    severity: 'LOW',
    findingLabels: [],
    maskedPreview: 'masked',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

async function request(path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}

async function createDevice(user) {
  const userToken = makeUserToken(user);
  const enrollment = await request('/api/auth/device/enrollment-code', {
    token: userToken,
    method: 'POST',
    body: { label: 'Integration device' },
  });
  expect(enrollment.response.status).toBe(201);
  const registration = await request('/api/auth/device/register', {
    method: 'POST',
    body: { code: enrollment.data.code },
  });
  expect(registration.response.status).toBe(201);
  return registration.data;
}

async function loginPlatformAdmin() {
  return request('/api/platform-admin/auth/login', {
    method: 'POST',
    body: { email: PLATFORM_ADMIN_EMAIL, password: PLATFORM_ADMIN_PASSWORD },
  });
}

function openSocket(ticket, queryString = '') {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}/api/alerts${ticket ? `?ticket=${ticket}${queryString}` : ''}`);
    socket.once('open', () => resolve(socket));
    socket.once('unexpected-response', (_request, response) => {
      socket.close();
      reject(Object.assign(new Error('WebSocket rejected'), { statusCode: response.statusCode }));
    });
    socket.once('error', error => reject(error));
  });
}

beforeAll(async () => {
  state.platformAdmins.push({
    _id: 'platform-admin-1',
    email: PLATFORM_ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(PLATFORM_ADMIN_PASSWORD, 4),
    authVersion: 0,
    isActive: true,
  });
  state.users.push(
    { _id: 'user-a', orgId: 'org-a', email: 'admin-a@example.test', role: 'admin', authVersion: 0, isActive: true, optedOut: false },
    { _id: 'user-b', orgId: 'org-b', email: 'admin-b@example.test', role: 'admin', authVersion: 0, isActive: true, optedOut: false },
    { _id: 'viewer-a', orgId: 'org-a', email: 'viewer-a@example.test', role: 'viewer', authVersion: 0, isActive: true, optedOut: false },
  );
  state.orgs.push(
    { _id: 'org-a', name: 'Tenant A', lifecycleStatus: 'active', policyVersion: 7, settings: { defaultAction: 'WARN' }, monitoredDomains: ['chat.openai.com'] },
    { _id: 'org-b', name: 'Tenant B', lifecycleStatus: 'active', policyVersion: 2, settings: { defaultAction: 'ALLOW' }, monitoredDomains: ['chat.openai.com'] },
  );
  state.events.push(
    { _id: 'event-a-existing', orgId: 'org-a', userRef: 'user-a', idempotencyKey: 'existing-key-a-0001', severity: 'LOW', timestamp: new Date() },
    { _id: 'event-b-existing', orgId: 'org-b', userRef: 'user-b', idempotencyKey: 'existing-key-b-0001', severity: 'LOW', timestamp: new Date() },
  );

  const app = createApp();
  server = createServer(app);
  wss = attachTenantWebSockets(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const socket of wss.clients) socket.close();
  await new Promise(resolve => wss.close(resolve));
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  state.eventFindFilters.length = 0;
  Event.find.mockImplementation(filter => {
    state.eventFindFilters.push(filter);
    return query(() => state.events.filter(record => matches(record, filter)));
  });
});

describe('Phase 1 mounted security integration', () => {
  it('provisions tenants only through the separate platform-admin identity and activates one-use admin invitations', async () => {
    const platformLogin = await loginPlatformAdmin();
    expect(platformLogin.response.status).toBe(200);
    const platformToken = platformLogin.data.token;

    const create = await request('/api/platform-admin/tenants', {
      token: platformToken,
      method: 'POST',
      body: { name: 'Provisioned Tenant', adminName: 'Tenant Admin', adminEmail: 'tenant-admin@example.test' },
    });
    expect(create.response.status).toBe(201);
    expect(create.data.tenant.lifecycleStatus).toBe('pending_admin');
    expect(create.data.tenant.id).not.toBe('org-a');
    const tenantId = create.data.tenant.id;
    const invitation = state.invitations.find(record => String(record.orgId) === String(tenantId));
    expect(invitation.tokenHash).not.toBe(create.data.invitation.token);

    const forgedTenant = await request('/api/platform-admin/tenants', {
      token: platformToken,
      method: 'POST',
      body: { name: 'Forged Tenant', adminName: 'Admin', adminEmail: 'forged@example.test', orgId: 'org-b' },
    });
    expect(forgedTenant.response.status).toBe(400);
    expect(state.orgs.some(org => org.name === 'Forged Tenant')).toBe(false);

    const acceptPayload = { token: create.data.invitation.token, password: 'tenant-admin-password-01' };
    const activated = await request('/api/platform-admin/invitations/accept', { method: 'POST', body: acceptPayload });
    expect(activated.response.status).toBe(201);
    expect(state.orgs.find(org => String(org._id) === String(tenantId)).lifecycleStatus).toBe('active');
    expect(state.users.find(user => user.email === 'tenant-admin@example.test')).toMatchObject({ orgId: tenantId, role: 'admin', isActive: true });
    const reused = await request('/api/platform-admin/invitations/accept', { method: 'POST', body: acceptPayload });
    expect(reused.response.status).toBe(401);

    const tenantLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'tenant-admin@example.test', password: 'tenant-admin-password-01' },
    });
    expect(tenantLogin.response.status).toBe(200);
    const ownSettings = await request('/api/settings/org', { token: tenantLogin.data.token });
    expect(ownSettings.response.status).toBe(200);
    const forgedOrgSelection = await request('/api/settings/org?orgId=org-b', { token: tenantLogin.data.token });
    expect(forgedOrgSelection.response.status).toBe(403);

    const tenantCannotChangeLifecycle = await request(`/api/platform-admin/tenants/${tenantId}/status`, {
      token: tenantLogin.data.token,
      method: 'PATCH',
      body: { lifecycleStatus: 'suspended' },
    });
    expect(tenantCannotChangeLifecycle.response.status).toBe(401);
    const suspended = await request(`/api/platform-admin/tenants/${tenantId}/status`, {
      token: platformToken,
      method: 'PATCH',
      body: { lifecycleStatus: 'suspended' },
    });
    expect(suspended.response.status).toBe(200);
    const suspendedAccess = await request('/api/settings/org', { token: tenantLogin.data.token });
    expect(suspendedAccess.response.status).toBe(401);
    const reactivated = await request(`/api/platform-admin/tenants/${tenantId}/status`, {
      token: platformToken,
      method: 'PATCH',
      body: { lifecycleStatus: 'active' },
    });
    expect(reactivated.response.status).toBe(200);

    const tenantCannotProvision = await request('/api/platform-admin/tenants', {
      token: tenantLogin.data.token,
      method: 'POST',
      body: { name: 'Unauthorized', adminName: 'Other', adminEmail: 'other@example.test' },
    });
    expect(tenantCannotProvision.response.status).toBe(401);
    const normalUserCannotProvision = await request('/api/platform-admin/tenants', {
      token: makeUserToken(state.users.find(user => user._id === 'viewer-a')),
      method: 'POST',
      body: { name: 'Unauthorized', adminName: 'Other', adminEmail: 'other@example.test' },
    });
    expect(normalUserCannotProvision.response.status).toBe(401);

    const platformTokenOnTenantRoute = await request('/api/users', { token: platformToken });
    expect(platformTokenOnTenantRoute.response.status).toBe(401);
    expect(state.platformAudits.some(entry => entry.action === 'tenant_created' && String(entry.tenantId) === String(tenantId))).toBe(true);
    expect(state.platformAudits.some(entry => entry.action === 'tenant_admin_activated' && String(entry.tenantId) === String(tenantId))).toBe(true);
    expect(state.platformAudits.some(entry => entry.action === 'tenant_suspended' && String(entry.tenantId) === String(tenantId))).toBe(true);
  });

  it('rejects expired tenant-admin invitations without activating the tenant', async () => {
    const platformLogin = await loginPlatformAdmin();
    const create = await request('/api/platform-admin/tenants', {
      token: platformLogin.data.token,
      method: 'POST',
      body: { name: 'Expired Invitation Tenant', adminName: 'Expired Admin', adminEmail: 'expired-admin@example.test' },
    });
    expect(create.response.status).toBe(201);
    const invitation = state.invitations.find(record => String(record.orgId) === String(create.data.tenant.id));
    invitation.expiresAt = new Date(Date.now() - 1);

    const accept = await request('/api/platform-admin/invitations/accept', {
      method: 'POST',
      body: { token: create.data.invitation.token, password: 'tenant-admin-password-02' },
    });
    expect(accept.response.status).toBe(401);
    expect(state.orgs.find(org => String(org._id) === String(create.data.tenant.id)).lifecycleStatus).toBe('pending_admin');
    expect(state.users.some(user => user.email === 'expired-admin@example.test')).toBe(false);

    const platformToken = platformLogin.data.token;
    const replacement = await request(`/api/platform-admin/tenants/${create.data.tenant.id}/invitations`, {
      token: platformToken,
      method: 'POST',
      body: { name: 'Expired Admin', email: 'expired-admin@example.test' },
    });
    expect(replacement.response.status).toBe(201);
    expect(state.invitations.find(record => record.tokenHash !== undefined && String(record.orgId) === String(create.data.tenant.id) && record.status === 'revoked')).toBeDefined();
    const replacementAccepted = await request('/api/platform-admin/invitations/accept', {
      method: 'POST',
      body: { token: replacement.data.token, password: 'replacement-admin-password-03' },
    });
    expect(replacementAccepted.response.status).toBe(201);
  });

  it('fails fast when JWT_SECRET is missing and rejects forged JWT signatures', async () => {
    for (const invalidSecret of ['', 'x'.repeat(64)]) {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/security.js')"], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, JWT_SECRET: invalidSecret },
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('JWT_SECRET must be configured');
    }

    const response = await request('/api/users', { token: jwt.sign({ tokenType: 'user', userId: 'user-a', orgId: 'org-a' }, randomBytes(48).toString('base64url')) });
    expect(response.response.status).toBe(401);
  });

  it('derives role from the current user record and denies forged role escalation', async () => {
    const token = makeUserToken(state.users.find(user => user._id === 'viewer-a'), { role: 'admin' });
    const response = await request('/api/users', { token });
    expect(response.response.status).toBe(403);
    const ticket = await request('/api/auth/ws-ticket', { token, method: 'POST' });
    expect(ticket.response.status).toBe(403);
  });

  it('rejects deactivated users and disabled signup without an invitation', async () => {
    const user = state.users.find(record => record._id === 'user-b');
    const token = makeUserToken(user);
    user.isActive = false;
    const protectedResponse = await request('/api/events', { token });
    expect(protectedResponse.response.status).toBe(401);
    user.isActive = true;

    const signup = await request('/api/auth/signup', { method: 'POST', body: { username: 'new', email: 'new@example.test', password: 'not-used' } });
    expect(signup.response.status).toBe(403);
  });

  it('returns non-disclosing 404 and scopes writes for foreign users', async () => {
    const token = makeUserToken(state.users.find(user => user._id === 'user-a'));
    const history = await request('/api/users/user-b/events', { token });
    expect(history.response.status).toBe(404);
    expect(history.data).toEqual({ error: 'User not found' });
    expect(Event.find).not.toHaveBeenCalled();

    const update = await request('/api/users/user-b', { token, method: 'PATCH', body: { role: 'viewer' } });
    expect(update.response.status).toBe(404);
    const deletion = await request('/api/users/user-b', { token, method: 'DELETE' });
    expect(deletion.response.status).toBe(404);
  });

  it('keeps event lists, user-history queries, and tenant counts scoped', async () => {
    const token = makeUserToken(state.users.find(user => user._id === 'user-a'));
    const eventList = await request('/api/events', { token });
    expect(eventList.response.status).toBe(200);
    expect(eventList.data.events.every(event => event.orgId === 'org-a')).toBe(true);
    expect(state.eventFindFilters.at(-1).orgId).toBe('org-a');

    const history = await request('/api/users/user-a/events', { token });
    expect(history.response.status).toBe(200);
    expect(state.eventFindFilters.at(-1)).toMatchObject({ orgId: 'org-a', userRef: 'user-a' });

    const justifications = await request('/api/justifications', { token });
    expect(justifications.response.status).toBe(200);
    expect(Justification.countDocuments).toHaveBeenCalledWith({ orgId: 'org-a' });
  });

  it('requires a registered device for batches and rejects tenant/user field tampering', async () => {
    const user = state.users.find(record => record._id === 'user-a');
    const userToken = makeUserToken(user);
    const noToken = await request('/api/events/batch', { method: 'POST', body: { events: [] } });
    expect(noToken.response.status).toBe(401);
    const userCredential = await request('/api/events/batch', { token: userToken, method: 'POST', body: { events: [] } });
    expect(userCredential.response.status).toBe(403);

    const device = await createDevice(user);
    const tampered = await request('/api/events', {
      token: device.token,
      method: 'POST',
      body: { ...makeEvent('forged-identity-event-001'), orgId: 'org-b', userId: 'user-b', fingerprint: 'client-selected' },
    });
    expect(tampered.response.status).toBe(400);
    expect(state.events.some(event => event.idempotencyKey === 'forged-identity-event-001')).toBe(false);
  });

  it('uses tenant policy instead of client severity and stores telemetry separately', async () => {
    const user = state.users.find(record => record._id === 'user-a');
    const device = await createDevice(user);
    const low = makeEvent('telemetry-low-event-0001', { severity: 'LOW', riskScore: 0 });
    const high = makeEvent('telemetry-high-event-0001', { severity: 'HIGH', riskScore: 100 });

    const first = await request('/api/events', { token: device.token, method: 'POST', body: low });
    const second = await request('/api/events', { token: device.token, method: 'POST', body: high });
    expect(first.response.status).toBe(202);
    expect(second.response.status).toBe(202);

    const stored = state.events.filter(event => event.idempotencyKey.startsWith('telemetry-'));
    expect(stored.map(event => event.policyDecision)).toEqual(['WARN', 'WARN']);
    expect(stored[0].clientTelemetry).toMatchObject({ severity: 'LOW', riskScore: 0 });
    expect(stored[1].clientTelemetry).toMatchObject({ severity: 'HIGH', riskScore: 100 });
    expect(stored.every(event => !Object.hasOwn(event, 'blocked'))).toBe(true);
    expect(first.data.requestPrevented).toBe(false);
    expect(state.audits.filter(audit => audit.action === 'event_policy_decision').length).toBeGreaterThanOrEqual(2);
  });

  it('fails closed for missing or invalid persisted policy configuration', async () => {
    const user = state.users.find(record => record._id === 'user-a');
    const device = await createDevice(user);
    const org = state.orgs.find(record => record._id === 'org-a');
    const configured = org.settings;

    for (const invalidAction of [undefined, 'PERMIT']) {
      org.settings = { defaultAction: invalidAction };
      const response = await request('/api/events', {
        token: device.token,
        method: 'POST',
        body: makeEvent(`invalid-policy-${String(invalidAction)}-0001`.padEnd(24, 'x')),
      });
      expect(response.response.status).toBe(202);
      const stored = state.events.find(event => event.idempotencyKey === response.data.eventId);
      const latest = state.events.at(-1);
      expect(latest.policyDecision).toBe('BLOCK');
      expect(latest.policyReason).toBe('invalid_or_missing_policy');
    }

    for (const action of ['ALLOW', 'WARN', 'BLOCK']) {
      org.settings = { defaultAction: action };
      const response = await request('/api/events', {
        token: device.token,
        method: 'POST',
        body: makeEvent(`valid-policy-${action}-event-0001`, { domain: `${action.toLowerCase()}.example` }),
      });
      expect(response.response.status).toBe(202);
      expect(state.events.at(-1).policyDecision).toBe(action);
    }
    org.settings = configured;
  });

  it('deduplicates single and batch retries within the authenticated tenant/device', async () => {
    const user = state.users.find(record => record._id === 'user-a');
    const device = await createDevice(user);
    const payload = makeEvent('replay-event-key-0000001');
    const first = await request('/api/events', { token: device.token, method: 'POST', body: payload });
    const replay = await request('/api/events', { token: device.token, method: 'POST', body: payload });
    expect(first.data.duplicate).toBe(false);
    expect(replay.data.duplicate).toBe(true);

    const batchPayload = makeEvent('batch-replay-key-000001', { domain: 'claude.ai' });
    const batch = await request('/api/events/batch', { token: device.token, method: 'POST', body: { events: [batchPayload, batchPayload] } });
    expect(batch.response.status).toBe(202);
    expect(batch.data.saved).toBe(1);
    expect(batch.data.duplicates).toBe(1);
  });
  
  it('blocks changed-key semantic replays for two minutes, scopes fingerprints, and serializes concurrent submissions', async () => {
    const userA = state.users.find(record => record._id === 'user-a');
    const userB = state.users.find(record => record._id === 'user-b');
    const deviceA1 = await createDevice(userA);
    const deviceA2 = await createDevice(userA);
    const deviceB = await createDevice(userB);
    const timestamp = new Date().toISOString();
    const payload = makeEvent('semantic-replay-key-0001', { timestamp, findingLabels: [' AWS Key ', 'PII'] });

    const first = await request('/api/events', { token: deviceA1.token, method: 'POST', body: payload });
    const changedKey = await request('/api/events', {
      token: deviceA1.token,
      method: 'POST',
      body: { ...payload, idempotencyKey: 'semantic-replay-key-0002', timestamp: new Date(Date.now() + 1000).toISOString() },
    });
    expect(first.response.status).toBe(202);
    expect(first.data.duplicate).toBe(false);
    expect(changedKey.data.duplicate).toBe(true);

    const otherDevice = await request('/api/events', { token: deviceA2.token, method: 'POST', body: payload });
    const otherTenant = await request('/api/events', { token: deviceB.token, method: 'POST', body: payload });
    expect(otherDevice.data.duplicate).toBe(false);
    expect(otherTenant.data.duplicate).toBe(false);

    const concurrentPayload = makeEvent('concurrent-semantic-key-0001', { timestamp: new Date().toISOString() });
    const [concurrentOne, concurrentTwo] = await Promise.all([
      request('/api/events', { token: deviceA1.token, method: 'POST', body: concurrentPayload }),
      request('/api/events', {
        token: deviceA1.token,
        method: 'POST',
        body: { ...concurrentPayload, idempotencyKey: 'concurrent-semantic-key-0002' },
      }),
    ]);
    expect([concurrentOne.data.duplicate, concurrentTwo.data.duplicate].filter(value => value === false)).toHaveLength(1);
    expect([concurrentOne.data.duplicate, concurrentTwo.data.duplicate].filter(value => value === true)).toHaveLength(1);

    const windowPayload = makeEvent('expired-semantic-key-0001', { timestamp: new Date().toISOString(), domain: 'claude.ai' });
    const withinWindow = await request('/api/events', { token: deviceA1.token, method: 'POST', body: windowPayload });
    expect(withinWindow.data.duplicate).toBe(false);
    const context = { orgId: userA.orgId, deviceId: deviceA1.deviceId };
    const fingerprint = createEventFingerprint(context, windowPayload);
    const replayRecord = state.replays.find(record => record.fingerprint === fingerprint);
    replayRecord.expiresAt = new Date(Date.now() - 1);
    const outsideWindow = await request('/api/events', {
      token: deviceA1.token,
      method: 'POST',
      body: { ...windowPayload, idempotencyKey: 'expired-semantic-key-0002' },
    });
    expect(outsideWindow.data.duplicate).toBe(false);
  });

  it('persists device identity, consumes pairing codes once, and enforces revocation', async () => {
    const user = state.users.find(record => record._id === 'user-a');
    const token = makeUserToken(user);
    const enrollment = await request('/api/auth/device/enrollment-code', { token, method: 'POST', body: {} });
    expect(enrollment.response.status).toBe(201);
    const pending = state.devices.find(device => device.deviceId === enrollment.data.deviceId);
    expect(pending).toMatchObject({ orgId: 'org-a', userId: 'user-a', isActive: false });
    expect(pending.tokenHash).not.toBe(enrollment.data.code);

    const registered = await request('/api/auth/device/register', { method: 'POST', body: { code: enrollment.data.code } });
    expect(registered.response.status).toBe(201);
    expect(state.devices.find(device => device.deviceId === registered.data.deviceId).isActive).toBe(true);
    const reuse = await request('/api/auth/device/register', { method: 'POST', body: { code: enrollment.data.code } });
    expect(reuse.response.status).toBe(401);

    const revoke = await request(`/api/auth/device/${registered.data.deviceId}/revoke`, { token, method: 'POST', body: {} });
    expect(revoke.response.status).toBe(200);
    const afterRevoke = await request('/api/events/batch', { token: registered.data.token, method: 'POST', body: { events: [] } });
    expect(afterRevoke.response.status).toBe(401);
  });

  it('rejects unauthenticated WebSockets and scopes tickets despite forged tenant parameters', async () => {
    await expect(openSocket(null)).rejects.toMatchObject({ statusCode: 401 });
    const adminA = state.users.find(user => user._id === 'user-a');
    const adminB = state.users.find(user => user._id === 'user-b');
    const ticketAResponse = await request('/api/auth/ws-ticket', { token: makeUserToken(adminA), method: 'POST' });
    const ticketBResponse = await request('/api/auth/ws-ticket', { token: makeUserToken(adminB), method: 'POST' });
    expect(ticketAResponse.response.status).toBe(200);
    expect(ticketBResponse.response.status).toBe(200);

    const socketA = await openSocket(ticketAResponse.data.ticket, '&tenantId=org-b');
    const socketB = await openSocket(ticketBResponse.data.ticket);
    await expect(openSocket(ticketAResponse.data.ticket)).rejects.toMatchObject({ statusCode: 401 });
    const receivedA = [];
    const receivedB = [];
    socketA.on('message', message => receivedA.push(JSON.parse(message.toString())));
    socketB.on('message', message => receivedB.push(JSON.parse(message.toString())));

    socketA.send(JSON.stringify({ type: 'SUBSCRIBE', tenantId: 'org-b' }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(receivedA[0]).toMatchObject({ type: 'ERROR' });

    broadcastTenantAlert({ orgId: 'org-a', eventId: 'tenant-a-event' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(receivedA.some(message => message.event?.eventId === 'tenant-a-event')).toBe(true);
    expect(receivedB.some(message => message.event?.eventId === 'tenant-a-event')).toBe(false);

    broadcastTenantAlert({ orgId: 'org-b', eventId: 'tenant-b-event' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(receivedA.some(message => message.event?.eventId === 'tenant-b-event')).toBe(false);
    expect(receivedB.some(message => message.event?.eventId === 'tenant-b-event')).toBe(true);
    socketA.close();
    socketB.close();
  });

  it('revokes existing WebSocket and HTTP credentials on logout', async () => {
    const user = state.users.find(record => record._id === 'user-a');
    const token = makeUserToken(user);
    const ticket = await request('/api/auth/ws-ticket', { token, method: 'POST' });
    const pendingTicket = await request('/api/auth/ws-ticket', { token, method: 'POST' });
    const socket = await openSocket(ticket.data.ticket);
    const closed = new Promise(resolve => socket.once('close', code => resolve(code)));

    const logout = await request('/api/auth/logout', { token, method: 'POST', body: {} });
    expect(logout.response.status).toBe(200);
    expect(await closed).toBe(1008);
    await expect(openSocket(pendingTicket.data.ticket)).rejects.toMatchObject({ statusCode: 401 });

    const reused = await request('/api/events', { token });
    expect(reused.response.status).toBe(401);
  });

  it('revokes active WebSocket sessions when an administrator resets a password', async () => {
    const admin = state.users.find(record => record._id === 'user-a');
    const target = admin;
    const adminToken = makeUserToken(admin);
    const ticket = await request('/api/auth/ws-ticket', { token: adminToken, method: 'POST' });
    const socket = await openSocket(ticket.data.ticket);
    const closed = new Promise(resolve => socket.once('close', code => resolve(code)));

    const reset = await request(`/api/users/${target._id}/password`, {
      token: adminToken,
      method: 'PATCH',
      body: { newPassword: 'new-test-password-123' },
    });
    expect(reset.response.status).toBe(200);
    expect(await closed).toBe(1008);

    const priorToken = await request('/api/events', { token: makeUserToken(target, { authVersion: target.authVersion - 1 }) });
    expect(priorToken.response.status).toBe(401);
  });
});
