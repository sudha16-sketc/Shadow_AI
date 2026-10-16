import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import logger from './utils/logger.js';
import authRoutes from './routes/auth.js';
import eventsRoutes from './routes/events.js';
import usersRoutes from './routes/users.js';
import analyticsRoutes from './routes/analytics.js';
import settingsRoutes from './routes/settings.js';
import justificationsRoutes from './routes/justifications.js';
import auditLogRoutes from './routes/audit-log.js';
import platformAdminRoutes from './routes/platform-admin.js';
import platformMonitoringRoutes from './routes/platform-monitoring.js';
import platformManagersRoutes from './routes/platform-managers.js';
import policiesRoutes from './routes/policies.js';
import gatewayRoutes from './routes/gateway.js';
import { authMiddleware } from './middleware/auth.js';
import { recordServerError } from './services/metrics.js';

const DEFAULT_ORIGINS = [
  // Local development
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  // Deployed frontend (Vercel)
  'https://shadow-ai-six-khaki.vercel.app',
];

const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

export function resolveAllowedOrigins(raw = process.env.CORS_ORIGINS) {
  const configured = String(raw ?? '')
    .split(',')
    .map(value => value.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const origins = configured.length > 0 ? configured : DEFAULT_ORIGINS;
  if (process.env.NODE_ENV === 'production' && configured.length === 0) {
    logger.warn('CORS_ORIGINS is not set; falling back to built-in development and deployed origins');
  }
  return new Set(origins);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true; // same-origin, curl, server-to-server: no CORS header needed
  const normalized = origin.replace(/\/$/, '');
  if (allowedOrigins.has(normalized)) return true;
  // Packaged extension builds are identified by their immutable extension id.
  return EXTENSION_ORIGIN_RE.test(normalized);
}

export function createApp() {
  const app = express();
  const allowedOrigins = resolveAllowedOrigins();

  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
    // Only enable when deployed behind a reverse proxy so that
    // req.ip / rate limiting / audit logs use the real client address.
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => callback(null, isOriginAllowed(origin, allowedOrigins)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    credentials: true,
    maxAge: 600,
  }));
  app.options('*', cors({
    origin: (origin, callback) => callback(null, isOriginAllowed(origin, allowedOrigins)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: true,
    maxAge: 600,
  }));
  // Correlation id: registered before body parsing so that payload errors
  // are still attributable to a request.
  app.use((req, res, next) => {
    const supplied = req.headers['x-request-id'];
    const requestId = (typeof supplied === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(supplied))
      ? supplied
      : randomUUID();
    req.id = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  app.use(express.json({ limit: '50kb' }));

  morgan.token('id', req => req.id ?? '-');
  morgan.token('user', req => req.user?.userId ?? req.platformAdmin?.id ?? '-');
  morgan.token('org', req => req.user?.orgId ?? req.tenantId ?? '-');
  morgan.token('errcat', (_req, res) => {
    const status = res.statusCode;
    if (status >= 500) return 'server_error';
    if (status === 401) return 'auth_error';
    if (status === 403) return 'authz_error';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status >= 400) return 'client_error';
    return '-';
  });

  app.use(morgan(':method :url :status :response-time ms rid=:id user=:user org=:org err=:errcat', {
    skip: () => process.env.NODE_ENV === 'test',
    stream: { write: msg => logger.info(msg.trim()) },
  }));

  const skipInTests = () => process.env.NODE_ENV === 'test';

  app.use('/api/events', rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, skip: skipInTests }));
  app.use('/api/auth', rateLimit({
    windowMs: 60_000,
    max: 20,
    standardHeaders: true,
    skip: skipInTests,
  }));
  app.use('/api/platform-admin', rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    skip: skipInTests,
  }));
  app.use('/gateway/v1', rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    skip: skipInTests,
  }));
  app.use('/api/policies', rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    skip: skipInTests,
  }));

  app.use('/api/platform-admin/monitoring', platformMonitoringRoutes);
  app.use('/api/platform-admin/managers', platformManagersRoutes);
  app.use('/api/platform-admin', platformAdminRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/users', authMiddleware, usersRoutes);
  app.use('/api/analytics', authMiddleware, analyticsRoutes);
  app.use('/api/settings', authMiddleware, settingsRoutes);
  app.use('/api/justifications', authMiddleware, justificationsRoutes);
  app.use('/api/audit-log', authMiddleware, auditLogRoutes);
  app.use('/api/policies', policiesRoutes);
  app.use('/gateway/v1', authMiddleware, gatewayRoutes);

  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

  // Readiness reports dependency availability only — no internal detail.
  app.get('/ready', async (req, res) => {
    const mongoose = (await import('mongoose')).default;
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err, req, res, _next) => {
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
      ? err.status
      : undefined;
    const isBodyParseError = err?.type === 'entity.parse.failed'
      || err?.type === 'entity.too.large'
      || err instanceof SyntaxError;

    const user = req.user?.userId ?? req.platformAdmin?.id ?? '-';
    const org = req.user?.orgId ?? req.tenantId ?? '-';

    if (isBodyParseError || status === 400 || status === 413) {
      logger.warn(`Bad request on ${req.method} ${req.originalUrl} rid=${req.id} user=${user} org=${org} err=client_error`);
      return res.status(err?.status ?? (err?.type === 'entity.too.large' ? 413 : 400))
        .json({ error: err?.type === 'entity.too.large' ? 'Payload too large' : 'Invalid request body', requestId: req.id });
    }

    logger.error(`Unhandled error on ${req.method} ${req.originalUrl} rid=${req.id} user=${user} org=${org} err=server_error`, err);
    recordServerError({
      method: req.method,
      path: req.originalUrl,
      status: status ?? 500,
      category: 'server_error',
    });
    res.status(status ?? 500).json({ error: 'Internal error', requestId: req.id });
  });

  return app;
}

export default createApp();
