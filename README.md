# Shadow AI Auditor

Tenant-scoped detection, audit, and **policy enforcement** for sensitive data
sent to public AI tools.

```
browser extension ──► POST /api/events      report-only audit trail
browser extension ──► POST /gateway/v1/…    ALLOW · WARN · SANITIZE · BLOCK
                     └── server decides; the client cannot
```

A proof of concept built to be reviewed: 100 automated tests, documented
limitations, and an explicit gap analysis.

| | |
|---|---|
| Backend tests | **90 passing** · `cd backend && npm test` |
| Extension tests | **10 passing** · `cd shadow-extension && npm run test:config` |
| Lint | extension clean · frontend 0 errors |
| Docs | [Project overview](PROJECT_OVERVIEW.md) · [Architecture](ARCHITECTURE.md) · [Workflow](WORKFLOW.md) |
| Security | [Features](SECURITY_FEATURES.md) · [Test plan](SECURITY_TEST_PLAN.md) · [Test report](SECURITY_TEST_REPORT.md) · [Gap analysis](PRODUCTION_GAP_ANALYSIS.md) |
| Demo | [15-minute scripted walkthrough](DEMO_GUIDE.md) |

---

## What it does

- **Detects** credentials, PII, and confidentiality terms in prompts, in the
  browser, before they are sent.
- **Records** every finding as a tenant-scoped `Event` with risk score,
  severity, policy decision, and enforcement status.
- **Enforces** policy server-side at the gateway: `BLOCK` never contacts the AI
  provider, `SANITIZE` redacts detected secrets before forwarding, and every
  decision is audited.
- **Reports** through a React dashboard: overview, events, users, analytics,
  justifications, audit log, settings — plus Slack/email/WebSocket alerts.

## Quick start

```bash
git clone https://github.com/sudha16-sketc/Shadow_AI.git && cd Shadow_AI

# environment (git-ignored; examples are committed with placeholders only)
cp .env.example .env && cp backend/.env.example backend/.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # → backend/.env JWT_SECRET

# database
docker run -d -p 27017:27017 --name mongo mongo:7

# API and dashboard
cd backend  && npm install && npm run dev     # :3001
cd ../frontend && npm install && npm run dev  # :5173

# extension
cd ../shadow-extension && npm ci && npm run build:development
# chrome://extensions → Developer mode → Load unpacked → shadow-extension/dist
```

There is **no self-service signup**: an operator provisions a platform
administrator, who creates a tenant and issues a single-use invitation. Full
sequence in [`WORKFLOW.md` §5](WORKFLOW.md).

## Verify it yourself

```bash
cd backend && npm test
# Test Suites: 5 passed, 5 total
# Tests:       90 passed, 90 total

cd ../shadow-extension && npm run test:config
# tests 10 / pass 10 / fail 0
```

Tests need no MongoDB and no network: models are in-memory doubles and
`fetch` is a spy, so the suite proves that `BLOCK` makes **zero** upstream
calls rather than assuming it.

## Configuration

Environment only — no secret is read from source.

| File | Purpose |
|---|---|
| `.env.example` | values consumed by `docker-compose.yml` |
| `backend/.env.example` | API runtime configuration |
| `shadow-extension/.env.<mode>.example` | extension build origins |

Key settings: `JWT_SECRET` (mandatory, ≥48 bytes, validated at startup),
`CORS_ORIGINS`, `TRUST_PROXY`, `GATEWAY_TIMEOUT_MS`, `SMTP_*`.

`docker compose up -d --build` runs Mongo, the API, and the dashboard (nginx
with CSP headers rendered from `API_ORIGIN`).

## Security posture in one screen

**Enforced and tested**

- Server-authoritative policy — client-supplied severity/decision/tenant fields
  are ignored.
- `BLOCK` → 403 with no provider call · `SANITIZE` → deterministic redaction,
  failing closed if the payload cannot be re-parsed.
- Gateway header allowlists in both directions (cookies, our JWT, and
  `set-cookie` never cross the boundary), upstream timeout, no redirects.
- Tenant isolation and cross-tenant rejection; role checks; `authVersion`
  revocation; hashed device credentials; `alg:none` and forged signatures
  rejected; login input validated and timing-equalised.
- CORS allowlist (plus the packaged extension origin), rate limiting, request
  IDs, body limits, JSON error handling.
- SSRF guard on Slack webhooks (HTTPS only, private/metadata hosts rejected).
- CSV formula injection neutralised; pagination, date windows, and regex inputs
  bounded.
- No secrets in source, in `.env` examples, or in git history (scanned).

**Known limitations** — stated, not hidden: response inspection reports findings
but does not block them; the SSRF guard does not resolve DNS; detection patterns
are duplicated between extension and gateway; WebSocket tickets are
single-instance. Full list in
[`SECURITY_FEATURES.md` §11](SECURITY_FEATURES.md) and
[`PRODUCTION_GAP_ANALYSIS.md`](PRODUCTION_GAP_ANALYSIS.md).

## Repository layout

```
backend/            Express API, policy engine, gateway, WebSocket, alerting
  src/app.js        CORS, rate limits, request IDs, health/readiness
  src/routes/       auth, events, gateway, users, analytics, settings, policies,
                    justifications, audit-log, platform-admin
  tests/            5 suites (43 baseline + 47 security regression)
frontend/           React + Vite + Tailwind dashboard, nginx template
shadow-extension/   Chrome MV3 extension (content script, worker, popup)
docs/history/       superseded phase plans and reports (decision trail)
*.md (root)         project, architecture, workflow, and security documentation
docker-compose.yml  mongo + backend + frontend
```

## Scope

This is a proof of concept for a collaborating team, not an enterprise product.
Deliberately out of scope: Kubernetes, microservices, SSO/SAML, MFA, TLS
interception, enterprise SIEM, Redis, and secrets-manager integration — they are
listed as future work rather than half-built. See
[`PRODUCTION_GAP_ANALYSIS.md`](PRODUCTION_GAP_ANALYSIS.md) for the prioritised
backlog and [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) for the full scope
statement.
