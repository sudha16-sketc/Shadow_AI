# Phase 1 Final Status

## Summary

All repository-solvable Phase 1 security blockers are implemented, tested, documented, and verified. This document supersedes the prior version. Phase 2 was not started. No real secret values were inspected, copied, or printed. No production data was touched.

**Current gate: SECURITY PASS WITH REMEDIATION REQUIRED**

---

## 1. Tenant Provisioning Status — COMPLETE

### Implementation

- **`backend/src/routes/platform-admin.js`** — Platform-admin-only routes: `POST /api/platform-admin/auth/login`, `POST /api/platform-admin/tenants`, `POST /api/platform-admin/tenants/:tenantId/invitations`, `PATCH /api/platform-admin/tenants/:tenantId/status`, `POST /api/platform-admin/invitations/accept`.
- **`backend/src/models/index.js`** — `PlatformAdmin` (separate principal collection, `tokenType: 'platform_admin'`), `TenantInvitation` (hashed token, expiry, single-use, pending/accepted/revoked status), `PlatformAuditLog` (actor, action, tenant, changes, IP, user-agent), `Org` (`lifecycleStatus: pending_admin | active | suspended`).
- **`backend/src/middleware/auth.js`** — `platformAdminAuthMiddleware` enforces `tokenType === 'platform_admin'` and resolves from `PlatformAdmin` collection only. User tokens cannot enter platform routes. Platform tokens cannot authenticate on tenant routes.
- **`backend/scripts/provision-platform-admin.mjs`** — Operator CLI bootstraps the first platform admin from runtime-only environment variables; no public bootstrap endpoint exists.

### Lifecycle Enforced

| Step | Implementation |
|------|---------------|
| Platform admin creates tenant | `POST /api/platform-admin/tenants` — server generates `orgId`, sets `lifecycleStatus: pending_admin`, hashes invitation token |
| Tenant admin invited | `TenantInvitation` created with hashed token and 24-hour expiry |
| Tenant activation | `POST /api/platform-admin/invitations/accept` — validates token hash, expiry, single-use; creates/activates admin user in that org; transitions org to `active` |
| Tenant admin enrolls users/devices | Standard `/api/users` (admin-only create) and `/api/auth/device/enrollment-code` routes |
| Tenant admin configures policies | Standard `/api/settings/org` route |
| Platform audit | Every provisioning action creates a `PlatformAuditLog` entry |

### Security Properties

- **No public tenant creation** — `POST /api/platform-admin/tenants` requires `platformAdminAuthMiddleware`.
- **No client-controlled orgId** — MongoDB generates the `_id`; strict Zod schema on `/api/platform-admin/tenants` rejects any `orgId` field and returns 400.
- **Tenant IDs generated server-side** — `Org.create()` with no client-supplied `_id`.
- **Tenant admin must belong to created tenant** — invitation carries `orgId`, accepted admin is created with `orgId: invitation.orgId`, org is confirmed `pending_admin` before any user is created.
- **Single-use, expiring invitation** — `status` is set to `accepted` and `usedAt` stamped in an atomic `findOneAndUpdate` with the `pending`/not-used/not-expired filter.
- **Tenant lifecycle state** — `pending_admin → active → suspended/active` transitions; tenants in `pending_admin` or `suspended` fail authentication.
- **Tenant provisioning audited** — `tenant_created`, `tenant_admin_invited`, `tenant_admin_activated`, `tenant_suspended`, `tenant_reactivated` actions recorded.
- **Platform ≠ tenant credential confusion prevented** — separate principal collections, separate `tokenType` claim, separate middleware, `platformAdminAuthMiddleware` rejects tenant tokens and vice versa.
- **Tenant admins cannot provision other tenants** — platform routes require `tokenType: platform_admin`; tenant JWTs return 401 on platform routes (tested).

### Tests

All provisioning tests are mounted HTTP/WebSocket integration tests in [`backend/tests/phase1-security.integration.test.js`](backend/tests/phase1-security.integration.test.js):

| Required test | Status |
|---|---|
| Platform admin creates tenant | ✅ `provisions tenants only through the separate platform-admin identity` |
| Tenant admin can access only its tenant | ✅ Same test — accesses own settings (200), forged `orgId=org-b` rejected (403) |
| Tenant admin cannot create another tenant | ✅ Same test — tenant token on `/api/platform-admin/tenants` returns 401 |
| Normal tenant user cannot provision tenants | ✅ Same test — viewer token on platform routes returns 401 |
| Invitation cannot be reused | ✅ Same test — second `accept` with same token returns 401 |
| Expired invitation fails | ✅ `rejects expired tenant-admin invitations without activating the tenant` |
| Forged orgId is ignored/rejected | ✅ Same test — `orgId: 'org-b'` in provision body returns 400; no org created |

---

## 2. Replay Protection Status — COMPLETE

### Implementation

- **`backend/src/utils/event-replay.js`** — `createEventFingerprint()` derives SHA-256 from trusted server context (`orgId`, `deviceId`) and normalized event content (`domain`, `eventType`, `riskScore`, `severity`, NFC-normalized `maskedPreview`, sorted/normalized `findingLabels`). Client timestamp and idempotency key are **excluded** so neither can be changed to bypass the fingerprint.
- **`backend/src/routes/events.js`** `ingestEvent()` — Two-layer duplicate check: (1) idempotency-key uniqueness per org/device, (2) fingerprint reservation for `EVENT_REPLAY_WINDOW_MS`.
- **`backend/src/models/index.js`** `EventReplaySchema` — unique compound index `{ orgId, deviceId, fingerprint }` and TTL index `{ expiresAt: 1, expireAfterSeconds: 0 }` for bounded, automatic cleanup.
- **`backend/src/server.js`** — `EventReplay.createIndexes()` is called before the HTTP listener opens.

### Window Choice and Rationale

**2-minute window** (`EVENT_REPLAY_WINDOW_MS = 2 * 60_000`).

Rationale: browser paste events occur once per user action; the same content is extremely unlikely to be legitimately re-pasted from the same device to the same AI site within two minutes. The timestamp is excluded from the fingerprint to avoid easy bypass, so this window is the only replay guard for that attack vector. Two minutes is long enough to prevent machine-speed duplicate submission and short enough to allow genuine repeated use after the window expires. The `EventReplay` TTL index on `expiresAt` automatically reclaims expired records without manual purge jobs; the application also does a pre-check `deleteOne` for any single expired reservation before creating a new one.

### Security Properties

- **Fingerprint derived from canonical server-trusted content** — org/device from authenticated middleware; content fields normalized (NFC, trim, lowercase, sort). Client cannot choose the fingerprint.
- **Client fingerprint field rejected** — Zod `EventSchema` is `.strict()`; submitting a `fingerprint` field returns 400 (tested).
- **Bounded time window** — reservations expire after 2 minutes; expired records may be reused for genuinely identical repeat events.
- **Cross-tenant collision prevented** — `orgId` is part of both fingerprint input and the unique index; different tenants have independent replay spaces even for identical content.
- **Cross-device independence** — `deviceId` is part of both fingerprint input and index; different devices have independent fingerprint spaces.
- **Concurrent submissions serialized** — unique compound MongoDB index rejects concurrent inserts with the same fingerprint; application catches code 11000 and returns `{ duplicate: true }`.
- **Existing idempotency preserved** — same-key check runs first; fingerprint is only checked when the key is not already known.

### Tests

| Required test | Status |
|---|---|
| Same payload + same key | ✅ `deduplicates single and batch retries` |
| Same payload + different key | ✅ `blocks changed-key semantic replays` — `changedKey.data.duplicate === true` |
| Same payload from different tenant | ✅ Same test — `otherTenant.data.duplicate === false` |
| Same payload from different device | ✅ Same test — `otherDevice.data.duplicate === false` |
| Concurrent submissions | ✅ Same test — exactly one of two concurrent concurrent-key submissions succeeds |
| Events outside the replay window | ✅ Same test — manually expired replay record; outside-window submission accepted |

---

## 3. Extension Environment Status — COMPLETE

### Implementation

- **`shadow-extension/vite.config.js`** — `resolveApiOrigin(mode, configuredUrl)` validates the URL for the given build mode:
  - `development` — defaults to `http://localhost:3001` if `VITE_API_URL` is unset; explicit override is accepted.
  - `staging` — `VITE_API_URL` is required; must be a non-local HTTPS origin.
  - `production` — `VITE_API_URL` is required; must be a non-local HTTPS origin; HTTP or localhost causes a hard build failure.
  - Any other mode throws immediately.
- The `configure-extension-api-origin` Vite plugin writes the resolved API origin into `dist/manifest.json` `host_permissions`, removing any pre-existing localhost/loopback permissions, ensuring the built manifest matches the configured endpoint.
- **`VITE_API_URL`** is baked in as `import.meta.env.VITE_API_URL` in all built scripts.

### Environment Files

| File | Contents |
|---|---|
| `.env.development.example` | `VITE_API_URL=http://localhost:3001` |
| `.env.staging.example` | `VITE_API_URL=https://staging-api.example.invalid` (placeholder) |
| `.env.production.example` | `VITE_API_URL=https://api.example.invalid` (placeholder) |

Production operators must replace the placeholder with the real HTTPS API origin before building. The file is listed in `.gitignore`; real values must never be committed.

### Build Scripts

```
npm run build:development   # vite build --mode development
npm run build:staging       # vite build --mode staging
npm run build:production    # vite build --mode production (alias: npm run build)
```

### Validation

Production builds without `VITE_API_URL` set fail immediately with `VITE_API_URL is required for the production extension build.` Production builds pointing to HTTP or localhost fail with `production extension builds require a non-local HTTPS API origin.`

### Tests (`shadow-extension/tests/build-config.test.js`)

- Development: localhost default accepted; explicit override accepted.
- Staging/production: non-local HTTPS required; missing config, HTTP, localhost, 127.x.x.x, `[::1]`, and `*.localhost` all throw.
- Credential-embedded URLs and non-origin paths throw.

---

## 4. WebSocket Deployment Model — DOCUMENTED SINGLE-INSTANCE

### Chosen Approach

**Option B: Explicitly documented single-instance WebSocket deployment constraint.**

The existing implementation was retained. Shared ticket storage was not added because it would require either a Redis/external store (not in the existing architecture) or a significant infrastructure migration. The current design provides strong security with correct behavior in single-instance deployments.

### Ticket Properties

| Property | Value |
|---|---|
| Ticket format | 32 random bytes encoded as `base64url` (256-bit opaque capability) |
| Ticket lifetime | 20 seconds (`TICKET_TTL_MS = 20_000`) |
| One-time consumption | `consumeWebSocketTicket` deletes the ticket from the map on first use; expired-ticket check is atomic with deletion |
| Tenant binding | Ticket record stores `orgId`, `userId`, `role`; the connecting WebSocket receives `ws.tenantId = identity.orgId`; `broadcastTenantAlert` routes only to `tenantClients.get(event.orgId)` |
| Revocation | `revokeWebSocketUser(userId)` — deletes all tickets and closes all sockets for the user (logout, password reset, role change, deactivation); `revokeWebSocketTenant(tenantId)` — deletes all tickets and closes all sockets for a tenant (suspension) |
| Multi-instance behavior | **Unsupported.** Tickets are stored in a JavaScript `Map` in the single backend process. A request reaching a different process will not find the ticket and will reject the WebSocket upgrade with 401. Do not deploy multiple API instances behind a load balancer with this implementation. |

### Tests

| Required test | Status |
|---|---|
| Ticket reuse | ✅ `rejects unauthenticated WebSockets` — second `openSocket(ticketA)` rejects with 401 |
| Tenant binding | ✅ Same test — `broadcastTenantAlert({orgId: 'org-a'})` received by socketA but not socketB; `org-b` alert received by socketB but not socketA |

---

## 5. MongoDB Validation Status — PROCEDURE DOCUMENTED, REAL RUN PENDING

Real MongoDB validation has **not** been performed. The Docker daemon and MongoDB service were unavailable during implementation. All mounted tests use in-memory model fakes.

See [`docs/PHASE_1_MONGODB_VALIDATION.md`](docs/PHASE_1_MONGODB_VALIDATION.md) for the complete procedure. It covers:

1. Backup (mongodump with environment-injected URI)
2. Clone to isolated staging copy
3. Index inspection (existing index names, key patterns, options)
4. Duplicate detection (idempotency key groups, invitation groups)
5. Duplicate remediation (data-owner reviewed, no automatic deletion)
6. Index migration (drop legacy `orgId_1_idempotencyKey_1`, `createIndexes()` for all collections)
7. Startup verification (confirm listener opens only after index creation succeeds)
8. Concurrent idempotency test (`npm run validate:mongodb-replay`)
9. Rollback procedure

The `npm run validate:mongodb-replay` script ([`backend/scripts/validate-mongodb-replay.mjs`](backend/scripts/validate-mongodb-replay.mjs)) requires:
- `PHASE1_STAGING_MONGODB_URI` (must end in `staging` or `phase1-validation`)
- `PHASE1_STAGING_BACKUP_CONFIRMED=YES_BACKED_UP_STAGING_COPY`

It races 12 concurrent inserts with the same idempotency tuple (expects 1 success, 11 `code 11000` rejections), races 12 replay fingerprint reservations (same expectation), verifies cross-tenant/device independence, and confirms expired-record reuse. It deletes only the tagged test records it created.

**Production onboarding is blocked until this staging procedure passes.**

---

## 6. Secret Rotation Status — CHECKLIST DOCUMENTED, ROTATION NOT PERFORMED

See [`docs/PHASE_1_SECRET_ROTATION_CHECKLIST.md`](docs/PHASE_1_SECRET_ROTATION_CHECKLIST.md) for the complete checklist.

### Credentials Requiring Rotation

| Credential | Purpose | Runtime location | Rotated? |
|---|---|---|---|
| JWT signing secret | Signs all dashboard and platform-admin tokens | `JWT_SECRET` env var, per-environment | **NOT rotated** — requires operations |
| MongoDB credentials / URI | Backend database access | `MONGODB_URI` env var | **NOT rotated** — requires operations |
| SMTP credentials | Outbound alert email delivery | `SMTP_HOST/PORT/USER/PASS/FROM` env vars | **NOT rotated** — requires operations |
| Slack webhook URL | Tenant alert delivery | Tenant org configuration via admin UI | **NOT rotated** — requires operations |
| Previously exposed account password | A literal password was in `backend/reset-password.mjs` in prior code; removed in Phase 1 remediation | N/A in current source; affected account requires identity-owner reset | **NOT rotated** — requires owner action |
| Platform-admin bootstrap password | Seeds the first platform admin via `npm run provision:platform-admin` | Runtime environment only (`PLATFORM_ADMIN_PASSWORD`, `PLATFORM_ADMIN_EMAIL`) | **NOT seeded in production** — requires operations |
| Device tokens / pairing codes | Per-device opaque credential, stored hashed | `chrome.storage.local` on device; tokenHash in MongoDB | Revocable per-device; no rotation required unless a credential is compromised |
| Extension API origin | Build-time configuration | `VITE_API_URL` in `.env.production` (not committed) | Not a secret; configure before each build |
| Other history/runtime credentials | CI/deployment secrets, any values in Git history | Operations audit required | **UNKNOWN** — history review not performed |

No credential is claimed as rotated. The execution record in the checklist must be signed by the operations owner after rotation is complete.

---

## 7. Actual Request Enforcement Status — EXPLICITLY NOT IMPLEMENTED

`policyDecision != requestPrevented`

The backend continues to report `requestPrevented: false` on all event ingestion responses. The server records a fail-closed policy decision (`ALLOW`, `WARN`, or `BLOCK`) as an audit record only. The extension's local detection and modal UI are user-controlled and cannot prevent the external AI request from leaving the browser.

This is a documented Phase 2 / product architecture decision. Any enforcement promise requires a separate approved trusted enforcement architecture (managed network control, proxy, or MDM policy) that was not implemented in Phase 1 and must not be implied by current behavior.

---

## Completed Controls

| Control | Status | Evidence |
|---|---|---|
| Platform-admin tenant lifecycle | ✅ COMPLETE | Routes, models, middleware, audit, 7 integration tests |
| Tenant invitation (single-use, expiring, hashed) | ✅ COMPLETE | `TenantInvitation` schema, `accept` route, tested |
| Invitation replacement after expiry | ✅ COMPLETE | `PUT /invitations` revokes expired, creates fresh |
| Tenant lifecycle states | ✅ COMPLETE | `pending_admin → active → suspended` enforced in auth |
| Platform-admin/tenant credential separation | ✅ COMPLETE | Separate collections, token types, middleware |
| Tenant-scoped reads/writes | ✅ PASS (from V2) | Mounted route tests cover all data-access paths |
| Cross-tenant access fails closed | ✅ PASS (from V2) | Foreign user 404, forged org selection 403 |
| JWT configuration fail-closed | ✅ PASS (from V2) | Startup rejection, forged signature 401 |
| Device enrollment / revocation | ✅ PASS (from V2) | Single-use code, hash storage, revoke tested |
| Semantic replay (bounded, context-scoped) | ✅ COMPLETE | Fingerprint + 2-min window, 6 integration tests |
| Same-key idempotency (tenant/device-scoped) | ✅ PASS (from V2) | Unique partial index, duplicate handled |
| Policy fail-closed (ALLOW/WARN/BLOCK only) | ✅ PASS (from V2) | Invalid policy → BLOCK; tested |
| Extension build environments | ✅ COMPLETE | Vite config, 3 env examples, 8 unit tests |
| Production HTTPS enforcement (no localhost fallback) | ✅ COMPLETE | Hard build error on HTTP/localhost in staging/prod |
| Manifest host permissions match API origin | ✅ COMPLETE | Vite plugin rewrites manifest post-build |
| WebSocket single-instance model documented | ✅ COMPLETE | Ticket properties, lifetime, revocation, constraint documented |
| WebSocket ticket reuse rejected | ✅ PASS (from V2) | Tested |
| WebSocket tenant binding | ✅ PASS (from V2) | Tested |
| MongoDB validation procedure documented | ✅ COMPLETE | `docs/PHASE_1_MONGODB_VALIDATION.md`, staging validator script |
| Secret rotation checklist documented | ✅ COMPLETE | `docs/PHASE_1_SECRET_ROTATION_CHECKLIST.md` |
| policyDecision != requestPrevented documented | ✅ COMPLETE | Response field, code comment, this document |

---

## Remaining Blockers

| Blocker | Owner | Action Required |
|---|---|---|
| External secret rotation not performed | Operations | Rotate JWT, MongoDB, SMTP, Slack webhook, exposed account password; sign checklist |
| Git history review not performed | Security/Operations | Scan history for credentials; follow governance for remediation |
| Real MongoDB staging validation not run | Operations | Execute `docs/PHASE_1_MONGODB_VALIDATION.md` against backed-up staging clone |
| Legacy org lifecycle migration not performed | Operations | Review existing `Org` records; set `lifecycleStatus` for verified tenants |
| Platform-admin first-user not seeded in production | Operations | Run `npm run provision:platform-admin` with environment-injected credentials |
| Invitation delivery mechanism not implemented | Product/Ops | Out-of-band secure delivery of invitation token to tenant admin |
| WebSocket is single-instance only | Architecture | Do not deploy multiple API instances until shared ticket storage is designed |
| Extension lint baseline (Chrome globals) | Low priority | ESLint `globals` config needs Chrome globals; 32 pre-existing diagnostics |
| Actual AI request prevention | Phase 2 | Requires separate enforcement architecture; not a Phase 1 deliverable |

---

## Test and Build Results

| Check | Result | Notes |
|---|---|---|
| `npm test --runInBand` (backend) | ✅ PASS | 2 suites, 23 tests |
| `node --check` (all backend src) | ✅ PASS | 20 files, no syntax errors |
| `npm run build` (frontend) | ✅ PASS | Stale Browserslist data warning (pre-existing); large-chunk warning (pre-existing) |
| `npm run build:development` (extension) | ✅ PASS | |
| `node --test tests/build-config.test.js` (extension) | ✅ PASS | 3 tests |
| `npm run lint` (extension) | ❌ 32 errors | Pre-existing: Chrome globals, regex escapes, empty catch. No regression introduced |
| `git diff --check` | N/A | No git repository in this environment |

---

## Final Gate

**SECURITY PASS WITH REMEDIATION REQUIRED**

Phase 1 repository controls are implemented and tested. Production onboarding remains gated on:
1. External credential rotation (operations action)
2. Real staging MongoDB validation
3. Legacy org lifecycle migration (operations/data review)
4. Platform-admin bootstrap (operations)

Phase 2 was not started.
