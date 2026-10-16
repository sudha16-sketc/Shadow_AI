import CodeBlock from '../components/CodeBlock';
import DocsCallout from '../components/DocsCallout';

/**
 * Public product documentation for Shadow AI Auditor.
 *
 * This content is customer-facing. It describes capabilities, workflow,
 * high-level architecture, and privacy/security controls in plain language.
 * Implementation internals (source paths, private interfaces, database
 * schemas, credentials, configuration variables and operational runbooks) are
 * intentionally omitted. Every capability described here is verified against
 * the shipped product.
 */
export const docsSections = [
  {
    id: 'overview',
    title: 'Product Overview',
    keywords: ['overview', 'problem', 'what is shadow ai', 'dlp', 'purpose', 'summary'],
    content: (
      <>
        <p>
          <strong>Shadow AI Auditor</strong> is a data-loss-prevention (DLP) layer for the sensitive
          data employees send to public AI tools. It detects credentials, personal data and
          confidential material in AI prompts, warns the user, and enforces your organization&apos;s
          policy before the content leaves the browser.
        </p>

        <h3>Problem</h3>
        <p>
          Credentials, customer PII and confidential source code are routinely pasted into public AI
          chat tools. That traffic is outbound HTTPS to a third-party domain, so traditional network
          DLP cannot see inside it. The browser is the only place where the plaintext intent is
          visible.
        </p>

        <h3>Solution</h3>
        <ol>
          <li><strong>Detect</strong> sensitive content locally in the browser, before it is sent.</li>
          <li>
            <strong>Decide</strong> server-side against your organization&apos;s policy, so a user
            cannot downgrade an enforcement decision from the client.
          </li>
          <li>
            <strong>Enforce</strong> the outcome — allow, warn, mask, or block — and record every
            decision for audit.
          </li>
        </ol>

        <h3>How it fits together</h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Part</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Browser extension</td>
                <td>Inspects prompts in supported AI tools, shows warnings, and routes requests through the enforcement gateway</td>
              </tr>
              <tr>
                <td>Cloud service</td>
                <td>Detects, evaluates policy, enforces the decision, protects content before forwarding, stores audit records and raises alerts</td>
              </tr>
              <tr>
                <td>Web dashboard</td>
                <td>Gives security teams visibility into activity, users, trends and settings</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },

  {
    id: 'how-it-works',
    title: 'How Shadow AI Works',
    keywords: ['workflow', 'end-to-end', 'sequence', 'how it works', 'flow', 'interception'],
    content: (
      <>
        <p>
          Shadow AI inspects every prompt in supported AI tools before it is submitted, combining a
          fast in-browser check with an authoritative server-side decision.
        </p>

        <pre className="docsDiagram">{`Employee          Extension            Shadow AI            AI Provider
   │                 │                    │                     │
   │ type / paste    │                    │                     │
   ├────────────────▶│                    │                     │
   │                 │ local detection    │                     │
   │  warning modal  │                    │                     │
   │◀────────────────┤                    │                     │
   │ cancel│mask│send                    │                     │
   ├────────────────▶│  secure gateway    │                     │
   │                 ├───────────────────▶│                     │
   │                 │                    │ re-check + policy   │
   │                 │  BLOCK → stopped   │ (provider not used) │
   │                 │◀───────────────────┤                     │
   │                 │  allow / mask ─────┼────────────────────▶│
   │                 │◀───────────────────┼─────────────────────┤
   │                 │                    │ audit record        │`}</pre>

        <ol>
          <li>The browser extension runs a local detection pass as content is typed or pasted.</li>
          <li>When sensitive content is found, the user sees an in-page warning before submitting.</li>
          <li>
            On submission, the request is routed through the Shadow AI gateway, which re-checks the
            content server-side and evaluates your organization&apos;s policy.
          </li>
          <li>
            The gateway allows, warns, masks, or blocks the request. A blocked prompt never reaches
            the AI provider.
          </li>
          <li>Every decision is recorded for audit, reporting, and alerts.</li>
        </ol>

        <DocsCallout type="note" title="Trust boundary">
          The extension proposes; the service decides. A user cannot lower an enforcement outcome
          from the browser — the decision is derived from the verified credential and your policy.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'platforms',
    title: 'Supported AI Platforms',
    keywords: ['platforms', 'supported', 'chatgpt', 'claude', 'gemini', 'copilot', 'perplexity', 'poe', 'openai', 'anthropic'],
    content: (
      <>
        <p>The browser extension is active on these AI chat tools:</p>
        <ul>
          <li>ChatGPT</li>
          <li>Claude</li>
          <li>Google Gemini</li>
          <li>Microsoft Copilot</li>
          <li>Perplexity</li>
          <li>Poe</li>
          <li>Character.ai</li>
        </ul>

        <p>
          Prompts routed through the enforcement gateway to the <strong>OpenAI</strong> and{' '}
          <strong>Anthropic</strong> APIs are inspected and can be masked or blocked before they are
          forwarded.
        </p>

        <DocsCallout type="note" title="Coverage">
          Protection applies to the supported browser-based tools listed above. Other AI clients
          that do not pass through the Shadow AI gateway are outside the current scope.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'detection',
    title: 'Detection & Risk Assessment',
    keywords: ['detection', 'engine', 'patterns', 'risk', 'scoring', 'severity', 'masking', 'pii', 'secrets'],
    content: (
      <>
        <p>
          Shadow AI combines fast in-browser detection with an authoritative server-side check, so
          stored severity never depends on what the client reports.
        </p>

        <h3>What it detects</h3>
        <ul>
          <li><strong>API keys &amp; tokens:</strong> AWS keys, Stripe keys, GitHub tokens, NPM tokens, and JWTs.</li>
          <li><strong>Secrets:</strong> private keys, password and secret assignments, and database connection strings.</li>
          <li><strong>Personal data:</strong> email addresses, US SSNs, credit-card numbers, US phone numbers, and internal IP addresses.</li>
          <li><strong>Confidentiality markers:</strong> terms such as &ldquo;confidential&rdquo;, &ldquo;internal only&rdquo;, &ldquo;trade secret&rdquo;, and legal-privilege phrases.</li>
        </ul>

        <h3>Risk assessment</h3>
        <p>
          Each finding contributes to a risk score based on its category and the number of distinct
          findings in the prompt. Scores map to four severity levels used across the dashboard and
          alerts:
        </p>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Typical signals</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>CRITICAL</code></td><td>Highly sensitive secrets and financial or identity data, such as private keys and credit-card numbers</td></tr>
              <tr><td><code>HIGH</code></td><td>High-impact credentials and identifiers, such as cloud access keys and national identifiers</td></tr>
              <tr><td><code>MEDIUM</code></td><td>Tokens, connection strings, or several personal-data items in one prompt</td></tr>
              <tr><td><code>LOW</code></td><td>Lower-impact or single indicators, such as one email address</td></tr>
            </tbody>
          </table>
        </div>

        <DocsCallout type="info" title="Only labels and masked samples are used">
          Detection records the <em>type</em> of finding and a masked sample. Sensitive values are
          never stored in plaintext.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'enforcement',
    title: 'Allow, Warn, Mask & Block',
    keywords: ['enforcement', 'allow', 'warn', 'block', 'sanitize', 'mask', 'redact', 'policy', 'decision'],
    content: (
      <>
        <p>
          When a prompt is submitted, the Shadow AI service applies your organization&apos;s policy
          and returns one of four decisions.
        </p>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Decision</th>
                <th>Behaviour</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>ALLOW</code></td>
                <td>Sent to the AI provider unchanged.</td>
              </tr>
              <tr>
                <td><code>WARN</code></td>
                <td>Sent, and the finding is recorded so it appears in reporting and alerts.</td>
              </tr>
              <tr>
                <td><code>MASK</code></td>
                <td>Detected secrets are replaced with labelled redaction placeholders before the request is sent.</td>
              </tr>
              <tr>
                <td><code>BLOCK</code></td>
                <td>The request is stopped. The AI provider is never contacted and the user is told why.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Sensitive-data masking</h3>
        <p>
          When masking is applied, each detected value is replaced with a labelled placeholder so the
          prompt keeps its meaning without exposing the secret.
        </p>
        <CodeBlock
          language="text"
          title="Masking in practice"
          code={`Before:  aws_secret_access_key = "<YOUR_ACCESS_KEY>"
After:   aws_secret_access_key = [REDACTED:AWS Access Key]`}
        />

        <DocsCallout type="warn" title="Policy is enforced server-side">
          A user cannot downgrade a block from the browser. If a policy is missing or invalid, the
          service fails closed and blocks the request rather than allowing it.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'experience',
    title: 'The User Experience',
    keywords: ['user', 'workflow', 'warning', 'modal', 'cancel', 'mask', 'proceed', 'extension', 'popup', 'opt-out'],
    content: (
      <>
        <p>
          Shadow AI stays out of the way for clean prompts and gives users a clear choice when
          something sensitive appears.
        </p>
        <ol>
          <li>The user types or pastes content into a supported AI tool.</li>
          <li>Detection runs locally; if nothing sensitive is found, the prompt is submitted normally.</li>
          <li>If sensitive content is found, an in-page warning appears before submission.</li>
          <li>
            The user can <strong>cancel</strong>, send the prompt with sensitive values{' '}
            <strong>masked</strong>, or <strong>proceed</strong> as-is (subject to policy).
          </li>
        </ol>
        <p>
          The extension popup shows device pairing status, an opt-out control, and recent activity,
          and a toolbar badge reflects recent detections.
        </p>
      </>
    ),
  },

  {
    id: 'dashboard',
    title: 'Dashboard & Alerts',
    keywords: ['dashboard', 'overview', 'events', 'users', 'analytics', 'settings', 'alerts', 'slack', 'email'],
    content: (
      <>
        <p>
          The web dashboard gives security teams visibility into detections and enforcement across
          the organization.
        </p>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>View</th>
                <th>What it provides</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Overview</td><td>Headline metrics and recent activity at a glance</td></tr>
              <tr><td>Events</td><td>A searchable, filterable record of detections and policy decisions</td></tr>
              <tr><td>Users</td><td>Per-user activity and risk, with user management controls</td></tr>
              <tr><td>Analytics</td><td>Trends over time, including risk and severity breakdowns</td></tr>
              <tr><td>Settings</td><td>Organization policy, monitored domains, and alert configuration</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          High-risk events raise real-time alerts in the dashboard and, when configured, through
          Slack or email.
        </p>
      </>
    ),
  },

  {
    id: 'architecture',
    title: 'Architecture',
    keywords: ['architecture', 'components', 'topology', 'diagram', 'overview'],
    content: (
      <>
        <p>
          Shadow AI has three cooperating parts. Prompts are inspected before they leave the
          organization; the service enforces policy, forwards allowed traffic to the AI provider, and
          stores an audit record.
        </p>

        <pre className="docsDiagram">{`┌──────────────────────┐      ┌──────────────────────────┐      ┌───────────────┐
│  Browser extension   │      │        Shadow AI         │      │  AI providers │
│  • local detection   │─────▶│  • server-side detection │─────▶│  OpenAI       │
│  • warning modal     │      │  • policy enforcement    │      │  Anthropic    │
│  • device pairing    │◀─────│  • masking / blocking    │◀─────│               │
└──────────────────────┘      │  • audit + alerts        │      └───────────────┘
           │                  └────────────┬─────────────┘
           │                               │
           ▼                               ▼
┌──────────────────────┐      ┌──────────────────────────┐
│    Web dashboard     │◀─────│        Event store       │
│  overview · events · │      │    (per-organization)    │
│  users · analytics   │      └──────────────────────────┘
└──────────────────────┘`}</pre>

        <p>
          The dashboard is a React single-page app, the service runs on Node.js, and audit data is
          stored in a document database. Each organization&apos;s data is kept logically separate.
        </p>
      </>
    ),
  },

  {
    id: 'privacy',
    title: 'Privacy & Data Handling',
    keywords: ['privacy', 'data', 'handling', 'retention', 'tenant isolation', 'pii', 'masked', 'gdpr'],
    content: (
      <>
        <p>Shadow AI is designed to minimize the sensitive data it handles.</p>
        <ul>
          <li>
            <strong>Detection runs first in the browser.</strong> The extension reports the type of
            finding and a masked sample — not the raw prompt content.
          </li>
          <li>
            <strong>Audit records are minimized.</strong> Records store the masked preview and finding
            labels; the full prompt text is not retained.
          </li>
          <li>
            <strong>Data is isolated per organization.</strong> Every request is scoped to the
            signed-in user&apos;s organization, and access to another organization&apos;s data is
            rejected.
          </li>
          <li>
            <strong>Sensitive values are protected on the way out.</strong> When masking applies, the
            placeholder replaces the value before the request is forwarded.
          </li>
          <li>
            <strong>Retention is automatic.</strong> Event and audit records are subject to defined
            retention periods and expire on a schedule.
          </li>
        </ul>
      </>
    ),
  },

  {
    id: 'security',
    title: 'Security Features',
    keywords: ['security', 'controls', 'encryption', 'isolation', 'hardening', 'rbac'],
    content: (
      <>
        <ul>
          <li>
            <strong>Server-authoritative enforcement.</strong> Decisions are made by the service, not
            the browser, so client-supplied values cannot override policy.
          </li>
          <li>
            <strong>Fail-closed policy.</strong> A missing or invalid policy results in a block rather
            than an allow.
          </li>
          <li>
            <strong>Organization isolation and role-based access.</strong> Every request is scoped to
            an organization and checked against the user&apos;s role.
          </li>
          <li>
            <strong>Encryption in transit.</strong> Client, dashboard and provider traffic is
            protected with HTTPS/WSS.
          </li>
          <li>
            <strong>Secure credentials.</strong> Device credentials are stored only as hashes and can
            be revoked, and active sessions can be invalidated.
          </li>
          <li>
            <strong>Content protection before egress.</strong> Masking replaces sensitive values before
            anything is forwarded to a provider.
          </li>
          <li>
            <strong>Hardened service.</strong> Security headers, request-size limits, rate limiting
            and request tracing protect the API.
          </li>
          <li>
            <strong>Safe outbound webhooks.</strong> Alert destinations such as Slack are validated to
            prevent server-side request forgery.
          </li>
        </ul>
      </>
    ),
  },

  {
    id: 'access',
    title: 'Access & Roles',
    keywords: ['access', 'roles', 'permissions', 'admin', 'manager', 'viewer', 'invitation', 'onboarding'],
    content: (
      <>
        <p>
          Access is invitation-based. Accounts are created by an organization administrator, and
          there is no self-service signup.
        </p>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Role</th>
                <th>Typical access</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>admin</code></td><td>Full organization control: users, settings and policy</td></tr>
              <tr><td><code>manager</code></td><td>Review detections, users, analytics and alerts</td></tr>
              <tr><td><code>viewer</code></td><td>Read-only visibility</td></tr>
            </tbody>
          </table>
        </div>
        <p>
          Shadow AI is multi-tenant: each organization&apos;s users, events and settings are kept
          separate from other organizations.
        </p>
      </>
    ),
  },
];
