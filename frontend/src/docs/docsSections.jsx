/* eslint-disable react-refresh/only-export-components */
import CodeBlock from '../components/CodeBlock';
import DocsCallout from '../components/DocsCallout';

/**
 * Documentation content. Every claim here is derived from the repository
 * source (backend/, frontend/, shadow-extension/, config files). Planned or
 * unverified behaviour is explicitly labelled.
 */
export const docsSections = [
  {
    id: 'overview',
    title: 'Product Overview',
    keywords: ['overview', 'problem', 'what is shadow ai', 'dlp', 'purpose', 'summary'],
    content: (
      <>
        <p>
          <strong>Shadow AI Auditor</strong> is a tenant-scoped data-loss-prevention (DLP)
          system for sensitive data that employees send to public AI tools. It has three parts:
        </p>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Component</th>
                <th>Path</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Browser extension</td>
                <td><code>shadow-extension/</code></td>
                <td>Detects sensitive content in AI chat inputs in the browser and routes prompts through the enforcement gateway</td>
              </tr>
              <tr>
                <td>Backend API</td>
                <td><code>backend/</code></td>
                <td>Authenticates, detects, evaluates policy, enforces decisions, proxies to AI providers, stores events, sends alerts</td>
              </tr>
              <tr>
                <td>Dashboard</td>
                <td><code>frontend/</code></td>
                <td>React console for overview, events, users, analytics, justifications, audit log and settings</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Problem</h3>
        <p>
          Credentials, customer PII and confidential source code get pasted into public AI chat
          tools. The traffic is outbound HTTPS to a third-party domain, so traditional network DLP
          cannot inspect it, and the browser is the only place where the plaintext intent is visible.
        </p>

        <h3>Solution</h3>
        <ol>
          <li><strong>Detect</strong> sensitive content locally in the browser before it is sent.</li>
          <li><strong>Record</strong> every finding as a tenant-scoped <code>Event</code> with risk score, severity and policy decision.</li>
          <li>
            <strong>Enforce</strong> policy server-side at the gateway: <code>BLOCK</code> never
            contacts the AI provider, <code>SANITIZE</code> redacts detected secrets before
            forwarding, and every decision is audited.
          </li>
        </ol>

        <h3>Design principles</h3>
        <ul>
          <li><strong>Server-authoritative policy.</strong> The extension proposes; the server decides. Client-supplied severity, risk score, decision, <code>orgId</code> and <code>userId</code> are ignored (<code>backend/src/routes/gateway.js</code>).</li>
          <li><strong>Fail closed.</strong> A missing or invalid policy yields <code>BLOCK</code> (<code>backend/src/services/policy-engine.js</code>).</li>
          <li><strong>Secrets are environment-only.</strong> No secret is read from source.</li>
        </ul>

        <DocsCallout type="info" title="Project status">
          This is a proof of concept, not an enterprise product. Known limitations are listed in
          the <em>Limitations &amp; Roadmap</em> section.
        </DocsCallout>
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
          Shadow AI has two independent request paths. The report-only path produces an audit trail;
          the enforcing path inspects and can stop the request itself.
        </p>
        <CodeBlock
          language="text"
          title="Two paths"
          code={`report-only path   extension ──► POST /api/events      ──► Event + AuditLog
enforcing path     extension ──► POST /gateway/v1/...  ──► ALLOW | WARN | SANITIZE | BLOCK`}
        />

        <h3>End-to-end sequence</h3>
        <pre className="docsDiagram">{`Employee          Extension              Backend              AI Provider
   │                 │                     │                     │
   │ paste prompt    │                     │                     │
   ├────────────────▶│                     │                     │
   │                 │ local detect        │                     │
   │  warning modal  │                     │                     │
   │◀────────────────┤                     │                     │
   │ Cancel │ Proceed│                     │                     │
   ├────────────────▶│                     │                     │
   │                 │ POST /gateway/v1/…  │                     │
   │                 ├────────────────────▶│                     │
   │                 │                     │ detect ▸ policy     │
   │                 │                     │                     │
   │                 │  BLOCK → 403        │  (never contacted)  │
   │                 │◀────────────────────┤                     │
   │                 │                     │                     │
   │                 │ ALLOW/SANITIZE ─────┼────────────────────▶│
   │                 │◀────────────────────┼─────────────────────┤
   │                 │                     │ Event + AuditLog    │`}</pre>

        <ol>
          <li>The content script detects sensitive content and shows an in-page warning.</li>
          <li>On submit, the request is routed through <code>POST /gateway/v1/:provider/*</code> with a device credential or user JWT.</li>
          <li>The backend re-analyses the prompt server-side and evaluates tenant/user policy.</li>
          <li><code>BLOCK</code> stops the request; <code>SANITIZE</code> redacts before forwarding; <code>ALLOW</code>/<code>WARN</code> is forwarded to the allowlisted provider.</li>
          <li>An <code>Event</code> and <code>AuditLog</code> entry are written; HIGH/CRITICAL findings trigger alerts.</li>
        </ol>

        <DocsCallout type="note" title="Trust boundary">
          The extension proposes, the server decides. Client-supplied severity, risk score, decision,
          <code> orgId</code> and <code>userId</code> are ignored — the gateway derives them from the
          verified credential and the policy engine only.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'features',
    title: 'Features & Capabilities',
    keywords: ['features', 'capabilities', 'detection', 'enforcement', 'alerts', 'dashboard', 'extension'],
    content: (
      <>
        <h3>Detection</h3>
        <ul>
          <li>Local detection engine runs on paste, typing, modal-cancel and modal-proceed events (<code>shadow-extension/src/content.js</code>).</li>
          <li>Pattern set covers API keys, tokens, private keys, database connection strings, PII (email, US SSN, credit card, US phone, internal IP) and confidentiality keywords.</li>
          <li>The server re-analyses reported previews and scores them, so stored severity does not depend on the client.</li>
        </ul>

        <h3>Enforcement</h3>
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
                <td><code>BLOCK</code></td>
                <td>HTTP 403. Event stored with <code>enforcementStatus=PREVENTED</code>, <code>requestForwarded=false</code>. The AI provider is never called.</td>
              </tr>
              <tr>
                <td><code>SANITIZE</code></td>
                <td>Detected secrets replaced with <code>[REDACTED:…]</code> before forwarding. If the payload cannot be re-parsed, fails closed (500, no send).</td>
              </tr>
              <tr>
                <td><code>ALLOW</code> / <code>WARN</code></td>
                <td>Forwarded with a request-header allowlist and an upstream timeout; redirects are not followed.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Auditing &amp; reporting</h3>
        <ul>
          <li>Every finding and gateway decision is written as an <code>Event</code> plus an <code>AuditLog</code> entry.</li>
          <li>Routed dashboard pages: Overview, Events, Users, Analytics and Settings.</li>
          <li>Real-time alerts: WebSocket broadcast of HIGH/CRITICAL events, plus optional Slack webhook and SMTP email.</li>
          <li>Tenant onboarding via platform administrator invitations — no self-service signup.</li>
        </ul>

        <h3>Extension UX</h3>
        <ul>
          <li>In-page warning modal before submitting sensitive content.</li>
          <li>Popup with device pairing, opt-out toggle and session statistics.</li>
          <li>Toolbar badge reflects recent detection activity.</li>
        </ul>

        <DocsCallout type="warn" title="Partially wired dashboard pages">
          <code>frontend/src/pages/Justifications.jsx</code> and <code>AuditLog.jsx</code> exist and
          are linked from the sidebar, but <code>App.jsx</code> imports them without registering
          routes. They are currently unreachable via the router.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'architecture',
    title: 'System Architecture',
    keywords: ['architecture', 'components', 'topology', 'diagram', 'responsibilities', 'nginx'],
    content: (
      <>
        <p>
          Deployment is a single host: <code>docker compose up</code> runs <code>mongo</code>,{' '}
          <code>backend</code> and <code>frontend</code>. There is no message queue, cache or shared
          state.
        </p>

        <pre className="docsDiagram">{` Browser (untrusted)                Backend (trusted)                 Data
 ┌───────────────────────┐      ┌──────────────────────────────┐    ┌──────────┐
 │ content.js  (detect)  │      │ auth ▸ detect ▸ policy       │    │ MongoDB  │
 │ background.js (batch) │─────▶│ gateway ▸ sanitize ▸ proxy   │───▶│   7      │
 │ popup.js  (pair/opt)  │      │ websocket ▸ alerting         │    └──────────┘
 └───────────────────────┘      └──────────────┬───────────────┘
           │                                   │
           └─────────▶ React dashboard ◀───────┘`}</pre>

        <h3>Component responsibilities</h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Module</th>
                <th>Responsibility</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>backend/src/app.js</code></td><td>CORS allowlist, Helmet, rate limits, request IDs, 50 kb body limit, route mounting, JSON error handling</td></tr>
              <tr><td><code>backend/src/server.js</code></td><td>Env loading, Mongo connect, index sync, HTTP + WebSocket attach, graceful shutdown</td></tr>
              <tr><td><code>backend/src/middleware/auth.js</code></td><td>JWT/device verification and role/tenant guard middleware</td></tr>
              <tr><td><code>backend/src/routes/gateway.js</code></td><td>Provider/path allowlist, server-side detection, header allowlists, sanitisation, upstream proxy</td></tr>
              <tr><td><code>backend/src/services/policy-engine.js</code></td><td>Server-authoritative decision logic</td></tr>
              <tr><td><code>backend/src/services/alerting.js</code></td><td>Slack webhook + SMTP email with SSRF guard</td></tr>
              <tr><td><code>backend/src/services/websocket.js</code></td><td>Single-use tickets and tenant-scoped broadcast</td></tr>
              <tr><td><code>shadow-extension/src/content.js</code></td><td>Detection, warning modal, submit interception</td></tr>
              <tr><td><code>shadow-extension/src/background.js</code></td><td>Service worker: event batching, 1-min flush alarm, toolbar badge</td></tr>
              <tr><td><code>frontend/src/App.jsx</code></td><td>React Router routes, tenant/platform private routes, WebSocket ticket fetch</td></tr>
              <tr><td><code>frontend/nginx.conf</code></td><td>envsubst template: CSP and security headers, <code>API_ORIGIN</code> in <code>connect-src</code></td></tr>
            </tbody>
          </table>
        </div>

        <h3>Trust boundaries</h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Boundary</th>
                <th>Crossing</th>
                <th>Control</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Page → content script</td><td>DOM text</td><td>Local detection only; raw text never logged or uploaded</td></tr>
              <tr><td>Extension → API</td><td>HTTP</td><td>Device credential (<code>dvc_…</code>) or user JWT; CORS allowlist; packaged extension origin accepted</td></tr>
              <tr><td>Client → gateway</td><td>Prompt body</td><td>Server-side detection, policy decision, optional sanitisation</td></tr>
              <tr><td>Backend → AI provider</td><td>Upstream request</td><td>Fixed origins, path validation, header allowlist, timeout, no redirects</td></tr>
              <tr><td>AI provider → client</td><td>Upstream response</td><td>Response header allowlist, response inspection, finding-count header</td></tr>
              <tr><td>Dashboard → API</td><td>Credentialed REST</td><td>JWT, role checks, tenant scoping on every query</td></tr>
              <tr><td>Backend → Slack/SMTP</td><td>Outbound webhook</td><td><code>https:</code> only; private/loopback/metadata hosts rejected</td></tr>
              <tr><td>Anonymous → API</td><td>Rate limits</td><td>Per-route limiters for auth, events, policies, platform admin, gateway</td></tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },

  {
    id: 'tech-stack',
    title: 'Technology Stack',
    keywords: ['stack', 'dependencies', 'versions', 'react', 'express', 'mongodb', 'vite', 'tailwind'],
    content: (
      <>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Layer</th>
                <th>Technology</th>
                <th>Version (from manifest)</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Backend runtime</td><td>Node.js (ESM)</td><td>Node 20+ (exact engine not pinned)</td></tr>
              <tr><td>Backend framework</td><td>Express</td><td>^4.18.2</td></tr>
              <tr><td>Database</td><td>MongoDB + Mongoose</td><td>MongoDB 7 / Mongoose ^8.0.3</td></tr>
              <tr><td>Auth</td><td>jsonwebtoken, bcryptjs</td><td>^9.0.2, ^2.4.3</td></tr>
              <tr><td>Validation</td><td>zod</td><td>^3.22.4</td></tr>
              <tr><td>Logging</td><td>winston, morgan</td><td>^3.11.0, ^1.10.0</td></tr>
              <tr><td>Alerts</td><td>nodemailer, Slack webhook</td><td>^6.9.7</td></tr>
              <tr><td>Real-time</td><td>ws</td><td>^8.20.0</td></tr>
              <tr><td>Backend tests</td><td>jest, supertest</td><td>^29.7.0, ^7.3.1</td></tr>
              <tr><td>Frontend</td><td>React + Vite + Tailwind</td><td>React ^18.2.0, Vite ^5.0.11, Tailwind ^3.4.1</td></tr>
              <tr><td>Frontend routing / state</td><td>react-router-dom, zustand</td><td>^6.21.0, ^4.4.7</td></tr>
              <tr><td>Charts / 3D / animation</td><td>recharts, three, @react-three/fiber, gsap</td><td>^2.10.3, ^0.184.0, ^8.18.0, ^3.15.0</td></tr>
              <tr><td>Extension</td><td>Chrome MV3 + Vite</td><td>manifest v3, Vite ^8.0.4, React ^19.2.4</td></tr>
            </tbody>
          </table>
        </div>
        <DocsCallout type="note" title="Source of versions">
          Versions come from <code>backend/package.json</code>, <code>frontend/package.json</code>,{' '}
          <code>shadow-extension/package.json</code> and{' '}
          <code>shadow-extension/public/manifest.json</code>.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'setup',
    title: 'Installation & Local Development',
    keywords: ['install', 'setup', 'local', 'development', 'docker', 'mongodb', 'npm', 'quick start'],
    content: (
      <>
        <h3>Prerequisites</h3>
        <ul>
          <li>Node.js 20+ and npm</li>
          <li>Docker (for local MongoDB) or an existing MongoDB 7 instance</li>
          <li>A Chromium-based browser for the extension</li>
        </ul>

        <h3>Local development</h3>
        <CodeBlock
          language="bash"
          title="setup.sh"
          code={`git clone https://github.com/sudha16-sketc/Shadow_AI.git
cd Shadow_AI

# Environment (git-ignored; examples are committed with placeholders only)
cp .env.example .env
cp backend/.env.example backend/.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # -> backend/.env JWT_SECRET

# Database
docker run -d -p 27017:27017 --name mongo docker.io/library/mongo:7

# API  ->  http://localhost:3001
cd backend  && npm install && npm run dev

# Dashboard  ->  http://localhost:5173
cd ../frontend && npm install && npm run dev`}
        />

        <h3>Extension build</h3>
        <CodeBlock
          language="bash"
          title="extension.sh"
          code={`cd shadow-extension && npm ci && npm run build:development
# chrome://extensions -> Developer mode -> Load unpacked -> shadow-extension/dist`}
        />

        <h3>Full stack via Docker Compose</h3>
        <CodeBlock
          language="bash"
          title="compose.sh"
          code={`cp .env.example .env          # set JWT_SECRET, VITE_API_URL, CORS_ORIGINS
docker compose up -d --build  # mongo :27017, API :3001, dashboard :5173
curl -s localhost:3001/health # {"status":"ok", ...}
curl -s localhost:3001/ready  # {"status":"ready"}`}
        />

        <DocsCallout type="warn" title="No self-service signup">
          Accounts only exist through an organization invitation. See the{' '}
          <em>Authentication &amp; Permissions</em> section for the onboarding sequence.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'configuration',
    title: 'Configuration & Environment',
    keywords: ['env', 'environment', 'configuration', 'variables', 'jwt_secret', 'cors', 'smtp', 'vite'],
    content: (
      <>
        <p>
          Runtime configuration is environment-only. <code>.env</code> files are git-ignored;{' '}
          <code>.env.example</code> files are committed with placeholders and must never contain real values.
        </p>

        <h3>Backend (<code>backend/.env</code>)</h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Purpose</th>
                <th>Default / example</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>NODE_ENV</code></td><td>Runtime mode</td><td>development</td></tr>
              <tr><td><code>PORT</code></td><td>API port</td><td>3001</td></tr>
              <tr><td><code>JWT_SECRET</code></td><td><strong>Required.</strong> HS256 signing secret; 48+ bytes, 16+ distinct chars</td><td>(empty; set in .env)</td></tr>
              <tr><td><code>MONGODB_URI</code></td><td>Mongo connection string</td><td>mongodb://localhost:27017/shadow-ai-auditor</td></tr>
              <tr><td><code>CORS_ORIGINS</code></td><td>Comma-separated allowed credentialed origins</td><td>http://localhost:5173,…</td></tr>
              <tr><td><code>TRUST_PROXY</code></td><td>Trust <code>X-Forwarded-For</code> behind a proxy</td><td>false</td></tr>
              <tr><td><code>GATEWAY_TIMEOUT_MS</code></td><td>Upstream AI provider timeout (ms)</td><td>60000</td></tr>
              <tr><td><code>SHUTDOWN_GRACE_MS</code></td><td>In-flight drain time on SIGTERM/SIGINT</td><td>15000</td></tr>
              <tr><td><code>AUDIT_EXPORT_MAX_ROWS</code></td><td>Cap on <code>GET /api/audit-log/export</code> rows</td><td>10000</td></tr>
              <tr><td><code>LOG_LEVEL</code></td><td>trace | debug | info | warn | error</td><td>info</td></tr>
              <tr><td><code>FRONTEND_URL</code></td><td>Origin used in alert links</td><td>http://localhost:5173</td></tr>
              <tr><td><code>SMTP_*</code></td><td>Optional email alerting (blank disables)</td><td>SMTP_PORT=587, …</td></tr>
              <tr><td><code>PLATFORM_ADMIN_EMAIL</code> / <code>_PASSWORD</code></td><td>One-time bootstrap for <code>npm run provision:platform-admin</code></td><td>(empty)</td></tr>
            </tbody>
          </table>
        </div>

        <h3>Frontend (<code>frontend/.env</code>)</h3>
        <CodeBlock
          language="env"
          title="frontend/.env"
          code={`VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001`}
        />

        <h3>Extension (<code>shadow-extension/.env.&lt;mode&gt;.example</code>)</h3>
        <CodeBlock
          language="env"
          title=".env.development.example"
          code={`VITE_API_URL=http://localhost:3001
VITE_DASHBOARD_URL=http://localhost:5173`}
        />
        <p>
          Staging and production examples use <code>https://…example.invalid</code> placeholders.
          <code> shadow-extension/vite.config.js</code> refuses to build staging/production against a
          localhost or non-HTTPS <code>VITE_API_URL</code>.
        </p>

        <DocsCallout type="danger" title="Never commit real secrets">
          The tracked example files contain placeholders only. Real values belong in git-ignored{' '}
          <code>.env</code> files or a secret manager.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'authentication',
    title: 'Roles, Authentication & Permissions',
    keywords: ['auth', 'authentication', 'roles', 'permissions', 'jwt', 'device', 'login', 'invitation', 'rbac', 'admin'],
    content: (
      <>
        <h3>Credential types</h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Credential</th>
                <th>Issued to</th>
                <th>Scope</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>User JWT (<code>tokenType: user</code>)</td><td>dashboard user</td><td>org + user + <code>authVersion</code></td><td>7-day TTL, HS256; revoked by bumping <code>authVersion</code></td></tr>
              <tr><td>Device credential (<code>dvc_…</code>)</td><td>extension after pairing</td><td>device + owner user</td><td>stored as a hash; revocable per device</td></tr>
              <tr><td>Platform admin JWT</td><td>operator</td><td>platform</td><td>15-minute access token, separate collection</td></tr>
              <tr><td>WebSocket ticket</td><td>dashboard session</td><td>one user, one org</td><td>single use, 20-second TTL</td></tr>
            </tbody>
          </table>
        </div>

        <h3>Tenant roles</h3>
        <ul>
          <li><code>admin</code> — full tenant control (users, settings, policies).</li>
          <li><code>manager</code> — read users/events, review justifications, audit log, WebSocket tickets.</li>
          <li><code>viewer</code> — read-oriented access.</li>
          <li>Platform plane roles: <code>super_admin</code> and <code>manager</code>.</li>
        </ul>

        <h3>Login</h3>
        <p>
          Input is validated with zod and timing-equalised with a dummy password hash so a missing
          account and a wrong password take the same time.
        </p>
        <CodeBlock
          language="http"
          title="POST /api/auth/login"
          code={`POST /api/auth/login
Content-Type: application/json

{ "email": "user@example.test", "password": "********" }

200 OK
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "…",
    "name": "Security Admin",
    "email": "user@example.test",
    "orgId": "…",
    "role": "admin"
  }
}`}
        />

        <h3>Onboarding (no self-service)</h3>
        <CodeBlock
          language="text"
          title="provisioning"
          code={`operator   -> npm run provision:platform-admin   (PLATFORM_ADMIN_EMAIL/PASSWORD)
platform   -> POST /api/platform-admin/auth/login
           -> POST /api/platform-admin/tenants                    -> tenant + invitation (24h, single use)
           -> POST /api/platform-admin/tenants/:id/invitations    -> re-issue/replace invite
invitee    -> POST /api/platform-admin/invitations/accept         -> tenant active + first admin
admin      -> dashboard: create users, pair devices, set policy
user       -> POST /api/auth/login -> POST /api/auth/device/enrollment-code
extension  -> POST /api/auth/device/register  (one-time pairing code)`}
        />

        <DocsCallout type="note" title="Signup disabled by design">
          <code>POST /api/auth/signup</code> returns HTTP 403. Accounts only exist through an invitation.
        </DocsCallout>

        <h3>Representative endpoint permissions</h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Area</th>
                <th>Required role</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Users — list / get / events</td><td>admin, manager</td></tr>
              <tr><td>Users — create / update / password / delete</td><td>admin</td></tr>
              <tr><td>Users — opt-out toggle</td><td>self or admin</td></tr>
              <tr><td>Settings (all routes)</td><td>admin</td></tr>
              <tr><td>Audit log — list / get</td><td>admin, manager</td></tr>
              <tr><td>Audit log — export</td><td>admin</td></tr>
              <tr><td>Justifications — review / approve</td><td>admin, manager</td></tr>
              <tr><td>Policies — create / update / delete</td><td>org admin</td></tr>
              <tr><td>Platform — create tenant / invitations / status</td><td>super_admin</td></tr>
              <tr><td>Platform managers (all routes)</td><td>super_admin</td></tr>
            </tbody>
          </table>
        </div>
      </>
    ),
  },

  {
    id: 'detection',
    title: 'Detection Engine & Risk Scoring',
    keywords: ['detection', 'engine', 'patterns', 'regex', 'risk', 'scoring', 'severity', 'masking', 'pii', 'secrets'],
    content: (
      <>
        <p>
          Two copies of the pattern set exist by design: a fast local copy in the extension
          (<code>shadow-extension/src/detectionEngine.js</code>) and an authoritative server copy in
          <code> backend/src/routes/gateway.js</code>. The server copy is what decides enforcement;
          the duplication is a documented maintenance cost.
        </p>

        <h3>Detected categories</h3>
        <ul>
          <li><strong>API keys &amp; tokens:</strong> AWS access key, Stripe secret/publishable, GitHub personal/OAuth token, NPM token, JWT.</li>
          <li><strong>Secrets:</strong> RSA/EC/OpenSSH private keys, generic secret/password assignments, database connection strings.</li>
          <li><strong>PII:</strong> email, US SSN, credit card number, US phone number, internal IP address.</li>
          <li><strong>Confidentiality keywords:</strong> confidential, internal only, do not share, not for distribution, proprietary, trade secret, NDA, attorney-client, classified, private key, access/bearer token.</li>
        </ul>

        <h3>Scoring (server, authoritative)</h3>
        <p>
          <code>calculateRiskAndSeverity</code> in <code>backend/src/services/policy-engine.js</code>{' '}
          maps each finding label to a category and base score, then:
        </p>
        <CodeBlock
          language="text"
          title="risk formula"
          code={`riskScore = max(baseScore) + (findingCount - 1) * 2   # capped at 100

severity thresholds:
  >= 90  CRITICAL
  >= 70  HIGH
  >= 40  MEDIUM
  <  40  LOW`}
        />
        <p>Example base scores: Credit Card 98, Private Key 99, Stripe Secret 95, SSN 95, AWS Access Key 90, NPM Token 85, Email 40.</p>

        <h3>Extension scoring (local, advisory)</h3>
        <p>
          The extension adds a bonus when two or more PII types are present
          (<code>+20</code>, capped at 100) and maps scores to <code>LOW</code>/<code>MEDIUM</code>/
          <code>HIGH</code> at 40/70. It never returns or logs raw values — only masked samples and a
          masked preview.
        </p>

        <DocsCallout type="info" title="A label can be added by an occurrence, not a value">
          Detection records the <em>label</em> and a masked sample. Sensitive values are replaced in
          the preview (for example <code>sk_l****2345</code>); they are never stored in plaintext.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'warning-flow',
    title: 'Warning Flow & Prompt Submission',
    keywords: ['warning', 'modal', 'cancel', 'proceed', 'mask', 'interception', 'submission', 'paste', 'rescan'],
    content: (
      <>
        <p>
          The paste/submit interception workflow is a pure, dependency-free state machine in
          <code> shadow-extension/src/interceptionWorkflow.js</code>. It has no DOM or{' '}
          <code>chrome.*</code> references, so it is unit-tested directly.
        </p>

        <h3>Operation states</h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>pending</code></td><td>Awaiting a user decision; blocks submission</td></tr>
              <tr><td><code>approved</code></td><td>User chose to proceed as-is</td></tr>
              <tr><td><code>masked</code></td><td>Text was rewritten with redactions</td></tr>
              <tr><td><code>cancelled</code></td><td>User chose Cancel</td></tr>
            </tbody>
          </table>
        </div>

        <h3>Interception rules</h3>
        <ul>
          <li>Every paste is inspected as its own operation — no de-duplication.</li>
          <li>Each operation has a unique id and isolated state.</li>
          <li>A submission is authorised only after a fresh rescan, or for the exact text an operation was approved/masked for.</li>
          <li>A single approval authorises exactly one submission (<code>consumeApproved</code> removes the operation).</li>
          <li>A pending operation blocks any submission.</li>
          <li>No raw text is ever logged or persisted by this module.</li>
        </ul>

        <h3>Submission gate</h3>
        <CodeBlock
          language="js"
          title="authorizeSubmission()"
          code={`export function authorizeSubmission(controller, text, { analyse, threshold, trigger = 'submit' } = {}) {
  const blocking = controller.getBlockingOperation();
  if (blocking) {
    return { allowed: false, reason: INTERCEPT_REASON.PENDING_DECISION, operation: blocking };
  }

  const approval = controller.consumeApproved(text);
  if (approval) {
    return { allowed: true, reason: INTERCEPT_REASON.APPROVED, operation: approval };
  }

  const result = analyse(text);
  if (!shouldIntercept(result, threshold)) {
    return { allowed: true, reason: INTERCEPT_REASON.CLEAN, result };
  }

  const operation = controller.begin(text, result, { trigger });
  return { allowed: false, reason: INTERCEPT_REASON.HIGH_RISK, operation, result };
}`}
        />

        <DocsCallout type="note" title="Event types reported">
          Reported event types are <code>paste</code>, <code>typing</code>,{' '}
          <code>modal_cancel</code> and <code>modal_proceed</code> (validated by the backend{' '}
          <code>EventSchema</code>).
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'api',
    title: 'Backend APIs & Data Flow',
    keywords: ['api', 'endpoints', 'rest', 'routes', 'gateway', 'events', 'analytics', 'audit', 'platform', 'data flow'],
    content: (
      <>
        <p>
          Base path <code>/api</code> for management routes, <code>/gateway/v1</code> for
          enforcement. Unless noted, routes require a bearer JWT. There are <strong>65 route handlers</strong>{' '}
          across <code>backend/src/routes/</code>.
        </p>

        <h3>Auth — <code>/api/auth</code></h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Purpose</th></tr></thead>
            <tbody>
              <tr><td>POST</td><td>/login</td><td>none</td><td>Tenant user login</td></tr>
              <tr><td>POST</td><td>/signup</td><td>none</td><td>Disabled — 403</td></tr>
              <tr><td>GET</td><td>/check-auth</td><td>user JWT</td><td>Validate session</td></tr>
              <tr><td>POST</td><td>/logout</td><td>user JWT</td><td>Bump authVersion to revoke tokens</td></tr>
              <tr><td>POST</td><td>/device/enrollment-code</td><td>user JWT</td><td>Issue one-time pairing code</td></tr>
              <tr><td>POST</td><td>/device/register</td><td>enrollment code</td><td>Register device → <code>dvc_</code> credential</td></tr>
              <tr><td>POST</td><td>/device/:deviceId/revoke</td><td>user JWT</td><td>Revoke a device</td></tr>
              <tr><td>POST</td><td>/ws-ticket</td><td>admin, manager</td><td>Single-use WebSocket ticket</td></tr>
            </tbody>
          </table>
        </div>

        <h3>Events — <code>/api/events</code></h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>Purpose</th></tr></thead>
            <tbody>
              <tr><td>POST</td><td>/</td><td>device</td><td>Report a detection event → 202</td></tr>
              <tr><td>POST</td><td>/batch</td><td>device</td><td>Report up to 200 events</td></tr>
              <tr><td>GET</td><td>/</td><td>user JWT</td><td>List events (paginated, tenant-scoped)</td></tr>
              <tr><td>GET</td><td>/stats</td><td>user JWT</td><td>Aggregate statistics (30-day window)</td></tr>
            </tbody>
          </table>
        </div>

        <CodeBlock
          language="http"
          title="POST /api/events (device credential)"
          code={`POST /api/events
Authorization: Bearer dvc_xxxxxxxx

{
  "idempotencyKey": "8f1c2b6e4a9d4f0e",
  "domain": "chatgpt.com",
  "eventType": "paste",
  "riskScore": 90,
  "severity": "HIGH",
  "maskedPreview": "AKIA****MPLE",
  "findingLabels": ["AWS Access Key"],
  "timestamp": "2026-01-01T00:00:00.000Z"
}

202 Accepted
{ "ok": true, "requestPrevented": false, "duplicate": false, "eventId": "…" }`}
        />
        <DocsCallout type="note" title="Server overrides client claims">
          The stored <code>riskScore</code> and <code>severity</code> are computed server-side. The
          client values are kept only under <code>clientTelemetry</code> for comparison.
        </DocsCallout>

        <h3>Gateway — <code>/gateway/v1/:provider/*</code></h3>
        <p>
          Providers: <code>openai</code> (<code>https://api.openai.com</code>) and{' '}
          <code>anthropic</code> (<code>https://api.anthropic.com</code>). Any other provider returns
          HTTP 400.
        </p>
        <CodeBlock
          language="http"
          title="POST /gateway/v1/openai/v1/chat/completions"
          code={`POST /gateway/v1/openai/v1/chat/completions
Authorization: Bearer dvc_xxxxxxxx
x-upstream-auth: sk-...          # forwarded to the provider only

{ "messages": [ { "role": "user", "content": "..." } ] }

# BLOCK
403 Forbidden
{ "error": "Blocked by Shadow AI Security Policy",
  "decision": { "decision": "BLOCK", "reason": "org_default_block_on_high", "riskScore": 90, "severity": "HIGH" },
  "requestId": "…" }

# ALLOW / SANITIZE -> proxied response (provider status relayed)
X-Shadow-Response-Findings: 0
X-Request-Id: …`}
        />

        <h3>Other route groups</h3>
        <ul>
          <li><code>/api/users</code> — list/get/create/update, password reset, opt-out, events per user.</li>
          <li><code>/api/analytics</code> — <code>/overview</code>, <code>/risk-timeline</code>, <code>/top-users</code>, <code>/severity-breakdown</code>.</li>
          <li><code>/api/settings</code> — org settings, default policy, Slack/email tests, monitored domains (admin only).</li>
          <li><code>/api/justifications</code> — submit, pending, list, get, approve.</li>
          <li><code>/api/audit-log</code> — list, get, export (admin only).</li>
          <li><code>/api/policies</code> — CRUD with org-admin gating.</li>
          <li><code>/api/platform-admin</code> (monitoring, managers) — platform-plane administration.</li>
          <li><code>GET /health</code> → <code>{'{ "status": "ok", "ts": … }'}</code>; <code>GET /ready</code> → <code>200</code>/<code>503</code>.</li>
        </ul>
      </>
    ),
  },

  {
    id: 'data-model',
    title: 'Database Models & Tenant Isolation',
    keywords: ['database', 'models', 'schema', 'mongodb', 'tenant isolation', 'org', 'user', 'event', 'policy', 'indexes'],
    content: (
      <>
        <p>
          All models are defined in <code>backend/src/models/index.js</code>. The system uses one
          MongoDB database with tenant isolation enforced by query scoping.
        </p>

        <div className="docsTableWrap">
          <table className="docsTable">
            <thead>
              <tr><th>Collection</th><th>Model</th><th>Purpose</th><th>Notable fields</th></tr>
            </thead>
            <tbody>
              <tr><td><code>orgs</code></td><td>Org</td><td>Tenant + default policy</td><td><code>lifecycleStatus</code> (pending_admin/active/suspended), <code>settings.defaultAction</code>, <code>settings.blockOnHigh</code>, <code>monitoredDomains</code></td></tr>
              <tr><td><code>users</code></td><td>User</td><td>Tenant users</td><td><code>role</code> (admin/manager/viewer), <code>authVersion</code>, <code>extensionUserId</code>, <code>optedOut</code>, <code>isActive</code></td></tr>
              <tr><td><code>teams</code></td><td>Team</td><td>Group scoping</td><td>Used by <code>scope: GROUP</code> policies</td></tr>
              <tr><td><code>devices</code></td><td>Device</td><td>Paired extensions</td><td><code>tokenHash</code>, <code>isActive</code>, <code>revokedAt</code>, <code>lastSeenAt</code></td></tr>
              <tr><td><code>policies</code></td><td>Policy</td><td>Rule overrides</td><td><code>scope</code>, <code>targetId</code>, <code>rules[]</code>, <code>action</code>, <code>precedence</code>, <code>status</code>, <code>version</code></td></tr>
              <tr><td><code>events</code></td><td>Event</td><td>Detections + gateway decisions</td><td><code>findingLabels</code>, <code>riskScore</code>, <code>severity</code>, <code>policyDecision/Reason/Version</code>, <code>enforcementStatus</code>, <code>requestForwarded</code>, <code>sanitizedRedactions</code></td></tr>
              <tr><td><code>eventreplays</code></td><td>EventReplay</td><td>Replay/idempotency guard</td><td>Semantic key per device+org, 2-minute window</td></tr>
              <tr><td><code>justifications</code></td><td>Justification</td><td>User-accepted warnings</td><td>reviewer, status, reason</td></tr>
              <tr><td><code>auditlogs</code></td><td>AuditLog</td><td>Admin actions + gateway findings</td><td>actor, target, changes, ip, userAgent</td></tr>
              <tr><td><code>platformadmins</code>, <code>tenantinvitations</code>, <code>platformauditlogs</code></td><td>Platform plane</td><td>Operators and invites</td><td>Invitation tokens single-use, 24h</td></tr>
              <tr><td><code>authevents</code></td><td>AuthEvent</td><td>Login/auth telemetry</td><td>TTL 30 days</td></tr>
            </tbody>
          </table>
        </div>

        <h3>Tenant isolation</h3>
        <ul>
          <li>Every query is scoped to <code>req.user.orgId</code>.</li>
          <li><code>requireTenantAccess</code> rejects a request that names a different <code>orgId</code> in params, query or body.</li>
          <li>Cross-tenant access is rejected and covered by the test suite.</li>
        </ul>

        <h3>Index lifecycle</h3>
        <p>
          <code>autoIndex</code> is disabled and declarative indexes are created at startup in{' '}
          <code>startServer()</code> (<code>backend/src/server.js</code>), including TTL indexes on{' '}
          <code>events</code>/<code>eventreplays</code>/<code>authevents</code> and sparse compound
          unique indexes on idempotency keys. <code>/ready</code> gates traffic until indexes sync.
        </p>

        <DocsCallout type="info" title="Additive schema evolution">
          Schemas evolve additively (expand → dual-write → contract). Version-bearing fields include{' '}
          <code>Org.policyVersion</code>, <code>Policy.version</code> and{' '}
          <code>Event.policyVersion</code>.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'security',
    title: 'Security Controls & Threat Prevention',
    keywords: ['security', 'threat', 'ssrf', 'csrf', 'cors', 'ratelimit', 'rate limit', 'headers', 'sanitize', 'injection', 'hardening'],
    content: (
      <>
        <h3>Implemented controls</h3>
        <ul>
          <li>Server-authoritative policy — client-supplied severity, decision and tenant fields are ignored.</li>
          <li><code>BLOCK</code> → 403 with no provider call; <code>SANITIZE</code> → deterministic redaction, failing closed if the payload cannot be re-parsed.</li>
          <li>Gateway header allowlists in both directions (cookies, JWT and <code>set-cookie</code> never cross the boundary), upstream timeout, no redirects.</li>
          <li>Tenant isolation and cross-tenant rejection; role checks; <code>authVersion</code> revocation; hashed device credentials; <code>alg:none</code> and forged signatures rejected.</li>
          <li>CORS allowlist including the packaged extension origin (<code>chrome-extension://[a-p]{'{32}'}</code>).</li>
          <li>Rate limiting, request IDs (<code>X-Request-Id</code>), 50 kb body limit, JSON error handling.</li>
          <li>SSRF guard on Slack webhooks (HTTPS only, private/loopback/metadata hosts rejected).</li>
          <li>CSV formula-injection neutralised; pagination, date windows and regex inputs bounded.</li>
        </ul>

        <h3>Rate limits (from <code>app.js</code>)</h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead><tr><th>Prefix</th><th>Window</th><th>Max requests</th></tr></thead>
            <tbody>
              <tr><td><code>/api/events</code></td><td>60 s</td><td>100</td></tr>
              <tr><td><code>/api/auth</code></td><td>60 s</td><td>20</td></tr>
              <tr><td><code>/api/platform-admin</code></td><td>60 s</td><td>30</td></tr>
              <tr><td><code>/gateway/v1</code></td><td>60 s</td><td>60</td></tr>
              <tr><td><code>/api/policies</code></td><td>60 s</td><td>60</td></tr>
            </tbody>
          </table>
        </div>

        <h3>Deliberately not implemented</h3>
        <p>
          SSO/SAML, MFA, TLS interception, enterprise SIEM integration, Redis/shared ticket store,
          secrets-manager integration and Kubernetes are out of PoC scope and recorded as future work.
        </p>

        <DocsCallout type="warn" title="Documented security limitations">
          Response inspection reports but does not block; the SSRF guard does not resolve DNS; rate
          limiting and WebSocket tickets are per-process (single instance only); direct SDK/native
          traffic that bypasses <code>/gateway/v1</code> is not covered.
        </DocsCallout>
      </>
    ),
  },

  {
    id: 'testing',
    title: 'Testing, Build & Deployment',
    keywords: ['testing', 'tests', 'jest', 'build', 'deploy', 'docker', 'ci', 'lint', 'coverage'],
    content: (
      <>
        <h3>Commands</h3>
        <div className="docsTableWrap">
          <table className="docsTable">
            <thead><tr><th>Component</th><th>Command</th><th>Notes</th></tr></thead>
            <tbody>
              <tr><td>Backend tests</td><td><code>cd backend &amp;&amp; npm test</code></td><td>Uses <code>node --experimental-vm-modules</code> + Jest; plain <code>npx jest</code> fails on ESM</td></tr>
              <tr><td>Extension tests</td><td><code>cd shadow-extension &amp;&amp; npm run test:config</code></td><td>Uses <code>node --test</code></td></tr>
              <tr><td>Frontend lint</td><td><code>cd frontend &amp;&amp; npm run lint</code></td><td>ESLint flat config</td></tr>
              <tr><td>Frontend build</td><td><code>cd frontend &amp;&amp; npm run build</code></td><td>Vite production build</td></tr>
              <tr><td>Extension build</td><td><code>cd shadow-extension &amp;&amp; npm run build:development</code></td><td>Also <code>build:staging</code>, <code>build:production</code></td></tr>
            </tbody>
          </table>
        </div>

        <p>
          The backend suite needs no MongoDB and no network: models are in-memory doubles and{' '}
          <code>fetch</code> is a spy, so it proves that <code>BLOCK</code> makes zero upstream calls
          rather than assuming it.
        </p>

        <h3>Frontend state (verified for this project)</h3>
        <CodeBlock
          language="bash"
          title="frontend checks"
          code={`npm run lint    # baseline: 0 errors after documentation changes, existing warnings remain
npm run build   # Vite production build succeeds`}
        />

        <DocsCallout type="note" title="Test counts are environment-specific">
          Historical documents report stale counts. Reported counts should always be taken from the
          command output in the environment where they were run; this page does not assert a fixed number.
        </DocsCallout>

        <h3>Deployment</h3>
        <CodeBlock
          language="bash"
          title="deploy.sh"
          code={`cp .env.example .env
docker compose up -d --build   # mongo :27017 (internal), API :3001, dashboard :5173`}
        />
        <p>
          The frontend image builds with Vite and serves static files through nginx using{' '}
          <code>frontend/nginx.conf</code> as an envsubst template, so <code>API_ORIGIN</code> ends up
          in the CSP <code>connect-src</code> list. Set <code>TRUST_PROXY=true</code> only when a
          reverse proxy supplies <code>X-Forwarded-For</code>.
        </p>
      </>
    ),
  },

  {
    id: 'troubleshooting',
    title: 'Troubleshooting & FAQ',
    keywords: ['troubleshooting', 'faq', 'errors', 'esm', 'jwt', 'ready', '403', '500', 'websocket', 'help'],
    content: (
      <>
        <div className="docsFaq">
          <h4>Tests fail with ESM / --experimental-vm-modules errors</h4>
          <p>Run <code>npm test</code> from <code>backend/</code>, which bundles the flag. Plain <code>npx jest</code> does not work.</p>

          <h4>JWT_SECRET validation error at startup</h4>
          <p>The secret must be at least 48 bytes and contain at least 16 distinct characters (<code>backend/src/config/security.js</code>). Generate one with the <code>node -e</code> command in Setup.</p>

          <h4>/ready returns 503</h4>
          <p>MongoDB is not connected yet or is reconnecting. <code>/health</code> reports liveness independently.</p>

          <h4>Extension build refuses staging/production</h4>
          <p><code>VITE_API_URL</code> must be HTTPS and non-local for those modes (<code>shadow-extension/vite.config.js</code>).</p>

          <h4>A gateway request returns 403</h4>
          <p>Policy evaluated to <code>BLOCK</code>. An event is stored with <code>enforcementStatus=PREVENTED</code> and <code>requestForwarded=false</code>; the provider was not contacted.</p>

          <h4>A gateway SANITIZE request returns 500</h4>
          <p>The payload could not be re-parsed after redaction; the request failed closed and nothing was sent.</p>

          <h4>Do the tests need a database or network?</h4>
          <p>No. The backend suite uses in-memory model doubles and a <code>fetch</code> spy.</p>

          <h4>WebSocket alerts drop after a restart</h4>
          <p>Tickets are per-process and single-instance — expected in the PoC.</p>
        </div>
      </>
    ),
  },

  {
    id: 'limitations',
    title: 'Limitations & Roadmap',
    keywords: ['limitations', 'roadmap', 'future', 'gaps', 'not implemented', 'planned', 'todo'],
    content: (
      <>
        <h3>Known limitations</h3>
        <ul>
          <li>Response inspection reports; it does not block or redact responses.</li>
          <li>The SSRF guard does not resolve DNS — hostname-based bypasses remain possible until an egress policy exists.</li>
          <li>Detection rules are duplicated in the extension and the gateway, so they can drift.</li>
          <li>Rate limiting and WebSocket tickets are per-process — running two API instances breaks both.</li>
          <li>No TLS interception, SSO/SAML, MFA, secrets manager, or SIEM integration.</li>
          <li>Direct SDK/native traffic is not covered: only requests routed through <code>/gateway/v1</code> are enforced.</li>
          <li><strong>Frontend routing gap:</strong> <code>Justifications</code> and <code>AuditLog</code> pages are not registered in <code>App.jsx</code>.</li>
        </ul>

        <h3>Roadmap</h3>
        <p><strong>P0</strong></p>
        <ul>
          <li>DNS-aware SSRF guard</li>
          <li>Token/session rotation</li>
          <li>CI running the full suite on every push</li>
          <li>WAF / rate limiting at the edge</li>
        </ul>
        <p><strong>P1</strong></p>
        <ul>
          <li>Shared rate-limit and WebSocket-ticket store</li>
          <li>Response inspection that can block</li>
          <li>Managed secrets, centralised audit sink, schema/versioning policy</li>
        </ul>
        <p><strong>P2</strong></p>
        <ul>
          <li>Horizontal API scaling</li>
          <li>Enterprise SSO, MFA, SIEM export</li>
          <li>Blue/green deploys, observability beyond logs</li>
        </ul>

        <DocsCallout type="note" title="Documentation debt in the repo">
          Several root documents reference <code>SECURITY_TEST_PLAN.md</code>,{' '}
          <code>PRODUCTION_GAP_ANALYSIS.md</code> and <code>docs/history/</code>, none of which exist
          in the repository. They are noted here rather than linked.
        </DocsCallout>
      </>
    ),
  },
];
