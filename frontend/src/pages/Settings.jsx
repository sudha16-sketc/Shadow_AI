import { useEffect, useState } from 'react';
import { useApi } from '../hooks/useAuth';

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, description, children }) {
  return (
    <div className="rounded-xl border border-white/[0.07] overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-white/[0.07]">
        <p className="text-sm font-semibold text-white">{title}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-8 py-3 border-b border-white/[0.04] last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-200">{label}</p>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-indigo-600' : 'bg-white/[0.12]'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-4.5' : 'translate-x-0.5'
      }`} style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
    </button>
  );
}

function Input({ value, onChange, placeholder, type = 'text', monospace }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20 w-72 ${monospace ? 'font-mono text-xs' : ''}`}
    />
  );
}

function SaveButton({ onClick, saving, label = 'Save', disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={saving || disabled}
      className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
    >
      {saving ? 'Saving…' : label}
    </button>
  );
}

function StatusMessage({ type, text }) {
  if (!text) return null;
  return (
    <div className={`mt-3 rounded-lg px-3 py-2 text-sm border ${
      type === 'error'
        ? 'bg-red-500/10 border-red-500/20 text-red-400'
        : 'bg-green-500/10 border-green-500/20 text-green-400'
    }`}>
      {text}
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const api = useApi();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);

  // Org general
  const [orgName, setOrgName] = useState('');
  const [orgDomain, setOrgDomain] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgMsg, setOrgMsg] = useState(null);

  // Slack
  const [slackUrl, setSlackUrl] = useState('');
  const [savingSlack, setSavingSlack] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackMsg, setSlackMsg] = useState(null);

  // Email
  const [alertEmail, setAlertEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState(null);

  // Policy
  const [policy, setPolicy] = useState({ blockOnHigh: false, requireJustification: false, alertOnMedium: false });
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyMsg, setPolicyMsg] = useState(null);

  // Domains
  const [domains, setDomains] = useState([]);
  const [newDomain, setNewDomain] = useState('');
  const [savingDomains, setSavingDomains] = useState(false);
  const [domainMsg, setDomainMsg] = useState(null);

  useEffect(() => {
    api('/api/settings/org')
      .then(data => {
        setOrg(data);
        setOrgName(data.name ?? '');
        setOrgDomain(data.domain ?? '');
        setAlertEmail(data.alertEmail ?? '');
        setPolicy(data.settings ?? { blockOnHigh: false, requireJustification: false, alertOnMedium: false });
        setDomains(data.monitoredDomains ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // ── Save helpers ────────────────────────────────────────────────────────────

  function flash(setter, type, text) {
    setter({ type, text });
    setTimeout(() => setter(null), 4000);
  }

  async function saveOrg() {
    setSavingOrg(true);
    try {
      await api('/api/settings/org', {
        method: 'PATCH',
        body: JSON.stringify({ name: orgName, domain: orgDomain }),
      });
      flash(setOrgMsg, 'success', 'Organisation settings saved.');
    } catch (e) {
      flash(setOrgMsg, 'error', e.message);
    } finally {
      setSavingOrg(false);
    }
  }

  async function saveSlack() {
    setSavingSlack(true);
    try {
      await api('/api/settings/org', { method: 'PATCH', body: JSON.stringify({ slackWebhookUrl: slackUrl }) });
      flash(setSlackMsg, 'success', 'Slack webhook saved.');
      setSlackUrl(''); // clear — never re-display the URL
    } catch (e) {
      flash(setSlackMsg, 'error', e.message);
    } finally {
      setSavingSlack(false);
    }
  }

  async function testSlack() {
    setTestingSlack(true);
    try {
      const res = await api('/api/settings/slack/test', { method: 'POST' });
      flash(setSlackMsg, 'success', res.message);
    } catch (e) {
      flash(setSlackMsg, 'error', e.message);
    } finally {
      setTestingSlack(false);
    }
  }

  async function saveEmail() {
    setSavingEmail(true);
    try {
      await api('/api/settings/org', { method: 'PATCH', body: JSON.stringify({ alertEmail }) });
      flash(setEmailMsg, 'success', 'Alert email saved.');
    } catch (e) {
      flash(setEmailMsg, 'error', e.message);
    } finally {
      setSavingEmail(false);
    }
  }

  async function testEmail() {
    setTestingEmail(true);
    try {
      const res = await api('/api/settings/email/test', { method: 'POST' });
      flash(setEmailMsg, 'success', res.message);
    } catch (e) {
      flash(setEmailMsg, 'error', e.message);
    } finally {
      setTestingEmail(false);
    }
  }

  async function savePolicy() {
    setSavingPolicy(true);
    try {
      await api('/api/settings/org/policy', { method: 'PATCH', body: JSON.stringify(policy) });
      flash(setPolicyMsg, 'success', 'Policy saved.');
    } catch (e) {
      flash(setPolicyMsg, 'error', e.message);
    } finally {
      setSavingPolicy(false);
    }
  }

  async function addDomain() {
    const d = newDomain.trim().toLowerCase();
    if (!d || domains.includes(d)) return;
    setSavingDomains(true);
    try {
      const res = await api('/api/settings/domains', { method: 'PATCH', body: JSON.stringify({ add: [d] }) });
      setDomains(res.domains);
      setNewDomain('');
      flash(setDomainMsg, 'success', `${d} added.`);
    } catch (e) {
      flash(setDomainMsg, 'error', e.message);
    } finally {
      setSavingDomains(false);
    }
  }

  async function removeDomain(domain) {
    setSavingDomains(true);
    try {
      const res = await api('/api/settings/domains', { method: 'PATCH', body: JSON.stringify({ remove: [domain] }) });
      setDomains(res.domains);
    } catch (e) {
      flash(setDomainMsg, 'error', e.message);
    } finally {
      setSavingDomains(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="px-8 py-7 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your organisation, alerting, and detection policy</p>
      </div>

      {/* ── Security Score ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.07] bg-gradient-to-r from-white/[0.03] to-transparent p-5 flex items-center gap-5 mb-6">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold border flex-shrink-0"
          style={{
            color: org?.securityScore >= 75 ? '#22c55e' : org?.securityScore >= 50 ? '#f59e0b' : '#ef4444',
            background: org?.securityScore >= 75 ? 'rgba(34,197,94,0.1)' : org?.securityScore >= 50 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
            borderColor: org?.securityScore >= 75 ? 'rgba(34,197,94,0.2)' : org?.securityScore >= 50 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)',
          }}>
          {org?.securityScore ?? 100}
        </div>
        <div>
          <p className="text-base font-semibold text-white">Security Score</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Recalculated after every event based on weighted violations over the last 7 days.
            HIGH events deduct 10 pts · MEDIUM 3 pts · LOW 1 pt.
          </p>
        </div>
      </div>

      {/* ── Organisation ──────────────────────────────────────────────────── */}
      <Section title="Organisation" description="Basic information about your company">
        <Field label="Organisation Name" hint="Displayed in alerts and reports">
          <Input value={orgName} onChange={setOrgName} placeholder="Acme Corp" />
        </Field>
        <Field label="Company Domain" hint="e.g. acmecorp.com — used for future SSO integration">
          <Input value={orgDomain} onChange={setOrgDomain} placeholder="acmecorp.com" monospace />
        </Field>
        <div className="pt-3 flex justify-end">
          <SaveButton onClick={saveOrg} saving={savingOrg} />
        </div>
        <StatusMessage {...(orgMsg ?? { type: 'success', text: '' })} />
      </Section>

      {/* ── Slack ─────────────────────────────────────────────────────────── */}
      <Section title="Slack Alerts" description="Receive real-time notifications in a Slack channel when HIGH-risk events are detected">
        <Field
          label="Incoming Webhook URL"
          hint={org?.slackConfigured
            ? `Currently set (…${org.slackWebhookHint}). Paste a new URL to update.`
            : 'Create one at api.slack.com/messaging/webhooks'}
        >
          <div className="flex items-center gap-2">
            {org?.slackConfigured && (
              <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded-lg">
                ✓ Connected
              </span>
            )}
            <Input value={slackUrl} onChange={setSlackUrl} placeholder="https://hooks.slack.com/services/…" monospace />
          </div>
        </Field>
        <div className="pt-3 flex items-center justify-end gap-2">
          {org?.slackConfigured && (
            <button onClick={testSlack} disabled={testingSlack}
              className="text-sm text-gray-300 bg-white/[0.05] border border-white/10 hover:bg-white/[0.09] px-4 py-2 rounded-xl transition-colors disabled:opacity-50">
              {testingSlack ? 'Sending…' : 'Send Test'}
            </button>
          )}
          <SaveButton onClick={saveSlack} saving={savingSlack} disabled={!slackUrl.trim()} />
        </div>
        <StatusMessage {...(slackMsg ?? { type: 'success', text: '' })} />
      </Section>

      {/* ── Email ─────────────────────────────────────────────────────────── */}
      <Section title="Email Alerts" description="Send HTML email alerts for HIGH-risk events via your configured SMTP server">
        <Field label="Alert Email Address" hint="Security team inbox that receives alert emails">
          <Input value={alertEmail} onChange={setAlertEmail} placeholder="security@company.com" />
        </Field>
        <div className="pt-3 flex items-center justify-end gap-2">
          {org?.emailConfigured && (
            <button onClick={testEmail} disabled={testingEmail}
              className="text-sm text-gray-300 bg-white/[0.05] border border-white/10 hover:bg-white/[0.09] px-4 py-2 rounded-xl transition-colors disabled:opacity-50">
              {testingEmail ? 'Sending…' : 'Send Test'}
            </button>
          )}
          <SaveButton onClick={saveEmail} saving={savingEmail} />
        </div>
        <StatusMessage {...(emailMsg ?? { type: 'success', text: '' })} />
        <div className="mt-4 bg-amber-500/5 border border-amber-500/15 rounded-lg px-4 py-3">
          <p className="text-xs text-amber-400/80 font-medium mb-0.5">SMTP configuration</p>
          <p className="text-xs text-gray-500">
            Set <code className="font-mono text-amber-400/70">SMTP_HOST</code>, <code className="font-mono text-amber-400/70">SMTP_PORT</code>, <code className="font-mono text-amber-400/70">SMTP_USER</code>,
            and <code className="font-mono text-amber-400/70">SMTP_PASS</code> in your <code className="font-mono text-amber-400/70">.env</code> file to configure the sending server.
          </p>
        </div>
      </Section>

      {/* ── Detection Policy ──────────────────────────────────────────────── */}
      <Section title="Detection Policy" description="Control how the extension responds when sensitive data is detected">
        <Field
          label="Block on HIGH risk"
          hint="Prevent the user from submitting to AI tools when HIGH severity is detected. The modal Cancel button clears the input.">
          <Toggle
            checked={policy.blockOnHigh}
            onChange={v => setPolicy(p => ({ ...p, blockOnHigh: v }))}
          />
        </Field>
        <Field
          label="Require justification"
          hint="When the user clicks Proceed Anyway, show a free-text box asking them to explain why they need to share the content.">
          <Toggle
            checked={policy.requireJustification}
            onChange={v => setPolicy(p => ({ ...p, requireJustification: v }))}
          />
        </Field>
        <Field
          label="Alert on MEDIUM risk"
          hint="Send Slack and email alerts for MEDIUM severity events in addition to HIGH. May generate significant volume.">
          <Toggle
            checked={policy.alertOnMedium}
            onChange={v => setPolicy(p => ({ ...p, alertOnMedium: v }))}
          />
        </Field>
        <div className="pt-3 flex justify-end">
          <SaveButton onClick={savePolicy} saving={savingPolicy} />
        </div>
        <StatusMessage {...(policyMsg ?? { type: 'success', text: '' })} />
      </Section>

      {/* ── Monitored Domains ─────────────────────────────────────────────── */}
      <Section title="Monitored AI Domains" description="The extension activates on these domains. Changes take effect after users reload their extension.">
        <div className="space-y-2 mb-4">
          {domains.map(d => (
            <div key={d} className="flex items-center justify-between px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-xl">
              <code className="text-sm font-mono text-indigo-300">{d}</code>
              <button
                onClick={() => removeDomain(d)}
                disabled={savingDomains}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors disabled:opacity-30"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newDomain}
            onChange={e => setNewDomain(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addDomain()}
            placeholder="e.g. mistral.ai"
            className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20 font-mono"
          />
          <button
            onClick={addDomain}
            disabled={!newDomain.trim() || savingDomains}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <StatusMessage {...(domainMsg ?? { type: 'success', text: '' })} />
      </Section>

      {/* ── Privacy note ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-5 py-4">
        <p className="text-xs font-medium text-gray-400 mb-1">Privacy Guarantee</p>
        <p className="text-xs text-gray-600 leading-relaxed">
          Shadow AI Auditor never stores raw sensitive content. All detection runs locally in the browser extension. Only masked previews (e.g. <code className="font-mono text-gray-500">sk-l****abcd</code>) are ever transmitted to the backend. Users can opt out of monitoring at any time.
        </p>
      </div>
    </div>
  );
}