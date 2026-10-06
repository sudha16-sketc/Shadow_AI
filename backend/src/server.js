// backend/src/server.js
/**
 * Shadow AI Auditor — Express Server
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { fileURLToPath } from 'node:url';
import { Device, Event, EventReplay, Org, PlatformAdmin, PlatformAuditLog, TenantInvitation } from './models/index.js';
import app from './app.js';
import { attachTenantWebSockets, broadcastTenantAlert } from './services/websocket.js';
import logger from './utils/logger.js';

const httpServer = createServer(app);
export const wss = attachTenantWebSockets(httpServer);

export function broadcastAlert(event) {
  broadcastTenantAlert(event);
}

const PORT = process.env.PORT ?? 3001;
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS ?? 15_000);

function resolveMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (uri) return uri;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('MONGODB_URI must be provided when NODE_ENV=production.');
  }
  return 'mongodb://localhost:27017/shadow-ai-auditor';
}

export async function startServer() {
  await mongoose.connect(resolveMongoUri(), { autoIndex: false });
  try {
    await Event.collection.dropIndex('orgId_1_idempotencyKey_1');
  } catch (err) {
    if (![26, 27].includes(err.code) && err.codeName !== 'IndexNotFound' && err.codeName !== 'NamespaceNotFound') throw err;
  }
  await Promise.all([
    Event.createIndexes(),
    EventReplay.createIndexes(),
    Device.createIndexes(),
    Org.createIndexes(),
    PlatformAdmin.createIndexes(),
    TenantInvitation.createIndexes(),
    PlatformAuditLog.createIndexes(),
  ]);
  logger.info('MongoDB connected');
  httpServer.listen(PORT, () => logger.info(`Server running on :${PORT}`));
}

/**
 * Graceful shutdown: stop accepting new connections, give in-flight requests a
 * bounded window, close the database connection, then exit.
 */
export function shutdown(signal) {
  logger.info(`${signal} received — draining connections`);

  const forceExit = setTimeout(() => {
    logger.error(`Shutdown exceeded ${SHUTDOWN_GRACE_MS}ms — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  forceExit.unref();

  httpServer.close(async (err) => {
    if (err) logger.error('HTTP server close failed', err);
    try {
      await mongoose.disconnect();
      logger.info('MongoDB disconnected');
    } catch (disconnectErr) {
      logger.error('MongoDB disconnect failed', disconnectErr);
    }
    clearTimeout(forceExit);
    logger.info('Shutdown complete');
    process.exit(0);
  });

  httpServer.closeIdleConnections?.();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch(err => {
    logger.error('Startup failed', err);
    process.exit(1);
  });

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });
}
