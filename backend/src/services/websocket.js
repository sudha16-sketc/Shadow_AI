import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';

const TICKET_TTL_MS = 20_000;
const tickets = new Map();
const tenantClients = new Map();

export function issueWebSocketTicket(user) {
  const now = Date.now();
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(ticket);
  }

  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, {
    orgId: String(user.orgId),
    userId: String(user.userId),
    role: user.role,
    expiresAt: now + TICKET_TTL_MS,
  });
  return { ticket, expiresAt: now + TICKET_TTL_MS };
}

function consumeWebSocketTicket(ticket) {
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry || entry.expiresAt <= Date.now() || !['admin', 'manager'].includes(entry.role)) return null;
  return entry;
}

export function attachTenantWebSockets(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let requestUrl;
    try {
      requestUrl = new URL(req.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    if (requestUrl.pathname !== '/api/alerts') {
      socket.destroy();
      return;
    }

    const identity = consumeWebSocketTicket(requestUrl.searchParams.get('ticket'));
    if (!identity) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      ws.tenantId = identity.orgId;
      ws.userId = identity.userId;
      const clients = tenantClients.get(identity.orgId) ?? new Set();
      clients.add(ws);
      tenantClients.set(identity.orgId, clients);

      ws.on('message', () => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'ERROR', error: 'Client-selected subscriptions are not supported' }));
        }
      });
      ws.on('close', () => {
        clients.delete(ws);
        if (clients.size === 0) tenantClients.delete(identity.orgId);
      });
      wss.emit('connection', ws, req);
    });
  });

  return wss;
}

export function broadcastTenantAlert(event) {
  const clients = tenantClients.get(String(event.orgId));
  if (!clients) return;

  const message = JSON.stringify({ type: 'ALERT', event });
  for (const client of clients) {
    if (client.readyState === 1) client.send(message);
  }
}

export function revokeWebSocketUser(userId) {
  const target = String(userId);
  for (const [ticket, entry] of tickets) {
    if (entry.userId === target) tickets.delete(ticket);
  }
  for (const clients of tenantClients.values()) {
    for (const client of clients) {
      if (client.userId === target) client.close(1008, 'Authorization revoked');
    }
  }
}

export function revokeWebSocketTenant(tenantId) {
  const target = String(tenantId);
  for (const [ticket, entry] of tickets) {
    if (entry.orgId === target) tickets.delete(ticket);
  }
  const clients = tenantClients.get(target);
  if (!clients) return;
  for (const client of clients) client.close(1008, 'Tenant suspended');
}
