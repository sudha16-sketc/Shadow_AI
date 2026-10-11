# Architecture

Structure, trust boundaries, and data flow for the Shadow AI Auditor PoC.
Companion documents: `PROJECT_OVERVIEW.md` (what it is), `SECURITY_FEATURES.md`
(how it is defended), `docs/history/` (earlier phase designs).

---

## 1. Topology

```
                    ┌──────────────────────────────────────────┐
   Employee         │  Chrome extension (MV3)                  │
   browser          │  content.js  ── detection, warning modal │
                    │  background.js ── session, batching, badge│
                    │  popup.js ── pairing, opt-out, stats     │
                    └───────┬──────────────────────┬───────────┘
                            │                      │
              masked event reports          proxied prompts
                            │                      │
                            ▼                      ▼
                    POST /api/events        POST /gateway/v1/:provider/*
                            │                      │
   ┌─────────────────────────┴──────────────────────┴───────────────────┐
   │  backend (Express, single instance)                                │
   │                                                                    │
   │  auth middleware ── JWT / device credential ── tenant + role        │
   │  policy engine   ── ALLOW | WARN | SANITIZE | BLOCK                │
   │  gateway         ── header allowlist, sanitise, upstream timeout   │
   │  websocket       ── single-use tickets, tenant-scoped broadcast    │
   │  alerting        ── Slack webhook (SSRF-guarded) + SMTP            │
   └───────────────┬────────────────────────────────┬───────────────────┘
                   │                                │
             MongoDB 7                        AI provider API
           (single tenant database)          (allowlisted origins)
                   ▲
                   │
        React dashboard (nginx + CSP)
```

Deployment is a single host: `docker compose up` runs `mongo`, `backend`,
`frontend`. There is no message queue, cache, or shared state — see
`PRODUCTION_GAP_ANALYSIS.md` for what that costs.

## 2. Trust boundaries

| # | Boundary | Crossing | Control |
|---|---|---|---|
| 1 | Page → content script | DOM text | Local detection only; raw text is never logged or uploaded |
| 2 | Extension → API | HTTP requests | Device credential (`dvc_…`) or user JWT; CORS allowlist; `chrome-extension://[a-p]{32}` origin accepted |
| 3 | Client → gateway | Prompt body | Body is untrusted input: server-side detection, policy decision, optional sanitisation, then upstream call |
| 4 | Backend → AI provider | Upstream request | Fixed origins (`api.openai.com`, `api.anthropic.com`), path validation, request header allowlist, timeout, no redirects |
| 5 | AI provider → client | Upstream response | Response header allowlist, response content inspection, finding count header |
| 6 | Dashboard → API | Credentialed REST | JWT, role checks, tenant scoping on every query |
| 7 | Backend → Slack/SMTP | Outbound webhook | `https:` only, private/loopback/metadata hosts rejected (`src/utils/url-guard.js`) |
| 8 | Anonymous → API | Rate limits | Per-route limiters for auth, events, policies, platform admin, gateway |

Anything not explicitly listed as allowed at a boundary is dropped.

## 3. Request paths

### 3.1 Report-only telemetry

```
content.js detects findings
  → background.js queues and batches
  → POST /api/events  (device credential)
  → server re-analyses the reported preview, scores it, stores Event
  → AuditLog entry, alert on HIGH/CRITICAL, WebSocket broadcast
```

`policyDecision` on these events records what *would* happen; it never blocks.

### 3.2 Enforcing gateway

```
extension → POST /gateway/v1/openai/v1/chat/completions
  1. authMiddleware       → req.user (tenant, user, device), req.authUser
  2. provider allowlist   → openai | anthropic, safe path, JSON object body
  3. org lookup           → must exist and be lifecycleStatus=active
  4. server detection     → analyzeText(extracted prompt) → findingLabels
  5. evaluatePolicy       → decision, riskScore, severity, policyVersion
  6. decision:
       BLOCK     → 403, Event(enforcementStatus=PREVENTED), upstream never called
       SANITIZE  → redact pattern matches, Event(SANITIZED, sanitizedRedactions)
       ALLOW/WARN→ forward
  7. upstream call        → allowlisted headers, timeout, redirect=error
  8. response inspection  → detect findings in provider output, audit, header
  9. Event + AuditLog written, response relayed
```

Server-computed fields (tenant, user, severity, decision, enforcement) are
written from the credential and the policy engine only; client-supplied claims
in the body are ignored. This is asserted by
`gateway trusts only server-side decisions` in
`backend/tests/security-regression.test.js`.

### 3.3 Real-time alerts

```
dashboard → POST /api/auth/ws-ticket (JWT, admin/manager)
          → { ticket, expiresAt }     single use, 20s TTL, tenant bound
ws://…/api/alerts?ticket=…            consumed once, then deleted
          → tenant-scoped broadcast of HIGH/CRITICAL events
```

Tickets live in process memory: single-instance only.

## 4. Identity model

| Credential | Issued to | Scope | Notes |
|---|---|---|---|
| User JWT (`tokenType: user`) | dashboard user | org + user + `authVersion` | 7d, HS256, revoked by bumping `authVersion` |
| Device credential (`dvc_…`) | extension after pairing | device + owner user | stored as a hash; revocable per device |
| Platform admin JWT (`tokenType: platform_admin`) | operator | platform | 15m access token, separate collection |
| WebSocket ticket | dashboard session | one user, one org, 20s | consumed once |

`JWT_SECRET` is mandatory at startup: `backend/src/config/security.js` rejects
values shorter than 48 bytes or with fewer than 16 distinct characters.

Roles inside a tenant: `admin`, `manager`, `viewer`. Platform administration is
a separate plane (`/api/platform-admin/*`) that creates tenants and issues
single-use invitation tokens; there is no self-service signup.

## 5. Data model (MongoDB)

| Collection | Purpose | Notable fields |
|---|---|---|
| `orgs` | Tenant + its default policy | `settings.defaultAction`, `settings.blockOnHigh`, `monitoredDomains`, `slackWebhookUrl`, `lifecycleStatus` |
| `users` | Tenant users | `role`, `authVersion`, `passwordHash`, `extensionUserId` |
| `teams` | Group scoping | used by `scope: GROUP` policies |
| `devices` | Paired extensions | `tokenHash`, `isActive`, `revokedAt`, `lastSeenAt` |
| `policies` | Overrides | `scope` (TENANT/USER/GROUP), `targetId`, `rules[]`, `action`, `precedence`, `status` |
| `events` | Detections and gateway decisions | `findingLabels`, `riskScore`, `severity`, `policyDecision/Reason/Version`, `enforcementStatus`, `requestForwarded`, `upstreamStatus`, `sanitizedRedactions`, `responseFindingLabels`, `clientTelemetry` |
| `eventreplays` | Replay/idempotency guard | semantic key per device+org, 2-minute reservation |
| `justifications` | User-accepted warnings | reviewer, status, reason |
| `auditlogs` | Admin/manager actions + gateway response findings | actor, target, changes, ip, userAgent |
| `platformadmins`, `tenantinvitations`, `platformauditlogs` | Platform plane | invitation tokens are single-use, 24h |

Multi-tenant isolation is enforced by scoping **every** query to
`req.user.orgId`, plus `requireTenantAccess` which rejects a request that names
a different `orgId` in params, query, or body.

### 5.1 Schema Versioning & Migration Strategy

For this PoC and collaborating-team deployments, schema evolution follows an additive, backward-compatible model without heavyweight migration frameworks:

1. **Schema Version Tracking & Contract Guarantees:**
   - Schemas managing active business rules carry integer versions (e.g. `Org.policyVersion`, `Policy.version`, and `Event.policyVersion`).
   - Every selectable API action and severity level is strictly verified against database enum constraints at test time via contract tests (`backend/tests/schema-contract.test.js`), preventing silent deserialization or storage errors.

2. **Index Lifecycle & Startup Synchronization:**
   - Mongoose automatic index creation is explicitly disabled (`autoIndex: false`) in `startServer()` (`backend/src/server.js`) to eliminate unpredictable index build blocking in multi-instance or high-throughput scenarios.
   - Declarative indexes (including TTL indexes on `events`/`eventreplays` and sparse compound unique indexes on idempotency keys) are synced synchronously upon startup via `Model.createIndexes()`.
   - Legacy or superseded index names are safely dropped with defensive error code handling (`IndexNotFound`, `NamespaceNotFound`) before applying new indexes.

3. **Additive-Only Evolution & Backward Compatibility (Expand/Contract):**
   - **Phase 1 (Expand):** New attributes are introduced with sensible Mongoose schema defaults (e.g. `sanitizedRedactions: { type: Number, default: 0 }`, `responseFindingLabels: { type: [String], default: [] }`). Application code is designed to read documents where new fields may be omitted, treating missing keys as default values.
   - **Phase 2 (Migrate/Dual-Write):** If data restructuring is required, application code writes to both old and new shapes, reading from the new shape with fallback to the old.
   - **Phase 3 (Contract):** Old fields are deprecated only after an agreed version deprecation window, without breaking running instances.

4. **Rollback & Failure Handling:**
   - In the event of a deployment failure or rollback to an older backend revision, additive fields in MongoDB 7 documents are ignored by older Mongoose schemas without fatal validation errors.
   - Database rollbacks do not require destructive rollbacks of document contents; schema backward-compatibility ensures the prior backend version continues to function safely.

5. **Deployment Sequencing:**
   - The deployment sequence is strictly: **Database Online → Startup Schema & Index Sync → Traffic Ingestion**.
   - The `/ready` probe gates external traffic until MongoDB is connected and initial index lifecycle operations are complete.

## 6. Detection and scoring

Two copies of the pattern set exist by design:

- `shadow-extension/src/content.js` (+ `detectionEngine.js`) — fast, local,
  decides whether to warn the user.
- `backend/src/routes/gateway.js` — authoritative copy used for stored events,
  policy evaluation, sanitisation, and response inspection.

Kept deliberately: the extension copy must run without network, the server copy
must not depend on anything the browser sends. The duplication is documented as
a known maintenance cost (`PRODUCTION_GAP_ANALYSIS.md`); a shared package is a
post-PoC refactor, not a security gap, because the server copy is the one that
decides enforcement.

Scoring: each label maps to a category (`API_KEY`, `PII`, `PASSWORD`,
`PROPRIETARY`) and a base score. Risk = max base score + 2 per extra finding,
capped at 100. Severity thresholds: ≥90 CRITICAL, ≥70 HIGH, ≥40 MEDIUM.

## 7. Enforcement decisions

`evaluatePolicy` returns `decision`, `reason`, `riskScore`, `severity`,
`policyVersion`:

1. Missing/invalid `settings.defaultAction` → `BLOCK` (fail closed,
   reason `invalid_or_missing_policy`).
2. No findings → tenant default action.
3. Matching `TENANT`/`USER`/`GROUP` policy rule (precedence descending) wins.
4. Otherwise `settings.blockOnHigh` may upgrade to `BLOCK`.
5. Any evaluation error → `BLOCK` (reason `policy_evaluation_error`).

## 8. Frontend

React Router pages: Hero (landing), Signup (invite acceptance), Overview,
Events, Analytics, Users, Justifications, AuditLog, Settings. Auth state is a
Zustand store; API base comes from `VITE_API_URL` baked in at build time.

The nginx config (`frontend/nginx.conf`) is an envsubst template: it injects
CSP, frame, MIME, referrer, and permissions headers, and takes `API_ORIGIN` for
`connect-src` so the dashboard can only talk to the configured backend.

## 9. Configuration

Runtime configuration is environment-only. Templates: `.env.example`,
`backend/.env.example`, `shadow-extension/.env.<mode>.example`. No secret is
read from source, and none is present in git history (verified — see
`SECURITY_TEST_REPORT.md`).
