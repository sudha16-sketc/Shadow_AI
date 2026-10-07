# Shadow AI Auditor

Tenant-scoped detection, audit, and **policy enforcement** for sensitive data
sent to public AI tools.

```
browser extension ──► POST /api/events      report-only audit trail
browser extension ──► POST /gateway/v1/…    ALLOW · WARN · SANITIZE · BLOCK
                     └── server decides; the client cannot
```

A proof of concept built to be reviewed: 109 automated tests, documented
limitations, and an explicit gap analysis.

| | |
|---|---|
| Backend tests | **99 passing** (6 suites) · `cd backend && npm test` |
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
docker run -d -p 27017:27017 --name mongo docker.io/library/mongo:7

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
# Test Suites: 6 passed, 6 total
# Tests:       99 passed, 99 total

cd ../shadow-extension && npm run test:config
# tests 10 / pass 10 / fail 0
```

Tests need no MongoDB and no network: models are in-memory doubles and
`fetch` is a spy, so the suite proves that `BLOCK` makes **zero** upstream
calls rather than assuming it.

## Architecture

```
Browser extension (untrusted)              Dashboard (React)
  │  POST /api/events (report)               │  JWT (tenant-scoped)
  │  POST /gateway/v1/… (enforce)             ▼
  ▼                                          REST API ──► MongoDB (per-tenant scoping)
┌──────────────────────────────────────────────────┐   │
│ authenticate (JWT / device credential)           │   ├──► WebSocket alerts
│ authorise   (role + org from token)              │   └──► Slack / SMTP (SSRF-guarded)
│ detect      (server-side rules)                  │
│ evaluate    (policy engine)                      │
│     ├─ BLOCK    ──► audit · STOP   (no upstream call)
│     ├─ SANITIZE ──► redact ──► gateway ──► AI provider
│     └─ ALLOW    ─────────────► gateway ──► AI provider
└──────────────────────────────────────────────────┘
```

**Trust boundary:** the extension proposes, the server decides. Client-supplied
severity, risk score, decision, `orgId`, and `userId` are ignored. Full detail,
including data model and request paths, is in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Enforcement flow

| Step | What happens | Where |
|---|---|---|
| 1 | Client sends a device credential + prompt to `/gateway/v1/:provider/*` | `routes/gateway.js` |
| 2 | Provider and path checked against allowlists; only allowlisted request headers survive | same |
| 3 | Server-side detection produces finding labels, risk score, severity | detection rules |
| 4 | Policy engine returns `ALLOW`/`WARN`/`SANITIZE`/`BLOCK` from tenant + user + label rules | `services/policy-engine.js` |
| 5a | `BLOCK` → 403, event `PREVENTED`, `requestForwarded=false`, **provider never called** | same |
| 5b | `SANITIZE` → secrets replaced with `[REDACTED:…]`; if re-parsing fails → 500, no send | same |
| 5c | `ALLOW`/`WARN` → forward with a header allowlist, upstream timeout, no redirects | same |
| 6 | Response headers filtered; response inspection records findings (report-only) | same |
| 7 | Event + audit log written with `policyDecision` ≠ `enforcementStatus` | models |

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

**Not implemented (deliberately)** — SSO/SAML, MFA, TLS interception, SIEM,
Redis, secrets managers, Kubernetes. **Accepted limitations** are listed under
[Known limitations](#known-limitations) below; the control-by-control inventory
is in [`SECURITY_FEATURES.md`](SECURITY_FEATURES.md).

## Deployment

```bash
cp .env.example .env          # set JWT_SECRET (48+ random bytes) and VITE_API_URL
docker compose up -d --build  # mongo :27017, API :3001, dashboard :5173
curl -s localhost:3001/health # {"status":"ok",…}
curl -s localhost:3001/ready  # {"status":"ready"}
```

The frontend image builds with Vite and serves static files through nginx using
`nginx.conf` as an `envsubst` template, so `API_ORIGIN` ends up in the CSP
`connect-src` list. Image references are fully qualified
(`docker.io/library/…`) so the same files work with Docker and rootless Podman;
with Podman start the socket first
(`podman system service --time=0 unix:///tmp/podman.sock &`) and export
`DOCKER_HOST=unix:///tmp/podman.sock` for `docker compose`.

**Free-tier hosting notes** — these are real constraints, not oversights:

| Constraint | Effect on Shadow AI | Mitigation |
|---|---|---|
| Instance sleep / cold start | first request after idle takes 10–30 s; `/ready` may 503 while Mongo reconnects | health-check pinger, retry on the client |
| Ephemeral filesystem | container writes vanish on redeploy | keep state in MongoDB only |
| One dyno / free DB | no horizontal scaling, low connection count | keep `MONGODB_URI` pooling default; single instance is assumed |
| No persistent WebSocket peers | live alerts drop on restart | dashboard falls back to polling on reconnect |
| Outbound request timeouts | gateway calls must stay short | `GATEWAY_TIMEOUT_MS` (default 60 s) |
| Shared/sleeping DB | cold connections fail intermittently | `/ready` returns 503 instead of serving errors |

Detailed gap backlog: [`PRODUCTION_GAP_ANALYSIS.md`](PRODUCTION_GAP_ANALYSIS.md).

## Known limitations

Stated openly because a reviewer will find them anyway:

- **Response inspection reports, it does not block or redact** responses.
- **The SSRF guard does not resolve DNS** — hostname-based bypasses are still
  possible until an egress policy exists.
- **Detection rules are duplicated** in the extension and the gateway, so they
  can drift.
- **Rate limiting and WebSocket tickets are per-process** — running two API
  instances breaks both.
- **No TLS interception, no SSO/SAML, no MFA, no secrets manager, no SIEM
  integration** — deliberately out of PoC scope.
- **Direct SDK/native traffic is not covered**: only requests routed through
  `/gateway/v1` are enforced.
- Free-tier deployment constraints are listed in the table above.

## Future production roadmap

1. **P0** — DNS-aware SSRF guard, token/session rotation, CI running the full
   suite on every push, WAF/rate limiting at the edge.
2. **P1** — shared rate-limit and WebSocket ticket store, response inspection
   that can block, managed secrets, centralised audit sink, schema/versioning
   policy.
3. **P2** — horizontal API scaling, enterprise SSO, MFA, SIEM export, blue/green
   deploys, observability beyond logs.

Priorities, effort, and rationale are tracked in
[`PRODUCTION_GAP_ANALYSIS.md`](PRODUCTION_GAP_ANALYSIS.md).

## Repository layout

```
backend/            Express API, policy engine, gateway, WebSocket, alerting
  src/app.js        CORS, rate limits, request IDs, health/readiness
  src/routes/       auth, events, gateway, users, analytics, settings, policies,
                    justifications, audit-log, platform-admin
  tests/            6 suites (43 baseline + 56 security/schema)
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
