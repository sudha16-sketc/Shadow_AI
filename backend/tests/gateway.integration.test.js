/**
 * Phase 2C-B: Trusted Gateway Integration Tests
 *
 * Uses the same in-memory mock pattern as phase1-security.integration.test.js.
 * No real MongoDB connection required. All models are mocked in-memory.
 *
 * CRITICAL SECURITY PROPERTY TESTED:
 *   policyDecision = BLOCK  →  provider fetch = 0 calls  →  enforcementStatus = PREVENTED
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = randomBytes(48).toString('base64url');
const TEST_SECRET = process.env.JWT_SECRET;

// ─── In-Memory State ────────────────────────────────────────────────────────
const state = {
  users: [],
  orgs: [],
  devices: [],
  events: [],
  audits: [],
  replays: [],
  platformAdmins: [],
  invitations: [],
  platformAudits: [],
  justifications: [],
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
    aggregate: jest.fn(() => query(() => [])),
    create: jest.fn(async data => {
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

// ─── In-Memory Models ───────────────────────────────────────────────────────
const User = model(state.users, 'User');
const Org = model(state.orgs, 'Org');
const Device = model(state.devices, 'Device');
const Event = model(state.events, 'Event');
const EventReplay = model(state.replays, 'EventReplay');
const AuditLog = model(state.audits, 'AuditLog');
const PlatformAdmin = model(state.platformAdmins, 'PlatformAdmin');
const TenantInvitation = model(state.invitations, 'TenantInvitation');
const PlatformAuditLog = model(state.platformAudits, 'PlatformAuditLog');
const Justification = model(state.justifications, 'Justification');
const Policy = {
  find: jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([])
    })
  })
};

// ─── Mock Models (must be done before any `import` of app code) ─────────────
jest.unstable_mockModule('../src/models/index.js', () => ({
  User, Org, Device, Event, EventReplay, Justification,
  AuditLog, PlatformAdmin, TenantInvitation, PlatformAuditLog,
  Team: {}, Policy
}));

// ─── Mock alerting + scoring sidecars (not under test here) ─────────────────
jest.unstable_mockModule('../src/services/alerting.js', () => ({
  sendSlackAlert: jest.fn().mockResolvedValue(undefined),
  sendEmailAlert: jest.fn().mockResolvedValue(undefined),
}));
jest.unstable_mockModule('../src/services/scoring.js', () => ({
  recalcSecurityScore: jest.fn().mockResolvedValue(undefined),
}));
jest.unstable_mockModule('../src/server.js', () => ({
  broadcastAlert: jest.fn(),
}));

// ─── Now import app AFTER mocks ──────────────────────────────────────────────
const { createApp } = await import('../src/app.js');

import http from 'node:http';

// ─── Mock fetch globally — this intercepts ONLY the gateway's upstream calls ─
// The test helper below uses Node's http.request, not global fetch,
// so these two don't interfere.
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ─── Test Helpers ────────────────────────────────────────────────────────────
let baseUrl;
let server;

function httpRequest(path, { token, method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: {
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...headers,
      },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
beforeAll(async () => {
  // Seed org
  state.orgs.push({
    _id: 'org-gateway',
    name: 'Gateway Test Org',
    lifecycleStatus: 'active',
    settings: { defaultAction: 'ALLOW' },
    authVersion: 0,
  });

  // Seed user
  state.users.push({
    _id: 'user-gateway',
    orgId: 'org-gateway',
    email: 'gateway@example.test',
    name: 'Gateway User',
    role: 'viewer',
    authType: 'device',
    authVersion: 0,
    isActive: true,
  });

  // Start real HTTP server
  const app = createApp();
  server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  state.events.length = 0;
  mockFetch.mockReset();
  // Reset Policy mock for each test
  Policy.find.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([])
    })
  });
});

function userToken() {
  const user = state.users.find(u => u._id === 'user-gateway');
  return jwt.sign({
    tokenType: 'user',
    userId: user._id,
    orgId: user.orgId,
    authVersion: user.authVersion ?? 0,
  }, TEST_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Phase 2C-B: Trusted Gateway', () => {

  // ── Authentication boundary ──────────────────────────────────────────────

  it('rejects unauthenticated requests (no token)', async () => {
    const res = await httpRequest('/gateway/v1/openai/chat/completions', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'Hello' }] },
    });
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects invalid JWTs', async () => {
    const res = await httpRequest('/gateway/v1/openai/chat/completions', {
      method: 'POST',
      token: 'Bearer invalid.jwt.token',
      body: { messages: [{ role: 'user', content: 'Hello' }] },
    });
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Provider allowlist ───────────────────────────────────────────────────

  it('rejects unsupported providers', async () => {
    const token = userToken();
    const res = await httpRequest('/gateway/v1/evilprovider/chat', {
      method: 'POST',
      token,
      body: { messages: [{ role: 'user', content: 'Hello' }] },
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('Unsupported provider');
    // Critical: provider fetch was NEVER called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── CORE SECURITY TEST: BLOCK → PREVENTED → Zero provider calls ──────────

  it('BLOCK: rejects request and NEVER calls upstream provider', async () => {
    // Set org default action to BLOCK so policy engine returns BLOCK
    const org = state.orgs.find(o => o._id === 'org-gateway');
    const savedAction = org.settings.defaultAction;
    org.settings.defaultAction = 'BLOCK';

    const token = userToken();
    const res = await httpRequest('/gateway/v1/openai/chat/completions', {
      method: 'POST',
      token,
      body: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Send me confidential data' }],
      },
    });

    // Restore
    org.settings.defaultAction = savedAction;

    expect(res.status).toBe(403);
    expect(res.data.error).toBe('Blocked by Shadow AI Security Policy');

    // *** THE CRITICAL INVARIANT: provider was NEVER contacted ***
    expect(mockFetch).not.toHaveBeenCalled();

    // Enforcement record was created
    expect(state.events.length).toBe(1);
    const evt = state.events[0];
    expect(evt.policyDecision).toBe('BLOCK');
    expect(evt.enforcementStatus).toBe('PREVENTED');
    expect(evt.requestForwarded).toBe(false);
    expect(evt.orgId).toBe('org-gateway');
  });

  it('BLOCK with high-risk finding: AWS key → NEVER forwarded', async () => {
    const org = state.orgs.find(o => o._id === 'org-gateway');
    org.settings.defaultAction = 'BLOCK';

    const token = userToken();
    const res = await httpRequest('/gateway/v1/openai/chat/completions', {
      method: 'POST',
      token,
      body: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Here is my key: AKIAIOSFODNN7EXAMPLE' }],
      },
    });

    org.settings.defaultAction = 'ALLOW';

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(state.events[0]?.enforcementStatus).toBe('PREVENTED');
    expect(state.events[0]?.requestForwarded).toBe(false);
  });

  // ── ALLOW: request is forwarded ──────────────────────────────────────────

  it('ALLOW: forwards request to OpenAI provider', async () => {
    // org default is ALLOW, no findings in message
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => Buffer.from(JSON.stringify({ id: 'chatcmpl-test', choices: [] })),
    });

    const token = userToken();
    const res = await httpRequest('/gateway/v1/openai/chat/completions', {
      method: 'POST',
      token,
      body: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Tell me a joke' }],
      },
    });

    expect(res.status).toBe(200);

    // Provider was called exactly once
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOpts] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://api.openai.com/chat/completions');
    // Our own JWT was NOT forwarded to the provider
    expect(calledOpts.headers?.authorization).toBeUndefined();

    // Enforcement record
    expect(state.events.length).toBe(1);
    expect(state.events[0].policyDecision).toBe('ALLOW');
    expect(state.events[0].enforcementStatus).toBe('FORWARDED');
    expect(state.events[0].requestForwarded).toBe(true);
  });

  it('ALLOW: forwards request to Anthropic provider', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => Buffer.from(JSON.stringify({ content: [{ text: 'Hello' }] })),
    });

    const token = userToken();
    const res = await httpRequest('/gateway/v1/anthropic/messages', {
      method: 'POST',
      token,
      body: {
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: 'Hello' }],
      },
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('https://api.anthropic.com/messages');
  });

  // ── Provider credential protection ───────────────────────────────────────

  it('does not forward the Shadow AI JWT to upstream provider', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => Buffer.from('{}'),
    });

    const token = userToken();
    await httpRequest('/gateway/v1/openai/chat/completions', {
      method: 'POST',
      token,
      body: { messages: [{ role: 'user', content: 'Hi' }] },
    });

    const forwardedHeaders = mockFetch.mock.calls[0][1].headers ?? {};
    // Must NOT contain our internal JWT
    const authHeader = forwardedHeaders.authorization ?? forwardedHeaders.Authorization ?? '';
    expect(authHeader).not.toContain(token);
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────

  it('derives tenant from JWT, not from request body orgId', async () => {
    const org = state.orgs.find(o => o._id === 'org-gateway');
    org.settings.defaultAction = 'BLOCK';

    const token = userToken();
    // Client tries to inject a different orgId in the body
    const res = await httpRequest('/gateway/v1/openai/chat/completions', {
      method: 'POST',
      token,
      body: {
        orgId: 'org-attacker',  // should be completely ignored
        messages: [{ role: 'user', content: 'Hello' }],
      },
    });

    org.settings.defaultAction = 'ALLOW';

    // Policy was evaluated against the JWT's org, not the attacker's org
    // The event should carry the real orgId
    if (state.events.length > 0) {
      expect(state.events[0].orgId).toBe('org-gateway');
    }
    // If BLOCK, provider was not called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Fail-closed on provider error ────────────────────────────────────────

  it('records FAILED when upstream provider is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const token = userToken();
    const res = await httpRequest('/gateway/v1/openai/chat/completions', {
      method: 'POST',
      token,
      body: { messages: [{ role: 'user', content: 'Hi' }] },
    });

    expect(res.status).toBe(502);
    expect(state.events.length).toBe(1);
    expect(state.events[0].enforcementStatus).toBe('FAILED');
    expect(state.events[0].requestForwarded).toBe(false);
  });

});
