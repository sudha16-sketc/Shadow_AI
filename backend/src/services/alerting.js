// backend/src/services/alerting.js

/**
 * Shadow AI Auditor — Alerting Service
 * Sends Slack webhooks and email notifications for HIGH risk events.
 */
import nodemailer from 'nodemailer';
import { Org } from '../models/index.js';
import logger from '../utils/logger.js';

// ─── Slack ────────────────────────────────────────────────────────────────────

export async function sendSlackAlert(event) {
  const org = await Org.findOne().select('slackWebhookUrl').lean();
  if (!org?.slackWebhookUrl) return;

  const severityEmoji = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🟢' };
  const emoji = severityEmoji[event.severity] ?? '⚠️';

  const body = {
    username: 'Shadow AI Auditor',
    icon_emoji: ':shield:',
    attachments: [
      {
        color: event.severity === 'HIGH' ? '#ef4444' : '#f59e0b',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${emoji} *HIGH-RISK AI Input Detected*\n` +
                    `A user is attempting to share sensitive data with an AI tool.`,
            },
          },
          {
            type: 'fields',
            fields: [
              { type: 'mrkdwn', text: `*Risk Score*\n${event.riskScore}/100` },
              { type: 'mrkdwn', text: `*Severity*\n${event.severity}` },
              { type: 'mrkdwn', text: `*AI Tool*\n${event.domain}` },
              { type: 'mrkdwn', text: `*Event Type*\n${event.eventType}` },
            ],
          },
          ...(event.findingLabels?.length ? [{
            type: 'section',
            text: { type: 'mrkdwn', text: `*Detected Patterns:*\n${event.findingLabels.map(l => `• ${l}`).join('\n')}` },
          }] : []),
          ...(event.maskedPreview ? [{
            type: 'section',
            text: { type: 'mrkdwn', text: `*Preview (masked):*\n\`${event.maskedPreview}\`` },
          }] : []),
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `Detected at ${new Date(event.timestamp).toUTCString()}` }],
          },
        ],
      },
    ],
  };

  const res = await fetch(org.slackWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Slack returned ${res.status}`);
  logger.info(`Slack alert sent for event ${event._id}`);
}

// ─── Email ────────────────────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   ?? 'smtp.mailgun.org',
  port:   +(process.env.SMTP_PORT ?? 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmailAlert(event) {
  const org = await Org.findOne().select('alertEmail name').lean();
  if (!org?.alertEmail) return;

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #ef4444; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">⚠️ High-Risk AI Input Detected</h2>
      </div>
      <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="margin-top: 0; color: #374151;">
          A user at <strong>${org.name}</strong> attempted to share sensitive data with an AI tool.
        </p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr><td style="padding: 8px; color: #6b7280; font-size: 14px;">Risk Score</td><td style="padding: 8px; font-weight: 600;">${event.riskScore}/100</td></tr>
          <tr style="background: #fff;"><td style="padding: 8px; color: #6b7280; font-size: 14px;">Severity</td><td style="padding: 8px; font-weight: 600; color: #ef4444;">${event.severity}</td></tr>
          <tr><td style="padding: 8px; color: #6b7280; font-size: 14px;">AI Tool</td><td style="padding: 8px;">${event.domain}</td></tr>
          <tr style="background: #fff;"><td style="padding: 8px; color: #6b7280; font-size: 14px;">Event Type</td><td style="padding: 8px;">${event.eventType}</td></tr>
          <tr><td style="padding: 8px; color: #6b7280; font-size: 14px;">Timestamp</td><td style="padding: 8px;">${new Date(event.timestamp).toUTCString()}</td></tr>
        </table>
        ${event.findingLabels?.length ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;">
            <strong style="color: #dc2626; font-size: 14px;">Detected Patterns:</strong>
            <ul style="margin: 8px 0 0; padding-left: 20px; color: #374151; font-size: 14px;">
              ${event.findingLabels.map(l => `<li>${l}</li>`).join('')}
            </ul>
          </div>` : ''}
        ${event.maskedPreview ? `
          <div style="background: #1e1e2e; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 4px; color: #9ca3af; font-size: 12px; text-transform: uppercase;">Preview (masked)</p>
            <code style="color: #a5b4fc; font-size: 13px;">${event.maskedPreview}</code>
          </div>` : ''}
        <p style="color: #6b7280; font-size: 12px; margin-bottom: 0;">
          Review all events at your <a href="${process.env.FRONTEND_URL}/events">Shadow AI Auditor dashboard</a>.
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from:    `"Shadow AI Auditor" <${process.env.SMTP_FROM ?? 'alerts@shadow-auditor.com'}>`,
    to:      org.alertEmail,
    subject: `🔴 High-Risk AI Input Detected — Score ${event.riskScore}/100`,
    html,
  });

  logger.info(`Email alert sent for event ${event._id}`);
}