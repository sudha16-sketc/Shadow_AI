# Phase 1 Security Review V3

## Scope

Re-evaluation of all 15 original properties after the Phase 1 blocker-closure pass. Evidence includes code-path analysis, Mongoose schema/index definitions, Vite build configuration validation, 23 passing mounted HTTP/WebSocket tests, and 3 passing extension config unit tests. The mounted tests use in-memory model fakes; real MongoDB index/migration behavior and real external secret rotation were not performed. This review does not claim actual external AI request prevention.

---

## Property Results

### 1. PASS — Tenant context is derived from server-authenticated identity.

JWT user tokens carry `tokenType: 'user'`, `userId`, `orgId`, and `authVersion`. Authentication middleware resolves the caller to a live active `User` and confirms the tenant's `Org.lifecycleStatus === 'active'`. The database role overrides any JWT role claim. Platform-admin tokens (`tokenType: 'platform_admin'`) resolve from a separate `PlatformAdmin` collection and cannot enter tenant routes. No route accepts a caller-supplied tenant identifier as authority.

### 2. PASS — Extension-supplied tenant identity cannot override trusted context.

Event payloads are validated with a strict Zod schema that rejects any `orgId`, `tenantId`, `organizationId`, or `fingerprint` field (400). Tenant context flows from the authenticated device's `orgId`. WebSocket tenant identity comes only from a consumed server-issued ticket. Platform-created tenant IDs are MongoDB-generated `ObjectId`s.

### 3. PASS — Extension-supplied user identity cannot override authenticated identity.

Event payloads reject `userId` (strict schema, 400). The event owner is resolved from the registered device record's `userId → orgId` relationship, not from any client-provided field.

### 4. PASS — Extension/client role and permissions cannot influence authorization.

Role is loaded from the active user's database record on every request. Platform-admin tokens require `tokenType: 'platform_admin'` and a live `PlatformAdmin` record; tenant user tokens cannot reach platform-admin routes (401). Device requests have a `'device'` principal with no administrative permissions.

### 5. PASS — Tenant-sensitive reads are tenant-scoped in reviewed routes.

User lists, user history, event lists/history, analytics joins, justifications/counts, audit logs/exports, settings, and score reads all use authenticated `orgId` as a required query filter. Tenants in `pending_admin` or `suspended` lifecycle fail authentication before reaching any data route.

### 6. PASS — Tenant-sensitive writes are tenant-scoped in reviewed routes.

User creation, update, deactivation, password reset, device enrollment/revocation, event ingestion, settings updates, justification writes, audit log entries, and score recalculation all derive and require trusted `orgId`. Platform tenant lifecycle changes require `platformAdminAuthMiddleware`; tenant-admin user writes are scoped by `orgId` extracted from authenticated JWT.

### 7. PASS — Cross-tenant access fails closed in reviewed paths.

Foreign user operations return non-disclosing 404. Cross-tenant `orgId` selection via query/body is rejected by `requireTenantAccess` (403). Suspended tenant users cannot authenticate. Tenant admin tokens cannot call platform provisioning routes (401). Tenant suspension closes all that tenant's WebSockets.

### 8. PASS — JWTs without required principal/tenant context are rejected.

- JWT startup configuration is mandatory; missing, short, whitespace-padded, or low-diversity secrets cause immediate process exit.
- Tenant tokens: require `tokenType: 'user'`, `userId`, `orgId`; validated against live `User` and `Org` records with current `authVersion`.
- Platform tokens: require `tokenType: 'platform_admin'`, `platformAdminId`; validated against live `PlatformAdmin` with current `authVersion`.
- Device credentials: opaque `dvc_*` prefix, looked up by `tokenHash` against active, non-revoked `Device` record with active owner and active org.

### 9. PASS — Event ingestion cannot forge a different tenant/user through client fields.

Only a registered active device (by opaque credential hash) may ingest events. Tenant and user context are resolved from the device's server-side record. Strict payload schema rejects any identity fields. Tests verify that a `{ orgId, userId, fingerprint }` in the event body returns 400 and no event is created.

### 10. PASS — Event schema rejects undeclared/malformed security-sensitive fields.

Zod `EventSchema` is `.strict()`; extra fields cause 400. Schema constrains: domain format, event type enum, risk score range, severity enum, masked preview length, finding label count/length, timestamp freshness (±10 minutes/−1 minute), and idempotency key length. Detection metadata is stored as `clientTelemetry` and cannot select the policy action.

### 11. PARTIAL — Semantic replay is bounded and context-scoped in code, but MongoDB index behavior is unverified against a real database.

- **Files / functions:** [`backend/src/utils/event-replay.js`](backend/src/utils/event-replay.js) `createEventFingerprint`; [`backend/src/routes/events.js`](backend/src/routes/events.js) `ingestEvent`; [`backend/src/models/index.js`](backend/src/models/index.js) `EventReplaySchema`; [`backend/src/server.js`](backend/src/server.js) index startup.
- **What is implemented:** SHA-256 fingerprint derived from trusted `orgId` + `deviceId` + normalized canonical event content (excluding client-provided timestamp/key). Two-minute bounded reservation. Unique compound index `{ orgId, deviceId, fingerprint }` serializes concurrent submissions. TTL index reclaims expired records. Same-key idempotency remains in a separate unique partial index. Different org/device scopes are independent.
- **What is unverified:** Real MongoDB unique index construction, concurrent insert rejection under actual write load, TTL index firing, and legacy index removal have not been exercised on a real database. The staging validator script exists (`npm run validate:mongodb-replay`) but has not been run in this environment.
- **Severity:** Moderate. If the index is not created at startup, concurrent changed-key submissions from the same device could both pass. Startup fails closed if index creation raises an error (other than index-not-found on the legacy drop).
- **Remediation:** Execute [`docs/PHASE_1_MONGODB_VALIDATION.md`](docs/PHASE_1_MONGODB_VALIDATION.md) against a backed-up staging clone before production onboarding.

### 12. PASS — Policy precedence fails closed for missing or invalid tenant policy.

`resolvePolicyDecision` accepts only `ALLOW`, `WARN`, `BLOCK`; any other value (including `undefined`, `null`, `'PERMIT'`, `'ALLOW '`) resolves to `{ action: 'BLOCK', reason: 'invalid_or_missing_policy' }`. Settings update API validates non-empty action and increments policy version. All three valid decisions and invalid/missing values are tested.

### 13. PARTIAL — Server policy decision fails closed; actual AI request enforcement is intentionally not implemented in Phase 1.

- **Files / functions:** [`backend/src/utils/event-policy.js`](backend/src/utils/event-policy.js) `resolvePolicyDecision`; [`backend/src/routes/events.js`](backend/src/routes/events.js) `processEvent`; [`shadow-extension/src/content.js`](shadow-extension/src/content.js) local detector/modal.
- **Issue:** The backend records a policy decision independently of client telemetry severity/risk score and always responds `requestPrevented: false`. The browser extension is user-controlled; a modified extension or alternative client bypasses the detection path entirely.
- **Architecture decision:** `policyDecision != requestPrevented`. This is explicitly preserved and documented. Any actual enforcement requires a separate Phase 2/product architecture decision (managed network control, proxy, MDM policy, or similar trusted enforcement point).
- **Severity:** High if the product makes an actual request-prevention promise; otherwise an acknowledged, documented product boundary.
- **No Phase 2 enforcement was started.**

### 14. PASS — Authentication/authorization behavior is not weakened in reviewed paths.

- Tenant user roles are server-loaded; JWT role claims do not grant authority.
- Platform-admin and tenant-admin credentials are kept in separate collections with separate middleware.
- Active status and auth version are checked on every request.
- Logout, password reset, role change, and deactivation revoke WebSockets and increment auth version, invalidating outstanding tokens.
- Device revocation immediately blocks further event submission.
- Public tenant signup returns 403; no self-service registration path exists.

### 15. PARTIAL — Known source literals removed; external credential rotation and history verification remain outstanding.

- **Files / procedures:** [`backend/src/config/security.js`](backend/src/config/security.js), [`backend/scripts/provision-platform-admin.mjs`](backend/scripts/provision-platform-admin.mjs), [`docs/PHASE_1_SECRET_ROTATION_CHECKLIST.md`](docs/PHASE_1_SECRET_ROTATION_CHECKLIST.md), repository Git history, external service providers.
- **What was done:** Hardcoded literal credentials removed from source; JWT startup validation fails on missing/weak secrets; `reset-password.mjs` requires all inputs from runtime environment; the local `.env` is `gitignore`d and was not inspected.
- **What remains:** JWT signing secret, MongoDB URI/credentials, SMTP credentials, Slack webhook URL, and previously exposed account password have not been rotated at external providers. Git history has not been reviewed or sanitized.
- **Severity:** Critical until rotation and history review are confirmed by operations.

---

## Additional Phase 1 Controls

### Platform Tenant Provisioning

Operator CLI (`npm run provision:platform-admin`) creates the first platform admin from environment-only inputs; no public bootstrap route. `POST /api/platform-admin/tenants` is platform-admin-only, generates all identifiers server-side, and creates a hashed 24-hour invitation. Acceptance is single-use, atomic, and transitions the tenant to `active`. Every provisioning action is recorded in `PlatformAuditLog`. Tenant-admin credentials cannot authenticate on platform routes; platform credentials cannot authenticate on tenant routes.

**Tested:** tenant creation, forged `orgId` rejection, one-use and expired invitation, suspension/reactivation, tenant-admin blocked from platform routes, viewer blocked from platform routes, platform token rejected on tenant routes.

### Extension Environment Configuration

Three explicit build modes (development/staging/production). Development defaults to localhost; staging/production require an explicit non-local HTTPS `VITE_API_URL` or the build fails. The built manifest's `host_permissions` are rewritten to match the configured API origin. Localhost permissions are stripped from non-development builds.

**Tested:** 8 unit tests covering all mode/URL combinations.

### WebSocket Deployment Constraint

The Phase 1 WebSocket ticket store is process-local. This is explicitly documented as a single-instance constraint. Tickets are 32-byte `base64url` opaque capabilities, 20-second lifetime, one-use, tenant/user-bound, and revocable. Multi-instance deployment is unsupported and will silently reject upgrade requests on processes that did not issue the ticket.

**Tested:** ticket reuse rejection, tenant-isolated broadcast, suspension revocation.

### MongoDB Migration Readiness

Startup: `autoIndex: false`; legacy `orgId_1_idempotencyKey_1` index dropped (error codes 26/27/IndexNotFound tolerated); then `createIndexes()` for all security-relevant collections before the HTTP listener opens. Startup fails closed if index creation encounters data conflicts. Legacy org documents without `lifecycleStatus` fail authentication.

**Validated in-code only.** Real database behavior requires the staging procedure.

### Secret Rotation Readiness

[`docs/PHASE_1_SECRET_ROTATION_CHECKLIST.md`](docs/PHASE_1_SECRET_ROTATION_CHECKLIST.md) covers JWT signing secret, MongoDB credentials, SMTP credentials, Slack webhook, previously exposed account password, platform-admin bootstrap password, device credentials, extension API origin, and other history/runtime credentials. Each entry includes: credential purpose, expected runtime location, rotation action, session/token invalidation, verification step, and rollback consideration. No credential is claimed rotated. The execution record requires operations owner sign-off.

### Request Enforcement Boundary

`policyDecision != requestPrevented` is a documented design boundary, not a gap. The backend accurately reports that it does not prevent the external AI request. The stored decision is an audit record. This requires no Phase 1 code change; Phase 2 architecture owns actual enforcement.

---

## Test and Build Evidence

| Check | Result |
|---|---|
| `npm test --runInBand` (backend) | ✅ PASS — 2 suites, 23 tests |
| `node --check` over all backend `src/` + `tests/` + `scripts/` | ✅ PASS — 20+ files, no syntax errors |
| `npm run build` (frontend) | ✅ PASS (pre-existing large-chunk/Browserslist warnings) |
| `npm run build:development` (extension) | ✅ PASS |
| `node --test tests/build-config.test.js` (extension) | ✅ PASS — 3 tests |
| `npm run lint` (extension) | ❌ 32 pre-existing errors (Chrome globals, regex escapes, empty catch) — no regression |
| `git diff --check` | N/A — no git repository in this environment |
| Real MongoDB staging validation | ❌ NOT RUN — Docker daemon unavailable; procedure documented |

---

## Remaining Blockers

1. **External credential rotation not performed** — JWT, MongoDB, SMTP, webhook, previously exposed account password require operations rotation and provider-side invalidation.
2. **Git history review not performed** — may contain credentials in old commits; requires approved history review and sanitization per repository governance.
3. **Real MongoDB staging validation not run** — unique/TTL index creation, concurrent insert behavior, TTL cleanup, and legacy index removal must be verified on a backed-up staging clone.
4. **Legacy org lifecycle migration not performed** — existing `Org` documents without `lifecycleStatus` fail authentication under the new model; verified tenants require deliberate activation by operations/data owners.
5. **Platform-admin first-user bootstrap not run in production** — `npm run provision:platform-admin` must be run with secure environment-injected credentials before tenants can be provisioned.
6. **WebSocket is single-instance only** — do not deploy multiple API instances until shared ticket storage is designed, implemented, and validated.
7. **Actual AI request enforcement is a Phase 2 / product decision** — not implemented, not claimed.

---

## PHASE 1 SECURITY GATE

**SECURITY PASS WITH REMEDIATION REQUIRED**

All repository-solvable Phase 1 security blockers are implemented and tested. Production onboarding is gated on external credential rotation (operations), real staging MongoDB validation (operations), and legacy tenant migration (operations/data review). Phase 2 was not started.
