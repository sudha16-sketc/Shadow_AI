// backend/src/routes/settings.js
/**
 * Shadow AI Auditor — Settings Routes
 *
 * All routes require admin role.
 *
 * GET    /api/settings/org          — get org config (name, score, alert settings)
 * PATCH  /api/settings/org          — update org name, Slack webhook, alert email
 * PATCH  /api/settings/org/policy   — update detection policy toggles
 * POST   /api/settings/slack/test   — send a test Slack message
 * POST   /api/settings/email/test   — send a test email
 * GET    /api/settings/domains      — list monitored AI domains
 * PATCH  /api/settings/domains      — add/remove monitored domains
 */
import { Router } from 'express';
import { z } from 'zod';
import { Org } from '../models/index.js';
import { requireRole } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = Router();

// All settings routes are admin-only
router.use(requireRole('admin'));

// ─── Validation schemas ───────────────────────────────────────────────────────

const OrgSchema = z.object({
  name:            z.string().min(1).max(100).optional(),
  slackWebhookUrl: z.string().url().optional().or(z.literal('')),
  alertEmail:      z.string().email().optional().or(z.literal('')),
  domain:          z.string().max(100).optional(),
});

const PolicySchema = z.object({
  blockOnHigh:          z.boolean().optional(),
  requireJustification: z.boolean().optional(),
  alertOnMedium:        z.boolean().optional(),
});

const DomainsSchema = z.object({
  add:    z.array(z.string().max(100)).optional(),
  remove: z.array(z.string().max(100)).optional(),
});

// Default monitored AI domains (persisted in Org.monitoredDomains)
const DEFAULT_DOMAINS = [
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  'copilot.microsoft.com',
  'bard.google.com',
  'poe.com',
  'character.ai',
  'perplexity.ai',
];

// ─── Helper: get or create the singleton Org document ─────────────────────────
async function getOrg() {
  let org = await Org.findOne();
  if (!org) {
    org = await Org.create({
      name: 'My Organisation',
      securityScore: 100,
      monitoredDomains: DEFAULT_DOMAINS,
      settings: { blockOnHigh: false, requireJustification: false, alertOnMedium: false },
    });
  }
  return org;
}

// ─── GET /api/settings/org ────────────────────────────────────────────────────

router.get('/org', async (_req, res) => {
  try {
    const org = await getOrg();
    // Mask the Slack webhook — show only that it's set, not the full URL
    const slackConfigured = !!org.slackWebhookUrl;
    const emailConfigured = !!org.alertEmail;

    res.json({
      name:             org.name,
      domain:           org.domain,
      securityScore:    org.securityScore,
      slackConfigured,
      // Return last 4 chars of webhook so admin can verify which one is set
      slackWebhookHint: org.slackWebhookUrl
        ? '••••' + org.slackWebhookUrl.slice(-6)
        : null,
      alertEmail:       org.alertEmail ?? '',
      emailConfigured,
      settings:         org.settings,
      monitoredDomains: org.monitoredDomains ?? DEFAULT_DOMAINS,
      updatedAt:        org.updatedAt,
    });
  } catch (err) {
    logger.error('GET /settings/org error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PATCH /api/settings/org ──────────────────────────────────────────────────

router.patch('/org', async (req, res) => {
  try {
    const data = OrgSchema.parse(req.body);
    const updates = {};

    if (data.name !== undefined)            updates.name            = data.name;
    if (data.domain !== undefined)          updates.domain          = data.domain;
    if (data.slackWebhookUrl !== undefined) updates.slackWebhookUrl = data.slackWebhookUrl;
    if (data.alertEmail !== undefined)      updates.alertEmail      = data.alertEmail;

    const org = await Org.findOneAndUpdate(
      {},
      { $set: updates },
      { new: true, upsert: true, runValidators: true }
    );

    logger.info(`Org settings updated by admin ${req.user.userId}`);
    res.json({ ok: true, name: org.name, updatedAt: org.updatedAt });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Validation error' });
    logger.error('PATCH /settings/org error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PATCH /api/settings/org/policy ──────────────────────────────────────────

router.patch('/org/policy', async (req, res) => {
  try {
    const data = PolicySchema.parse(req.body);
    const setFields = {};
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) setFields[`settings.${key}`] = val;
    }

    const org = await Org.findOneAndUpdate(
      {},
      { $set: setFields },
      { new: true, upsert: true }
    );

    logger.info(`Policy updated by admin ${req.user.userId}: ${JSON.stringify(data)}`);
    res.json({ ok: true, settings: org.settings });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Validation error' });
    logger.error('PATCH /settings/org/policy error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── POST /api/settings/slack/test ───────────────────────────────────────────

router.post('/slack/test', async (_req, res) => {
  try {
    const org = await getOrg();
    if (!org.slackWebhookUrl) {
      return res.status(400).json({ error: 'No Slack webhook URL configured' });
    }

    const payload = {
      text: '✅ Shadow AI Auditor — Slack integration is working correctly.',
      attachments: [{
        color: '#22c55e',
        fields: [{ title: 'Status', value: 'Connected', short: true }],
        footer: 'Shadow AI Auditor · Test message',
        ts: Math.floor(Date.now() / 1000),
      }],
    };

    const slackRes = await fetch(org.slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!slackRes.ok) {
      return res.status(502).json({ error: `Slack returned ${slackRes.status}` });
    }

    logger.info('Slack test message sent');
    res.json({ ok: true, message: 'Test message sent to Slack' });
  } catch (err) {
    logger.error('POST /settings/slack/test error', err);
    res.status(500).json({ error: 'Failed to send test message' });
  }
});

// ─── POST /api/settings/email/test ───────────────────────────────────────────

router.post('/email/test', async (req, res) => {
  try {
    const org = await getOrg();
    if (!org.alertEmail) {
      return res.status(400).json({ error: 'No alert email configured' });
    }

    // Dynamically import alerting service to avoid circular dependency
    const { sendEmailAlert } = await import('../services/alerting.js');

    // Create a fake HIGH event as the test payload
    const testEvent = {
      _id:           'test-' + Date.now(),
      domain:        'chat.openai.com',
      eventType:     'paste',
      riskScore:     99,
      severity:      'HIGH',
      maskedPreview: 'AKIA****ABCD · sk_live_****WXYZ',
      findingLabels: ['AWS Access Key', 'Stripe Secret Key'],
      timestamp:     new Date(),
    };

    await sendEmailAlert(testEvent);
    logger.info(`Test email sent to ${org.alertEmail}`);
    res.json({ ok: true, message: `Test email sent to ${org.alertEmail}` });
  } catch (err) {
    logger.error('POST /settings/email/test error', err);
    res.status(500).json({ error: 'Failed to send test email: ' + err.message });
  }
});

// ─── GET /api/settings/domains ────────────────────────────────────────────────

router.get('/domains', async (_req, res) => {
  try {
    const org = await getOrg();
    res.json({ domains: org.monitoredDomains ?? DEFAULT_DOMAINS });
  } catch (err) {
    logger.error('GET /settings/domains error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PATCH /api/settings/domains ─────────────────────────────────────────────

router.patch('/domains', async (req, res) => {
  try {
    const { add = [], remove = [] } = DomainsSchema.parse(req.body);
    const org = await getOrg();

    let domains = new Set(org.monitoredDomains ?? DEFAULT_DOMAINS);
    add.forEach(d => domains.add(d.toLowerCase().trim()));
    remove.forEach(d => domains.delete(d.toLowerCase().trim()));

    if (domains.size === 0) {
      return res.status(400).json({ error: 'Must monitor at least one domain' });
    }

    await Org.findOneAndUpdate({}, { $set: { monitoredDomains: [...domains] } });

    logger.info(`Monitored domains updated by admin ${req.user.userId}`);
    res.json({ ok: true, domains: [...domains] });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors[0]?.message ?? 'Validation error' });
    logger.error('PATCH /settings/domains error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;