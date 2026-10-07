# Project Overview — Shadow AI Auditor

A tenant-scoped proof of concept that detects, records, and — through the proxy
gateway — prevents sensitive data being sent to public AI tools.

It is built for one evaluation question: *can a small team ship AI data-loss
control that a security reviewer would believe?* Everything in this repository
is scoped to that question. It is **not** an enterprise SaaS platform.

---

## 1. What the product does

| Capability | How it is delivered |
|---|---|
| Detect sensitive content in AI prompts | Browser extension runs a local detection engine on paste/typing/submit events in supported AI sites |
| Record detections as auditable events | Extension reports masked metadata to `POST /api/events`; server re-analyses, scores, and stores an `Event` |
| Enforce policy on the request itself | Chrome extension routes prompts through `POST /gateway/v1/:provider/*`, which evaluates policy **server side** before any upstream call |
| Give analysts an answer | React dashboard: overview score, event log, analytics, users, justifications, audit log, settings |
| Alert in real time | WebSocket push to open dashboard tabs + Slack webhook + SMTP email |

Two paths, deliberately separated:

```
 report-only path      extension  ──►  /api/events      ──►  Event + audit
 enforcing path        extension  ──►  /gateway/v1/...  ──►  ALLOW | WARN | SANITIZE | BLOCK
```

The gateway is the enforcement boundary. `/api/events` never blocks anything; it
exists so that the report-only path (opted-out users, non-proxied AI sites) still
produces a complete audit trail.

## 2. Who it is for

- **A potential collaborating company** evaluating engineering and security
  maturity — hence the evidence-driven test suite and gap analysis.
- **A tenant security admin** who needs to know what left the browser, what was
  blocked, and why.
- **An employee** who gets an in-page warning before pasting a credential, with
  an opt-out that is honoured locally.

## 3. Components

```
shadow-extension/   Chrome MV3 extension: content script, service worker, popup
frontend/           React + Vite + Tailwind dashboard, served by nginx in Docker
backend/            Express API, policy engine, gateway, WebSocket, alerting
*.md (root)         project, architecture, and security documentation
docs/history/       superseded phase plans and reports (kept for traceability)
docker-compose.yml  mongo + backend + frontend
```

Language/runtime: Node.js 20+ (CommonJS-free ESM), MongoDB 7, React 18.

## 4. Current state

| Area | State |
|---|---|
| Backend tests | **99 passing** (6 suites, `cd backend && npm test`) |
| Extension tests | **10 passing** (`cd shadow-extension && npm run test:config`) |
| Backend lint | no ESLint config (not configured — see `PRODUCTION_GAP_ANALYSIS.md`) |
| Frontend lint | `npm run lint` — 0 errors, 9 warnings |
| Extension lint | `npm run lint` — clean |
| Builds | `frontend` `npm run build`, `shadow-extension` `npm run build:development` |
| Database | not required for tests (in-memory model doubles) |
| Deployment | `docker compose up` on a single host |

Security-relevant behaviour is documented in `SECURITY_FEATURES.md`, proven by
`SECURITY_TEST_PLAN.md` / `SECURITY_TEST_REPORT.md`, and its known limits are
listed in `PRODUCTION_GAP_ANALYSIS.md`.

## 5. Explicit non-goals

Out of scope for this PoC, by decision:

Kubernetes · microservices · SSO/SAML/OIDC · MFA · TLS interception ·
enterprise SIEM integration · Redis or shared ticket storage · secrets manager
integration · large dashboard redesign.

These are recorded as gaps rather than half-built, because a partial
implementation would be worse than none during an evaluation.

## 6. Repository map

| Path | Purpose |
|---|---|
| `backend/src/app.js` | Express wiring: CORS allowlist, rate limits, request IDs, health/readiness |
| `backend/src/routes/gateway.js` | Policy enforcement, sanitisation, upstream proxy |
| `backend/src/services/policy-engine.js` | Server-authoritative decision logic |
| `backend/src/middleware/auth.js` | JWT / device credential verification, tenant + role checks |
| `backend/tests/` | 6 suites: 43 pre-existing + 56 security/schema contract |
| `shadow-extension/src/content.js` | Detection, warnings, submit interception |
| `frontend/src/pages/` | Overview, Events, Analytics, Users, Justifications, AuditLog, Settings |
| `PROJECT_OVERVIEW.md` | This file |
| `ARCHITECTURE.md` | Structure, trust boundaries, data model |
| `WORKFLOW.md` | Day-to-day development, testing, release workflow |
| `SECURITY_FEATURES.md` | Control-by-control description |
| `SECURITY_TEST_PLAN.md` | Test matrix |
| `SECURITY_TEST_REPORT.md` | Executed results with commands |
| `PRODUCTION_GAP_ANALYSIS.md` | What is still missing before real use |
| `DEMO_GUIDE.md` | 15-minute scripted demonstration |
| `docs/history/` | Superseded phase documents |

## 7. Quick start

```bash
# 1. environment
cp .env.example .env && cp backend/.env.example backend/.env   # then fill in

# 2. database
docker run -d -p 27017:27017 --name mongo mongo:7

# 3. API
cd backend && npm install && npm run dev          # http://localhost:3001

# 4. dashboard
cd frontend && npm install && npm run dev         # http://localhost:5173

# 5. extension
cd shadow-extension && npm ci && npm run build:development
# chrome://extensions → Developer mode → Load unpacked → shadow-extension/dist
```

Provisioning (there is no self-service signup) and the demo script are in
`WORKFLOW.md` and `DEMO_GUIDE.md`.
