import express from 'express';
import { randomUUID } from 'node:crypto';
import { evaluatePolicy } from '../services/policy-engine.js';
import { AuditLog, Event, Org, User } from '../models/index.js';
import logger from '../utils/logger.js';

const router = express.Router();

const GATEWAY_TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS ?? 60_000);
const MAX_UPSTREAM_PATH_LENGTH = 512;

// ─── Detection Adapter ───
// Server-side copy of the extension detection patterns. The server, not the
// client, decides what a request contains.
const PATTERNS = [
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS Access Key' },
  { re: /\bsk_(live|test)_[0-9a-zA-Z]{24,}\b/g, label: 'Stripe Secret Key' },
  { re: /\bpk_(live|test)_[0-9a-zA-Z]{24,}\b/g, label: 'Stripe Publishable Key' },
  { re: /\bghp_[0-9a-zA-Z]{36}\b/g, label: 'GitHub Personal Token' },
  { re: /\bgho_[0-9a-zA-Z]{36}\b/g, label: 'GitHub OAuth Token' },
  { re: /\bnpm_[0-9a-zA-Z]{36}\b/g, label: 'NPM Token' },
  { re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, label: 'JWT Token' },
  { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: 'Private Key' },
  { re: /(mongodb|postgres|mysql|redis):\/\/[^\s"']{8,}/gi, label: 'Database Connection String' },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, label: 'Social Security Number' },
  { re: /\b4[0-9]{12}(?:[0-9]{3})?\b|\b5[1-5][0-9]{14}\b/g, label: 'Credit Card Number' },
  { re: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g, label: 'Email Address' },
  { re: /(password|passwd|secret|api_key)\s*[:=]\s*["']?[^\s"',;]{6,}/gi, label: 'Password/Secret' },
];

const KEYWORDS = [
  'confidential', 'internal only', 'do not share', 'not for distribution',
  'trade secret', 'attorney-client', 'private key', 'access token',
  'bearer token', 'classified',
];

function analyzeText(text) {
  const labels = new Set();
  if (!text || typeof text !== 'string') return Array.from(labels);

  for (const { re, label } of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) labels.add(label);
  }

  const lower = text.toLowerCase();
  for (const word of KEYWORDS) {
    if (lower.includes(word)) labels.add(word);
  }

  return Array.from(labels);
}

function extractTextFromOpenAI(body) {
  if (!body || !Array.isArray(body.messages)) return '';
  return body.messages.map(m => (typeof m?.content === 'string' ? m.content : '')).filter(Boolean).join('\n');
}

function extractTextFromAnthropic(body) {
  if (!body || !Array.isArray(body.messages)) return '';
  return body.messages.map(m => {
    if (typeof m?.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map(c => (typeof c?.text === 'string' ? c.text : '')).filter(Boolean).join('\n');
    return '';
  }).join('\n');
}

/**
 * Minimal, deterministic request sanitization for policy action SANITIZE.
 *
 * Replaces every detected credential/PII pattern match inside the serialized
 * request body with `[REDACTED:<label>]`. Pattern matches never contain JSON
 * metacharacters, so the round-trip through JSON.stringify/parse cannot corrupt
 * the payload structure. Keyword-only findings (proprietary terms) are not
 * redactable text and are left in place — see SECURITY_FEATURES.md.
 */
function sanitizeBody(body) {
  let text = JSON.stringify(body);
  let redactions = 0;

  for (const { re, label } of PATTERNS) {
    re.lastIndex = 0;
    text = text.replace(re, () => {
      redactions += 1;
      return `[REDACTED:${label}]`;
    });
  }

  if (redactions === 0) return { body, redactions: 0 };
  try {
    return { body: JSON.parse(text), redactions };
  } catch {
    // Should be unreachable: pattern matches never contain JSON metacharacters.
    logger.error('SANITIZE produced unparseable payload; failing closed');
    return { body: null, redactions: -1 };
  }
}

function extractText(body, providerConfig) {
  try {
    return providerConfig.extractText(body);
  } catch {
    return '';
  }
}

// ─── Provider Allowlist ───
const PROVIDERS = {
  openai: {
    baseUrl: 'https://api.openai.com',
    extractText: extractTextFromOpenAI,
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    extractText: extractTextFromAnthropic,
  },
};

// Headers that may be forwarded to the upstream AI provider. Everything else
// (cookies, forwarded-for chains, our own authorization header, hop-by-hop
// headers) is dropped.
const REQUEST_HEADER_ALLOWLIST = new Set([
  'content-type',
  'accept',
  'accept-language',
  'openai-organization',
  'openai-project',
  'anthropic-version',
  'anthropic-beta',
  'x-api-key',
  'x-request-id',
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  'content-type',
  'cache-control',
  'date',
  'etag',
  'last-modified',
  'retry-after',
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'www-authenticate',
]);
const RESPONSE_HEADER_PREFIXES = ['openai-', 'anthropic-'];

function isSafeUpstreamPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_UPSTREAM_PATH_LENGTH) return false;
  if (!/^[A-Za-z0-9._~\-/]+$/.test(path)) return false;
  if (path.includes('//') || path.split('/').includes('..')) return false;
  return true;
}

function buildUpstreamHeaders(req) {
  const headers = {};
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = req.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  headers['content-type'] = 'application/json';

  const upstreamAuth = req.headers['x-upstream-auth'];
  if (typeof upstreamAuth === 'string' && upstreamAuth.length > 0 && upstreamAuth.length <= 4096) {
    headers.authorization = upstreamAuth;
  }
  return headers;
}

function copyUpstreamResponseHeaders(upstreamRes, res) {
  for (const [key, value] of upstreamRes.headers) {
    const name = key.toLowerCase();
    if (RESPONSE_HEADER_ALLOWLIST.has(name) || RESPONSE_HEADER_PREFIXES.some(prefix => name.startsWith(prefix))) {
      try { res.setHeader(name, value); } catch { /* invalid header value */ }
    }
  }
}

// ─── Gateway Route ───
// Auth is provided by the `authMiddleware` mounted at /gateway/v1 in app.js.
router.post('/:provider/*', async (req, res) => {
  const requestId = req.id;

  try {
    const { provider } = req.params;
    const providerConfig = PROVIDERS[provider];

    if (!providerConfig) {
      return res.status(400).json({ error: 'Unsupported provider', requestId });
    }

    const upstreamPath = req.params[0];
    if (!isSafeUpstreamPath(upstreamPath)) {
      return res.status(400).json({ error: 'Invalid provider path', requestId });
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'JSON request body required', requestId });
    }

    // 1. Identity and tenant context come from the verified credential only.
    const orgId = req.user.orgId;
    const userId = req.user.userId;
    const deviceId = req.user.deviceId || 'unknown';

    const org = await Org.findById(orgId).lean();
    if (!org || org.lifecycleStatus !== 'active') {
      return res.status(401).json({ error: 'Tenant resolution failed', requestId });
    }

    // 2. Server-side request analysis — client claims are never consulted.
    const extractedText = extractText(req.body, providerConfig);
    const findingLabels = analyzeText(extractedText);

    // 3. Server-authoritative policy evaluation.
    const userRef = req.authUser
      ?? await User.findOne({ _id: userId, orgId, isActive: true }).lean();

    const policyResult = await evaluatePolicy({
      orgId,
      userRef: userRef ?? { _id: userId },
      findingLabels,
      orgSettings: org.settings,
    });

    const eventId = randomUUID();
    let enforcementStatus = 'NOT_ATTEMPTED';
    let requestForwarded = false;
    let sanitizedRedactions = 0;
    let outboundBody = req.body;
    let upstreamStatus = null;

    const baseRecord = {
      orgId,
      userId,
      deviceId,
      idempotencyKey: `gateway-${eventId}`,
      domain: provider,
      riskScore: policyResult.riskScore,
      severity: policyResult.severity,
      findingLabels,
      policyDecision: policyResult.decision,
      policyReason: policyResult.reason,
      policyVersion: policyResult.policyVersion,
      clientTelemetry: {},
    };

    // 4. BLOCK — stop here. The upstream provider is never contacted.
    if (policyResult.decision === 'BLOCK') {
      enforcementStatus = 'PREVENTED';
      await Event.create({ ...baseRecord, enforcementStatus, requestForwarded: false });
      logger.warn(`Gateway BLOCK org=${orgId} provider=${provider} rid=${requestId}`);
      return res.status(403).json({
        error: 'Blocked by Shadow AI Security Policy',
        decision: policyResult,
        requestId,
      });
    }

    // 5. SANITIZE — redact detected secrets before the request leaves us.
    if (policyResult.decision === 'SANITIZE') {
      const sanitized = sanitizeBody(req.body);
      if (sanitized.redactions < 0) {
        // Fail closed: never forward under a SANITIZE policy without sanitizing.
        enforcementStatus = 'PREVENTED';
        await Event.create({
          ...baseRecord,
          policyReason: 'sanitize_failed',
          enforcementStatus,
          requestForwarded: false,
          upstreamStatus: null,
          sanitizedRedactions: 0,
          responseFindingLabels: [],
        });
        logger.error(`Gateway SANITIZE failure org=${orgId} rid=${requestId}`);
        return res.status(500).json({ error: 'Request could not be sanitized', requestId });
      }
      outboundBody = sanitized.body;
      sanitizedRedactions = sanitized.redactions;
      if (sanitizedRedactions > 0) enforcementStatus = 'SANITIZED';
    }

    if (enforcementStatus !== 'SANITIZED') {
      enforcementStatus = 'FORWARDED';
    }
    requestForwarded = true;

    // 6. Forward to the allowlisted provider origin.
    const upstreamUrl = `${providerConfig.baseUrl}/${upstreamPath}`;
    let upstreamRes;
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: 'POST',
        headers: buildUpstreamHeaders(req),
        body: JSON.stringify(outboundBody),
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
        redirect: 'error',
      });
      upstreamStatus = upstreamRes.status;
    } catch (err) {
      enforcementStatus = 'FAILED';
      requestForwarded = false;
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      logger.error(`Gateway upstream failure provider=${provider} timedOut=${timedOut} rid=${requestId}`, err);
    }

    const record = {
      ...baseRecord,
      enforcementStatus,
      requestForwarded,
      upstreamStatus,
      sanitizedRedactions,
      responseFindingLabels: [],
    };

    if (enforcementStatus === 'FAILED') {
      await Event.create(record);
      return res.status(502).json({ error: 'Failed to reach AI Provider', requestId });
    }

    // 7. Response inspection — detect provider content that violates policy.
    const rawBody = Buffer.from(await upstreamRes.arrayBuffer());
    const contentType = upstreamRes.headers.get('content-type') ?? '';
    let responseFindingLabels = [];
    if (/json|text/.test(contentType)) {
      const text = Buffer.from(rawBody).toString('utf8').slice(0, 1_000_000);
      responseFindingLabels = analyzeText(text);
    }

    if (responseFindingLabels.length > 0) {
      record.responseFindingLabels = responseFindingLabels;
      logger.warn(`Gateway response inspection org=${orgId} findings=${responseFindingLabels.join(',')} rid=${requestId}`);
      AuditLog.create({
        orgId,
        action: 'gateway_response_finding',
        actor: userRef?._id ?? userId,
        target: eventId,
        changes: { provider, findings: responseFindingLabels, upstreamStatus },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(err => logger.error('Response inspection audit write failed', err));
    }

    await Event.create(record);

    res.status(upstreamRes.status);
    copyUpstreamResponseHeaders(upstreamRes, res);
    res.setHeader('X-Shadow-Response-Findings', String(responseFindingLabels.length));
    res.setHeader('X-Request-Id', requestId);
    return res.send(rawBody);
  } catch (error) {
    logger.error(`Gateway error rid=${requestId}`, error);
    return res.status(500).json({ error: 'Gateway Internal Error', requestId });
  }
});

export default router;
