/**
 * Shared in-memory application harness for security tests.
 *
 * Mirrors the pattern used by `gateway.integration.test.js`: every model is
 * replaced with an in-memory collection so no MongoDB instance is required, and
 * `global.fetch` is replaced with a Jest spy so upstream provider calls are
 * fully observable. Import this module BEFORE importing any application code.
 *
 * Usage:
 *   const app = await import('../helpers/mock-app.js');
 *   // app.start(), app.httpRequest(...), app.state, app.mockFetch
 */
import { randomBytes, randomUUID } from 'node:crypto';
import http, { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ??= randomBytes(48).toString('base64url');
// Short upstream timeout so timeout behaviour can be tested in milliseconds.
process.env.GATEWAY_TIMEOUT_MS ??= '400';

export const TEST_SECRET = process.env.JWT_SECRET;

// ─── In-memory state ─────────────────────────────────────────────────────────
export const state = {
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
  policies: [],
  authEvents: [],
};

export function resetState() {
  for (const key of Object.keys(state)) state[key].length = 0;
}

function matches(record, filter = {}) {
  if (!record) return false;
  return Object.entries(filter ?? {}).every(([key, expected]) => {
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

function setPath(record, path, value) {
  const parts = path.split('.');
  let target = record;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (target[parts[i]] === undefined || target[parts[i]] === null || typeof target[parts[i]] !== 'object') {
      target[parts[i]] = {};
    }
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
}

function applyUpdate(record, update = {}) {
  for (const [key, value] of Object.entries(update.$set ?? {})) setPath(record, key, value);
  for (const [key, value] of Object.entries(update.$inc ?? {})) record[key] = (record[key] ?? 0) + value;
  for (const [key, value] of Object.entries(update)) {
    if (!key.startsWith('$') && value !== undefined) record[key] = value;
  }
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
    distinct: jest.fn((field, filter) => query(() => [
      ...new Set(collection.filter(record => matches(record, filter)).map(r => r[field])),
    ])),
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
    createIndexes: jest.fn(async () => {}),
    collection: { dropIndex: jest.fn(async () => {}) },
  };
}

export const User = model(state.users, 'User');
export const Org = model(state.orgs, 'Org');
export const Device = model(state.devices, 'Device');
export const Event = model(state.events, 'Event');
export const EventReplay = model(state.replays, 'EventReplay');
export const AuditLog = model(state.audits, 'AuditLog');
export const PlatformAdmin = model(state.platformAdmins, 'PlatformAdmin');
export const TenantInvitation = model(state.invitations, 'TenantInvitation');
export const PlatformAuditLog = model(state.platformAudits, 'PlatformAuditLog');
export const Justification = model(state.justifications, 'Justification');
export const AuthEvent = model(state.authEvents, 'AuthEvent');

// Policies are seeded directly by tests; the query shape is intentionally loose.
export const Policy = {
  find: jest.fn(() => ({
    sort: () => ({ lean: async () => state.policies.filter(p => p.status !== 'ARCHIVED') }),
  })),
};

// Resolve mock targets relative to THIS file so registration does not depend on
// which test file imported the harness (jest otherwise resolves the specifier
// relative to the importing test, which made standalone runs fail).
const srcUrl = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));

jest.unstable_mockModule(srcUrl('../../src/models/index.js'), () => ({
  User, Org, Device, Event, EventReplay, Justification,
  AuditLog, PlatformAdmin, TenantInvitation, PlatformAuditLog, AuthEvent,
  Team: {}, Policy,
}));

jest.unstable_mockModule(srcUrl('../../src/services/alerting.js'), () => ({
  sendSlackAlert: jest.fn().mockResolvedValue(undefined),
  sendEmailAlert: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule(srcUrl('../../src/services/scoring.js'), () => ({
  recalcSecurityScore: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule(srcUrl('../../src/server.js'), () => ({
  broadcastAlert: jest.fn(),
}));

const { createApp } = await import('../../src/app.js');

export const mockFetch = jest.fn();
global.fetch = mockFetch;

// ─── HTTP helpers ────────────────────────────────────────────────────────────
let baseUrl;
let server;

export function httpRequest(path, { token, method = 'GET', body, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const bodyStr = raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        ...(bodyStr !== undefined
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    };
    const req = http.request(opts, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(text); } catch { /* non-JSON body */ }
        resolve({ status: res.statusCode, headers: res.headers, text, data });
      });
    });
    req.on('error', reject);
    if (bodyStr !== undefined) req.write(bodyStr);
    req.end();
  });
}

// http.request above bypasses global.fetch, so the upstream spy stays isolated.

export async function start() {
  const app = createApp();
  server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
  return baseUrl;
}

export async function stop() {
  if (server) {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
  server = null;
}

// ─── Token helpers ───────────────────────────────────────────────────────────
export function userToken(user) {
  return jwt.sign({
    tokenType: 'user',
    userId: user._id,
    orgId: user.orgId,
    authVersion: user.authVersion ?? 0,
  }, TEST_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

export function seedOrg(overrides = {}) {
  const org = {
    _id: `org-${randomUUID()}`,
    name: 'Security Test Org',
    lifecycleStatus: 'active',
    settings: { defaultAction: 'ALLOW', policyVersion: 1 },
    authVersion: 0,
    ...overrides,
  };
  state.orgs.push(org);
  return org;
}

export function seedUser(org, overrides = {}) {
  const user = {
    _id: `user-${randomUUID()}`,
    orgId: org._id,
    email: `user-${randomUUID().slice(0, 8)}@example.test`,
    name: 'Security Test User',
    role: 'admin',
    authType: 'user',
    authVersion: 0,
    isActive: true,
    ...overrides,
  };
  state.users.push(user);
  return user;
}

export function platformToken(admin) {
  return jwt.sign({
    tokenType: 'platform_admin',
    platformAdminId: admin._id,
    role: admin.role ?? 'super_admin',
    authVersion: admin.authVersion ?? 0,
  }, TEST_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

export function seedPlatformAdmin(overrides = {}) {
  const admin = {
    _id: `platformadmin-${randomUUID()}`,
    email: `platform-${randomUUID().slice(0, 8)}@example.test`,
    passwordHash: 'not-checked-by-token-helper',
    role: 'super_admin',
    isActive: true,
    authVersion: 0,
    ...overrides,
  };
  state.platformAdmins.push(admin);
  return admin;
}

export function seedEvent(org, overrides = {}) {
  const event = {
    _id: `event-${randomUUID()}`,
    orgId: org._id,
    domain: 'chat.openai.com',
    eventType: 'PROMPT',
    severity: 'LOW',
    riskScore: 5,
    policyDecision: 'ALLOW',
    enforcementStatus: 'NOT_ATTEMPTED',
    findingLabels: [],
    timestamp: new Date(),
    investigation: { status: 'open', note: '', updatedBy: null, updatedAt: null },
    ...overrides,
  };
  state.events.push(event);
  return event;
}
