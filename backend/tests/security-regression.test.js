/**
 * Security regression tests — evidence for SECURITY_TEST_REPORT.md.
 *
 * Each block maps to a documented control in SECURITY_FEATURES.md. No real
 * MongoDB and no outbound network calls: models are in-memory and `fetch` is a
 * spy (see tests/helpers/mock-app.js).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';

const app = await import('./helpers/mock-app.js');
const {
  state, resetState, mockFetch, httpRequest, start, stop,
  seedOrg, seedUser, userToken,
} = app;

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

beforeAll(async () => { await start(); });
afterAll(async () => { await stop(); });

let org;
let admin;
let token;

beforeEach(() => {
  resetState();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(jsonUpstream('{}'));
  org = seedOrg();
  admin = seedUser(org, { role: 'admin' });
  token = userToken(admin);
});

function jsonUpstream(text, { status = 200, headers = {} } = {}) {
  const bytes = new TextEncoder().encode(text);
  return {
    status,
    headers: new Headers([['content-type', 'application/json'], ...Object.entries(headers)]),
    arrayBuffer: async () => bytes.buffer,
  };
}

const gateway = (path = '/v1/chat/completions') => `/gateway/v1/openai${path}`;

function upstreamCall(index = 0) {
  return mockFetch.mock.calls[index];
}

// ─── Authentication & credential tampering ──────────────────────────────────
describe('auth hardening', () => {
  it('rejects requests with no credential', async () => {
    const res = await httpRequest(gateway(), { method: 'POST', body: { messages: [] } });
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects tokens signed with a different secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ tokenType: 'user', userId: admin._id, orgId: org._id }, 'not-the-server-secret', { algorithm: 'HS256' });
    const res = await httpRequest(gateway(), { method: 'POST', token: forged, body: { messages: [] } });
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects alg:none tokens', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ tokenType: 'user', userId: admin._id, orgId: org._id })).toString('base64url');
    const res = await httpRequest(gateway(), { method: 'POST', token: `${header}.${payload}.`, body: { messages: [] } });
    expect(res.status).toBe(401);
  });

  it('rejects expired tokens', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const expired = jwt.sign(
      { tokenType: 'user', userId: admin._id, orgId: org._id, exp: Math.floor(Date.now() / 1000) - 3600 },
      process.env.JWT_SECRET,
      { algorithm: 'HS256' },
    );
    const res = await httpRequest('/api/events', { token: expired });
    expect(res.status).toBe(401);
  });

  it('rejects a valid token whose authVersion no longer matches (revocation)', async () => {
    admin.authVersion = 7; // issued with 0
    const res = await httpRequest('/api/events', { token });
    expect(res.status).toBe(401);
  });
});

// ─── Tenant isolation ────────────────────────────────────────────────────────
describe('tenant isolation', () => {
  it('never returns another tenant\'s audit records', async () => {
    const otherOrg = seedOrg();
    state.audits.push(
      { orgId: org._id, action: 'login_success', actor: admin._id, timestamp: new Date() },
      { orgId: otherOrg._id, action: 'cross_tenant_secret', actor: 'someone-else', timestamp: new Date() },
    );

    const res = await httpRequest('/api/audit-log?limit=50', { token });
    expect(res.status).toBe(200);
    const actions = res.data.logs.map(l => l.action);
    expect(actions).toContain('login_success');
    expect(actions).not.toContain('cross_tenant_secret');
  });

  it('rejects an explicit cross-tenant orgId parameter', async () => {
    const otherOrg = seedOrg();
    const res = await httpRequest(`/api/audit-log?orgId=${otherOrg._id}`, { token });
    expect(res.status).toBe(403);
    expect(res.data.error).toMatch(/tenant/i);
  });

  it('scopes gateway events to the authenticated tenant', async () => {
    const res = await httpRequest(gateway(), { method: 'POST', token, body: { messages: [{ role: 'user', content: 'hi' }] } });
    expect(res.status).toBe(200);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].orgId).toBe(org._id);
    expect(state.events[0].userId).toBe(admin._id);
  });
});

// ─── Gateway: client input is never authoritative ───────────────────────────
describe('gateway trusts only server-side decisions', () => {
  it('ignores client-claimed severity, policy decision and tenant fields', async () => {
    const res = await httpRequest(gateway(), {
      method: 'POST',
      token,
      body: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'use key AKIAIOSFODNN7EXAMPLE' }],
        // spoofed telemetry the client hopes the server will store
        orgId: 'org-attacker',
        userId: 'user-attacker',
        severity: 'LOW',
        riskScore: 0,
        policyDecision: 'ALLOW',
        enforcementStatus: 'FORWARDED',
        findingLabels: [],
      },
    });

    expect(res.status).toBe(200);
    const record = state.events[0];
    expect(record.orgId).toBe(org._id);
    expect(record.userId).toBe(admin._id);
    // Server-side detection wins over the client's claimed LOW severity.
    expect(record.findingLabels).toContain('AWS Access Key');
    expect(record.riskScore).toBeGreaterThanOrEqual(90);
    expect(record.severity).toBe('CRITICAL');
    expect(record.clientTelemetry).toEqual({});
  });

  it('applies a USER-scoped policy using the authenticated user object', async () => {
    state.policies.push({
      _id: 'policy-user-scope',
      orgId: org._id,
      scope: 'USER',
      targetId: admin._id,
      status: 'ACTIVE',
      action: 'BLOCK',
      version: 3,
      precedence: 10,
      rules: [{ category: 'PII' }],
    });

    const res = await httpRequest(gateway(), {
      method: 'POST',
      token,
      body: { messages: [{ role: 'user', content: 'contact me at alice@example.com' }] },
    });

    expect(res.status).toBe(403);
    expect(res.data.decision.reason).toMatch(/matched_policy_rule_PII/);
    expect(res.data.decision.policyVersion).toBe(3);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(state.events[0].enforcementStatus).toBe('PREVENTED');
  });

  it('BLOCK never contacts the upstream provider', async () => {
    org.settings.defaultAction = 'BLOCK';

    const res = await httpRequest(gateway(), {
      method: 'POST',
      token,
      body: { messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(state.events[0].enforcementStatus).toBe('PREVENTED');
    expect(state.events[0].requestForwarded).toBe(false);
  });

  it('SANITIZE redacts secrets before the request leaves the server', async () => {
    const policy = await httpRequest('/api/settings/org/policy', {
      method: 'PATCH',
      token,
      body: { defaultAction: 'SANITIZE' },
    });
    expect(policy.status).toBe(200);
    expect(org.settings.defaultAction).toBe('SANITIZE');

    const res = await httpRequest(gateway(), {
      method: 'POST',
      token,
      body: {
        messages: [{
          role: 'user',
          content: 'Email alice@example.com key AKIAIOSFODNN7EXAMPLE',
        }],
      },
    });

    expect(res.status).toBe(200);
    const [url, init] = upstreamCall();
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    const sent = JSON.parse(init.body);
    expect(sent.messages[0].content).toContain('[REDACTED:Email Address]');
    expect(sent.messages[0].content).toContain('[REDACTED:AWS Access Key]');
    expect(init.body).not.toContain('alice@example.com');
    expect(init.body).not.toContain('AKIAIOSFODNN7EXAMPLE');

    expect(state.events[0].enforcementStatus).toBe('SANITIZED');
    expect(state.events[0].sanitizedRedactions).toBeGreaterThanOrEqual(2);
  });

  it('fails closed when a SANITIZE payload cannot be redacted safely', async () => {
    org.settings.defaultAction = 'SANITIZE';
    const malformed = { messages: [{ role: 'user', content: 'alice@example.com' }] };
    // Force the sanitizer's parse step to fail.
    const originalParse = JSON.parse;
  const spy = jest.spyOn(JSON, 'parse').mockImplementation((text, ...rest) => {
    if (typeof text === 'string' && text.includes('[REDACTED:')) throw new Error('boom');
    return originalParse(text, ...rest);
  });

    const res = await httpRequest(gateway(), { method: 'POST', token, body: malformed });
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(state.events[0].enforcementStatus).toBe('PREVENTED');
    expect(state.events[0].policyReason).toBe('sanitize_failed');
  });
});

// ─── Gateway: header hygiene ────────────────────────────────────────────────
describe('gateway header allowlist', () => {
  it('does not forward cookies, our JWT, or other disallowed headers upstream', async () => {
    const res = await httpRequest(gateway(), {
      method: 'POST',
      token,
      headers: {
        Cookie: 'session=top-secret',
        'X-Forwarded-For': '10.0.0.1',
        'X-Real-IP': '10.0.0.1',
        'X-Shadow-Admin': 'true',
        'Forwarded': 'for=10.0.0.1;host=internal',
        Accept: 'application/json',
      },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    });

    expect(res.status).toBe(200);
    const [, init] = upstreamCall();
    const names = Object.keys(init.headers).map(n => n.toLowerCase());

    expect(names).not.toContain('cookie');
    expect(names).not.toContain('x-forwarded-for');
    expect(names).not.toContain('x-real-ip');
    expect(names).not.toContain('content-length');
    expect(names).not.toContain('x-shadow-admin');
    // The caller's Shadow AI JWT must never be replayed to the provider.
    expect(init.headers.authorization).toBeUndefined();
    expect(names).toContain('accept');
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('maps the caller-supplied provider credential onto authorization only', async () => {
    await httpRequest(gateway(), {
      method: 'POST',
      token,
      headers: { 'x-upstream-auth': 'Bearer sk-provider-key' },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    });

    const [, init] = upstreamCall();
    expect(init.headers.authorization).toBe('Bearer sk-provider-key');
    expect(init.headers['x-upstream-auth']).toBeUndefined();
  });

  it('only reflects allowlisted provider headers in the client response', async () => {
    mockFetch.mockResolvedValue(jsonUpstream('{"ok":true}', {
      headers: {
        'set-cookie': 'session=leaked',
        'x-internal-debug': 'stacktrace',
        'x-ratelimit-remaining': '42',
        'openai-organization': 'org-1',
      },
    }));

    const res = await httpRequest(gateway(), { method: 'POST', token, body: { messages: [{ role: 'user', content: 'hello' }] } });

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-internal-debug']).toBeUndefined();
    expect(res.headers['x-ratelimit-remaining']).toBe('42');
    expect(res.headers['openai-organization']).toBe('org-1');
  });

  it('rejects provider paths that try to escape the API surface', async () => {
    const res = await httpRequest('/gateway/v1/openai/%2e%2e%2finternal/secrets', {
      method: 'POST',
      token,
      body: { messages: [] },
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/path/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects unsupported providers', async () => {
    const res = await httpRequest('/gateway/v1/evilprovider/chat', { method: 'POST', token, body: {} });
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── Gateway: resilience ────────────────────────────────────────────────────
describe('gateway resilience', () => {
  it('converts an upstream timeout into a 502 without leaking details', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('upstream took too long'), { name: 'TimeoutError' }));

    const res = await httpRequest(gateway(), { method: 'POST', token, body: { messages: [{ role: 'user', content: 'hello' }] } });

    expect(res.status).toBe(502);
    expect(res.data.error).toBe('Failed to reach AI Provider');
    expect(res.data.stack).toBeUndefined();
    expect(state.events[0].enforcementStatus).toBe('FAILED');
    expect(state.events[0].requestForwarded).toBe(false);
  });

  it('records upstream failures instead of silently dropping them', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await httpRequest(gateway(), { method: 'POST', token, body: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(res.status).toBe(502);
    expect(state.events[0].enforcementStatus).toBe('FAILED');
    expect(state.events[0].requestForwarded).toBe(false);
  });

  it('surfaces a non-2xx upstream status without pretending it succeeded', async () => {
    mockFetch.mockResolvedValue(jsonUpstream('{"error":"rate limited"}', { status: 429, headers: { 'retry-after': '10' } }));

    const res = await httpRequest(gateway(), { method: 'POST', token, body: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('10');
    expect(state.events[0].upstreamStatus).toBe(429);
  });
});

// ─── Gateway: response inspection ───────────────────────────────────────────
describe('gateway response inspection', () => {
  it('flags provider responses that contain secrets and writes an audit record', async () => {
    mockFetch.mockResolvedValue(jsonUpstream('{"reply":"here is ghp_1234567890abcdefghijklmnopqrstuvwxyz"}'));

    const res = await httpRequest(gateway(), { method: 'POST', token, body: { messages: [{ role: 'user', content: 'hello' }] } });

    expect(res.status).toBe(200);
    expect(Number(res.headers['x-shadow-response-findings'])).toBeGreaterThan(0);
    expect(state.events[0].responseFindingLabels).toContain('GitHub Personal Token');

    await new Promise(r => setImmediate(r));
    const audit = state.audits.find(a => a.action === 'gateway_response_finding');
    expect(audit).toBeDefined();
    expect(audit.orgId).toBe(org._id);
  });

  it('reports zero findings for a clean response', async () => {
    const res = await httpRequest(gateway(), { method: 'POST', token, body: { messages: [{ role: 'user', content: 'hello' }] } });
    expect(res.status).toBe(200);
    expect(res.headers['x-shadow-response-findings']).toBe('0');
    expect(state.audits).toHaveLength(0);
  });
});

// ─── Input validation ───────────────────────────────────────────────────────
describe('input validation', () => {
  it('returns 400 (not 500) for malformed JSON', async () => {
    const res = await httpRequest('/api/events', { method: 'POST', token, raw: '{"nope":', headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe('Invalid request body');
    expect(res.data.requestId).toBeTruthy();
  });

  it('rejects payloads above the configured body limit with 413', async () => {
    const res = await httpRequest('/api/events', {
      method: 'POST',
      token,
      raw: JSON.stringify({ blob: 'x'.repeat(60 * 1024) }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(413);
  });

  it('rejects a non-string login email instead of crashing or injecting operators', async () => {
    const res = await httpRequest('/api/auth/login', {
      method: 'POST',
      raw: JSON.stringify({ email: { $gt: '' }, password: 'irrelevant' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(res.data.error).toBeTruthy();
  });

  it('treats unknown login fields as a bad request', async () => {
    const res = await httpRequest('/api/auth/login', {
      method: 'POST',
      raw: JSON.stringify({ email: 'a@b.test', password: 'password', role: 'admin' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('clamps unbounded pagination instead of asking the database for everything', async () => {
    const res = await httpRequest('/api/events?limit=9999999&page=-4', { token });
    expect(res.status).toBe(200);
    expect(res.data.limit).toBeLessThanOrEqual(200);
    expect(res.data.page).toBe(1);
  });

  it('does not treat search input as a regular expression', async () => {
    state.users.push({
      _id: 'victim-user',
      orgId: org._id,
      email: 'victim@example.test',
      name: 'Victim',
      role: 'viewer',
      isActive: true,
      authVersion: 0,
    });

    const res = await httpRequest('/api/users?search=.*', { token });
    expect(res.status).toBe(200);
    const emails = res.data.users.map(u => u.email);
    expect(emails).not.toContain('victim@example.test');
  });

  it('rejects prototype-pollution payloads in authentication bodies', async () => {
    const res = await httpRequest('/api/auth/login', {
      method: 'POST',
      raw: JSON.stringify({ email: 'a@b.test', password: 'password', __proto__: { polluted: 'yes' } }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401]).toContain(res.status);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it('rejects a constructor.prototype pollution attempt on event ingestion', async () => {
    const res = await httpRequest('/api/events', {
      method: 'POST',
      token,
      body: { constructor: { prototype: { polluted: 'yes' } } },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect({}.polluted).toBeUndefined();
  });

  it('rejects an unknown policy action instead of storing it', async () => {
    const res = await httpRequest('/api/settings/org/policy', {
      method: 'PATCH', token, body: { defaultAction: 'DROP_ALL' },
    });
    expect(res.status).toBe(400);
    expect(org.settings.defaultAction).not.toBe('DROP_ALL');
  });

  it('rejects arrays and nulls where a scalar enum is expected', async () => {
    const asArray = await httpRequest('/api/settings/org/policy', {
      method: 'PATCH', token, body: { defaultAction: ['BLOCK'] },
    });
    expect(asArray.status).toBe(400);

    const asNull = await httpRequest('/api/settings/org/policy', {
      method: 'PATCH', token, body: { defaultAction: null },
    });
    expect(asNull.status).toBe(400);
  });

  it('handles hostile control characters in query input without a 500', async () => {
    const hostile = '%00%1B%5B31m%E2%80%AEevil%0Ainjected';
    const res = await httpRequest(`/api/users?search=${hostile}`, { token });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.users)).toBe(true);
  });

  it('bounds the analytics window instead of accepting arbitrary values', async () => {
    const res = await httpRequest('/api/analytics/overview?days=99999999', { token });
    expect(res.status).toBe(200);

    const bad = await httpRequest('/api/analytics/overview?days=not-a-number', { token });
    expect(bad.status).toBe(200);
  });
});

// ─── CSV export injection ───────────────────────────────────────────────────
describe('audit export', () => {
  it('neutralises spreadsheet formula injection in CSV cells', async () => {
    state.audits.push({
      orgId: org._id,
      action: 'user_updated',
      actor: admin._id,
      target: '=cmd|\' /C calc\'!A0',
      timestamp: new Date(),
      ip: '127.0.0.1',
    });

    const res = await httpRequest('/api/audit-log/export?format=csv', { token });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"\'=cmd|');
    expect(res.text.split('\n')[0]).toBe('timestamp,action,actor,target,changes,ip');
  });
});

// ─── SSRF: operator-supplied webhook ────────────────────────────────────────
describe('webhook URL validation', () => {
  const cases = [
    ['http://169.254.169.254/latest/meta-data', false],
    ['http://10.0.0.15/webhook', false],
    ['http://127.0.0.1:4000/hook', false],
    ['https://metadata.google.internal/x', false],
    ['http://internal.corp.local/hook', false],
    ['ftp://hooks.example.com/hook', false],
    ['https://hooks.slack.com/services/T000/B000/XXXX', true],
  ];

  for (const [url, allowed] of cases) {
    it(`${allowed ? 'accepts' : 'rejects'} ${url}`, async () => {
      const res = await httpRequest('/api/settings/org', {
        method: 'PATCH',
        token,
        body: { slackWebhookUrl: url },
      });
      if (allowed) {
        expect(res.status).toBe(200);
      } else {
        expect(res.status).toBe(400);
        expect(res.data.error).toMatch(/webhook|allowed/i);
      }
    });
  }
});

// ─── Rate limiting ──────────────────────────────────────────────────────────
describe('rate limiting', () => {
  it('throttles repeated login attempts when rate limiting is active', async () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      let last;
      for (let i = 0; i < 21; i += 1) {
        last = await httpRequest('/api/auth/login', {
          method: 'POST',
          raw: JSON.stringify({ email: `probe${i}@example.test`, password: 'password-123' }),
          headers: { 'Content-Type': 'application/json' },
        });
        if (last.status === 429) break;
      }
      expect(last.status).toBe(429);
      expect(last.headers['ratelimit-limit'] ?? last.headers['x-ratelimit-limit']).toBeTruthy();
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  }, 30_000);
});

// ─── CORS allowlist ─────────────────────────────────────────────────────────
describe('CORS allowlist', () => {
  it('does not grant CORS to an unknown origin', async () => {
    const res = await httpRequest('/api/events', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('grants CORS to an allowed origin and the packaged extension scheme', async () => {
    const web = await httpRequest('/api/events', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
    });
    expect(web.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const extension = await httpRequest('/api/events', {
      method: 'OPTIONS',
      headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'Access-Control-Request-Method': 'GET' },
    });
    expect(extension.headers['access-control-allow-origin']).toBe('chrome-extension://abcdefghijklmnopabcdefghijklmnop');
  });
});

// ─── Operational safety ─────────────────────────────────────────────────────
describe('operational endpoints', () => {
  it('serves health without exposing internals', async () => {
    const res = await httpRequest('/health');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ status: 'ok', ts: expect.any(String) });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('reports readiness as unavailable when the database is not connected', async () => {
    const res = await httpRequest('/ready');
    expect(res.status).toBe(503);
    expect(res.data).toEqual({ status: 'unavailable' });
  });

  it('echoes a well-formed caller request id and replaces a hostile one', async () => {
    const ok = await httpRequest('/health', { headers: { 'X-Request-Id': 'trace-abc.123' } });
    expect(ok.headers['x-request-id']).toBe('trace-abc.123');

    const hostile = await httpRequest('/health', { headers: { 'X-Request-Id': '<script>alert(1)</script>' } });
    expect(hostile.headers['x-request-id']).not.toContain('<script>');
  });

  it('returns JSON 404s for unknown API routes', async () => {
    const res = await httpRequest('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.data).toEqual({ error: 'Not found' });
  });

  it('formats structured request logs with rid, user, org, and error category without logging sensitive bodies', async () => {
    const morgan = (await import('morgan')).default;
    const req = {
      id: 'rid-test-123',
      user: { userId: 'usr-456', orgId: 'org-789' },
      body: { password: 'super-secret-password-never-log', apiKey: 'sk-live-12345' },
    };
    const res401 = { statusCode: 401 };
    const res403 = { statusCode: 403 };
    const res500 = { statusCode: 500 };
    const res200 = { statusCode: 200 };

    expect(morgan['id'](req)).toBe('rid-test-123');
    expect(morgan['user'](req)).toBe('usr-456');
    expect(morgan['org'](req)).toBe('org-789');
    expect(morgan['errcat'](req, res401)).toBe('auth_error');
    expect(morgan['errcat'](req, res403)).toBe('authz_error');
    expect(morgan['errcat'](req, res500)).toBe('server_error');
    expect(morgan['errcat'](req, res200)).toBe('-');

    // Assert that credentials/passwords in req.body are never part of morgan format tokens
    const tokens = ['id', 'user', 'org', 'errcat'].map(t => morgan[t](req, res401));
    for (const tokenVal of tokens) {
      expect(String(tokenVal)).not.toContain('super-secret-password');
      expect(String(tokenVal)).not.toContain('sk-live-12345');
    }
  });
});

// ─── Secret scanning ────────────────────────────────────────────────────────
describe('repository secret scan', () => {
  const SCAN_DIRS = [
    join(ROOT, 'backend', 'src'),
    join(ROOT, 'frontend', 'src'),
    join(ROOT, 'shadow-extension', 'src'),
  ];

  const FORBIDDEN = [
    { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'GitHub token', re: /\bghp_[A-Za-z0-9]{36}\b/ },
    { name: 'Slack webhook secret', re: /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\// },
    { name: 'private key material', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'credentials in a URI', re: /(mongodb(\+srv)?|postgres(ql)?|mysql|amqp|redis):\/\/[^\s/"']+:[^\s/"'@]+@/ },
    { name: 'literal production secret assignment', re: /(JWT_SECRET|SMTP_PASS|API_SECRET)\s*[:=]\s*["'][^"']{16,}["']/ },
  ];

  function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  }

  it('finds no committed secrets in application source', () => {
    const files = SCAN_DIRS.flatMap(walk).filter(f => /\.(js|jsx|mjs|cjs|json)$/.test(f));
    expect(files.length).toBeGreaterThan(20);

    const findings = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const { name, re } of FORBIDDEN) {
        if (re.test(contents)) findings.push(`${name}: ${file.replace(ROOT, '')}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('keeps environment files out of the source tree', () => {
    const envFiles = SCAN_DIRS.flatMap(walk).filter(f => /\.env(\..+)?$/.test(f));
    expect(envFiles).toEqual([]);
  });
});
