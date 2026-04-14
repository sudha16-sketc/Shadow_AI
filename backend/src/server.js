// backend/src/server.js
/**
 * Shadow AI Auditor — Express Server
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import logger from './utils/logger.js';
import authRoutes from './routes/auth.js';
import eventsRoutes from './routes/events.js';
import usersRoutes from './routes/users.js';
import analyticsRoutes from './routes/analytics.js';
import settingsRoutes from './routes/settings.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();
const httpServer = createServer(app);

// ─── WebSocket (real-time alerts) ─────────────────────────────────────────────
export const wss = new WebSocketServer({ server: httpServer });
const adminClients = new Set();

wss.on('connection', (ws, req) => {
  // In production: verify JWT from query param before adding to adminClients
  adminClients.add(ws);
  ws.on('close', () => adminClients.delete(ws));
});

export function broadcastAlert(event) {
  const msg = JSON.stringify({ type: 'ALERT', event });
  adminClients.forEach(client => {
    if (client.readyState === 1) client.send(msg); // OPEN
  });
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());
app.use(express.json({ limit: '50kb' })); // prevent oversized payloads
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// Rate limiting — generous for events (extension sends many), strict for auth
app.use('/api/events', rateLimit({ windowMs: 60_000, max: 500, standardHeaders: true }));
app.use('/api/auth',   rateLimit({ windowMs: 60_000, max: 20,  standardHeaders: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/events',    eventsRoutes);         // no auth — extension sends events
app.use('/api/users',     authMiddleware, usersRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/settings',  authMiddleware, settingsRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Internal error' });
});

// ─── DB + Start ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001;

mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://localhost:27017/shadow-ai-auditor')
  .then(() => {
    logger.info('MongoDB connected');
    httpServer.listen(PORT, () => logger.info(`Server running on :${PORT}`));
  })
  .catch(err => { logger.error('DB connection failed', err); process.exit(1); });