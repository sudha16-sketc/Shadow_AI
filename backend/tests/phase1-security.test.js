import { jest } from '@jest/globals';
import { randomBytes } from 'node:crypto';

process.env.JWT_SECRET = randomBytes(48).toString('base64url');
const jwt = (await import('jsonwebtoken')).default;

const mockBroadcast = jest.fn();
const mockOrg = {
  findById: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  create: jest.fn(),
};

const mockUser = {
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(),
  distinct: jest.fn(),
};

const mockEvent = {
  findOne: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
  find: jest.fn(),
  findByIdAndUpdate: jest.fn(),
};

const mockEventReplay = {
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockResolvedValue(true),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
};

const mockAuditLog = {
  create: jest.fn(),
};

const mockScoring = {
  recalcSecurityScore: jest.fn().mockResolvedValue(true),
};

const mockAlerting = {
  sendSlackAlert: jest.fn().mockResolvedValue(true),
  sendEmailAlert: jest.fn().mockResolvedValue(true),
};

jest.unstable_mockModule('../src/server.js', () => ({
  broadcastAlert: mockBroadcast,
}));

jest.unstable_mockModule('../src/services/scoring.js', () => mockScoring);

jest.unstable_mockModule('../src/services/alerting.js', () => mockAlerting);

jest.unstable_mockModule('../src/models/index.js', () => ({
  Org: mockOrg,
  User: mockUser,
  Event: mockEvent,
  EventReplay: mockEventReplay,
  AuditLog: mockAuditLog,
  PlatformAdmin: {},
  TenantInvitation: {},
  PlatformAuditLog: {},
  Device: {},
  Policy: {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([])
      })
    })
  }
}));

const { authMiddleware, requireTenantAccess } = await import('../src/middleware/auth.js');
const { default: eventsRouter, processEvent } = await import('../src/routes/events.js');

const JWT_SECRET = process.env.JWT_SECRET;

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOrg.findById.mockResolvedValue({
    _id: 'org-1',
    settings: { defaultAction: 'BLOCK', blockOnHigh: true, alertOnMedium: false },
  });
  mockOrg.findOne.mockResolvedValue({
    _id: 'org-1',
    lifecycleStatus: 'active',
    policyVersion: 1,
    settings: { defaultAction: 'BLOCK', blockOnHigh: true, alertOnMedium: false },
  });
  mockUser.findOne.mockResolvedValue({ _id: 'user-tenant', optedOut: false });
  mockEvent.findOne.mockResolvedValue(null);
  mockEvent.create.mockResolvedValue({
    _id: 'evt-1',
    severity: 'HIGH',
    toObject: () => ({ _id: 'evt-1' }),
  });
  mockAuditLog.create.mockResolvedValue(true);
});

describe('Phase 1 security controls', () => {
  it('rejects JWTs missing tenant context', () => {
    const token = jwt.sign({ userId: 'user-1', role: 'admin' }, JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    const next = jest.fn();

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts tenant-bound user tokens and attaches tenant context', async () => {
    const token = jwt.sign({ tokenType: 'user', userId: 'user-1', orgId: 'org-1', authVersion: 0 }, JWT_SECRET);
    mockUser.findOne.mockResolvedValue({ _id: 'user-1', orgId: 'org-1', role: 'admin', authVersion: 0 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = makeRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ userId: 'user-1', orgId: 'org-1', role: 'admin' });
  });

  it('rejects cross-tenant access attempts', () => {
    const req = { user: { orgId: 'org-1' }, body: { organizationId: 'org-2' } };
    const res = makeRes();
    const next = jest.fn();

    requireTenantAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects forged userId and tenant values from the extension payload', async () => {
    const route = eventsRouter.stack.find(layer => layer.route && layer.route.path === '/').route.stack.at(-1).handle;
    const req = {
      headers: { 'user-agent': 'jest-test' },
      user: { userId: 'user-tenant', orgId: 'org-1', role: 'device', authType: 'device', deviceId: 'device-1' },
      body: {
        userId: 'forged-attacker',
        domain: 'chat.openai.com',
        eventType: 'paste',
        riskScore: 87,
        severity: 'HIGH',
        maskedPreview: 'abcd****efgh',
        findingLabels: ['AWS Access Key'],
      },
      ip: '127.0.0.1',
    };
    const res = makeRes();

    await route(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockEvent.create).not.toHaveBeenCalled();
  });

  it('rejects malformed event payloads before processing', async () => {
    const route = eventsRouter.stack.find(layer => layer.route && layer.route.path === '/').route.stack.at(-1).handle;
    const req = {
      headers: { 'user-agent': 'jest-test' },
      user: { userId: 'user-tenant', orgId: 'org-1', role: 'device', authType: 'device', deviceId: 'device-1' },
      body: {
        userId: 'user-tenant',
        domain: 'chat.openai.com',
        eventType: 'not-real',
        riskScore: 87,
        severity: 'HIGH',
      },
      ip: '127.0.0.1',
    };
    const res = makeRes();

    await route(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('enforces fail-closed policy precedence when the org policy defaults to BLOCK', async () => {
    mockOrg.findOne.mockResolvedValue({
      _id: 'org-1',
      lifecycleStatus: 'active',
      policyVersion: 1,
      settings: { defaultAction: 'BLOCK', blockOnHigh: false, alertOnMedium: false },
    });

    await processEvent(
      {
        idempotencyKey: 'unit-test-event-key-0001',
        userId: 'user-tenant',
        domain: 'chat.openai.com',
        eventType: 'paste',
        riskScore: 80,
        severity: 'HIGH',
        maskedPreview: 'abc',
        findingLabels: ['AWS Access Key'],
        timestamp: new Date().toISOString(),
      },
      { orgId: 'org-1', userId: 'user-tenant', deviceId: null },
      { ip: '127.0.0.1', headers: { 'user-agent': 'jest-test' } }
    );

    expect(mockEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      policyDecision: 'BLOCK',
      clientTelemetry: expect.objectContaining({ severity: 'HIGH' }),
    }));
  });

  it('detects duplicate idempotency keys and rejects replayed submissions', async () => {
    const route = eventsRouter.stack.find(layer => layer.route && layer.route.path === '/').route.stack.at(-1).handle;
    mockEvent.findOne.mockResolvedValue({ _id: 'existing-event' });
    const req = {
      headers: { 'user-agent': 'jest-test' },
      user: { userId: 'user-tenant', orgId: 'org-1', role: 'device', authType: 'device', deviceId: 'device-1' },
      body: {
        idempotencyKey: 'duplicate-event-key-123',
        domain: 'chat.openai.com',
        eventType: 'paste',
        riskScore: 55,
        severity: 'MEDIUM',
        timestamp: new Date().toISOString(),
      },
      ip: '127.0.0.1',
    };
    const res = makeRes();

    await route(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ ok: true, requestPrevented: false, duplicate: true });
  });
});
