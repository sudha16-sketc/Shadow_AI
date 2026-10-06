# Phase 1 Security Review

## Scope and Method

Read-only review of the current working-tree diff and the surrounding backend routes, middleware, models, services, server registration, Docker configuration, extension event sender, and Phase 1 tests. No implementation files were changed. The only file created for this request is this review.

The focused test file is [`backend/tests/phase1-security.test.js`](backend/tests/phase1-security.test.js). Its passing tests are useful regression checks, but they are mostly mocked route/middleware checks and do not establish integration-level tenant isolation. Findings below are based on the actual code paths, not test count.

## Property Results

1. **FAIL — Tenant context is derived server-side from authenticated identity.**
   - **Files / functions:** [`backend/src/middleware/auth.js`](backend/src/middleware/auth.js), `verifyToken` and `authMiddleware`; [`backend/src/routes/auth.js`](backend/src/routes/auth.js), `ensureUserOrg`, `/signup`, `/login`.
   - **Issue:** JWT claims are treated as authoritative, but both issuer and verifier fall back to the publicly known `change-this-secret-in-production`. Separately, signup and legacy-user resolution attach users to the same organization found by the global name `Default Organization`.
   - **Attack scenario:** If `JWT_SECRET` is unset, an unauthenticated attacker can sign a token with arbitrary `userId`, `orgId`, and `role`; even with a secure secret, new signups are placed into one shared tenant rather than independently provisioned organizations.
   - **Remediation:** Remove the fallback and fail startup unless a strong secret/key is supplied; rotate any previously used signing key and invalidate old tokens. Resolve tenant membership against an active user/device record on requests. Replace name-based shared-org assignment with an explicit, authorized tenant enrollment flow.
   - **Severity:** Critical.

2. **PASS — Extension-supplied `tenantId` cannot override trusted tenant context.**
   - **Evidence:** [`backend/src/routes/events.js`](backend/src/routes/events.js), `EventSchema` uses `.strict()` and the event context is taken from the verified JWT. A body `tenantId`, `orgId`, or other undeclared field is rejected. [`backend/src/middleware/auth.js`](backend/src/middleware/auth.js), `requireTenantAccess`, compares explicit tenant identifiers against `req.user.orgId` rather than adopting them.
   - **Caveat:** This body-field protection does not repair the forgeable JWT trust root reported in item 1.

3. **PARTIAL — Extension-supplied `userId` cannot override authenticated identity.**
   - **Files / functions:** [`backend/src/routes/events.js`](backend/src/routes/events.js), `resolveAuthenticatedEventContext`, `POST /`, `POST /batch`, `processEvent`.
   - **Issue:** A supplied `userId` must equal the token context and the write uses `context.userId`, but the server never verifies that the token user is active or belongs to the claimed organization; device identity is not looked up in the `Device` model. The focused mismatch test covers only the single-event handler, not batch behavior.
   - **Attack scenario:** With a forged token (item 1), or a still-valid token for a deactivated user, an attacker can make the server attribute events to another user or retain access after deactivation. An extension can also omit `userId`; the event is still accepted under the token principal.
   - **Remediation:** Resolve active user and device membership server-side for every event request; bind device credentials to a stored, revocable device record. Add tests through the complete mounted middleware chain for user mismatch, inactive users, and batch mismatch.
   - **Severity:** High.

4. **FAIL — Extension-supplied role/permissions cannot influence authorization.**
   - **Files / functions:** [`backend/src/middleware/auth.js`](backend/src/middleware/auth.js), `authMiddleware` and `requireRole`; [`backend/src/routes/auth.js`](backend/src/routes/auth.js), JWT issuance.
   - **Issue:** Role authorization trusts the JWT `role` claim without loading current server-side role membership. The known fallback signing key makes that claim forgeable when configuration is missing; role revocation also does not invalidate already-issued tokens.
   - **Attack scenario:** An attacker signs an `admin` token for a victim organization and reaches admin-only user/settings routes when the fallback is active. A demoted/deactivated user can keep using an old token until expiry.
   - **Remediation:** Require a non-default secret at startup, use short-lived tokens, and validate current user/device status and role (or a revocable authorization version) on protected requests. Never accept role/permissions from event payloads.
   - **Severity:** Critical.

5. **FAIL — Every tenant-sensitive read is not tenant-scoped.**
   - **Files / functions:** [`backend/src/routes/users.js`](backend/src/routes/users.js), `GET /:id/events` and `GET /`; [`backend/src/routes/justifications.js`](backend/src/routes/justifications.js), `GET /pending` and `GET /`; [`backend/src/services/scoring.js`](backend/src/services/scoring.js), `recalcSecurityScore`; [`backend/src/server.js`](backend/src/server.js), WebSocket connection/broadcast.
   - **Issue:** `GET /users/:id/events` filters only by `userRef`. User-list statistics aggregate events by user IDs without an `orgId` match. Justification list data is scoped, but both total-count queries omit `orgId`. The score service reads all tenants' events. Any WebSocket connection is accepted without authentication, and every high-risk event is broadcast to every connected client.
   - **Attack scenario:** A manager who knows another tenant user's ID can retrieve that user's events. Any caller can connect to the WebSocket and receive high-risk event metadata from every organization. Tenant counts and score inputs also cross boundaries.
   - **Remediation:** Add tenant criteria to every query, aggregation, and count; constrain joins to the same organization. Authenticate WebSocket upgrades, authorize the tenant, and broadcast only to that tenant's authorized connections. Add cross-tenant BOLA and WebSocket tests.
   - **Severity:** Critical for WebSocket disclosure; High for BOLA and count/aggregate leaks.

6. **FAIL — Every tenant-sensitive write is not tenant-scoped.**
   - **Files / functions:** [`backend/src/routes/justifications.js`](backend/src/routes/justifications.js), approval audit write; [`backend/src/services/scoring.js`](backend/src/services/scoring.js), `recalcSecurityScore`; [`backend/src/routes/auth.js`](backend/src/routes/auth.js), signup and `ensureUserOrg`.
   - **Issue:** Justification approval writes an `AuditLog` without `orgId`; scoring reads all events and writes to `Org.updateOne({})`, which is not tied to an organization; signup shares the default organization. Event creation itself does set `orgId` from the token context.
   - **Attack scenario:** Tenant actions produce audit entries that cannot be reliably assigned to the right tenant, while activity in one tenant changes a global/arbitrary organization score. New customers/users can share policy and data boundaries.
   - **Remediation:** Derive and persist `orgId` on every tenant-owned write; make score calculation accept an `orgId` and update exactly that organization; require explicit tenant provisioning and validate membership before user/device writes.
   - **Severity:** High.

7. **FAIL — Cross-tenant access does not consistently fail closed.**
   - **Files / functions:** [`backend/src/routes/users.js`](backend/src/routes/users.js), `GET /:id/events`; [`backend/src/routes/justifications.js`](backend/src/routes/justifications.js), list counts and audit write; [`backend/src/server.js`](backend/src/server.js), WebSocket; [`backend/src/routes/auth.js`](backend/src/routes/auth.js), default-organization assignment.
   - **Issue:** Missing tenant filters and the unauthenticated global WebSocket bypass the intended tenant boundary; tenant context also relies on a forgeable fallback-signed token.
   - **Attack scenario:** A valid manager can enumerate another tenant's user event history by ID; an anonymous WebSocket client can receive tenant event alerts; a forged token can claim a victim tenant.
   - **Remediation:** Fix the token trust root and apply tenant predicates at each data access, including counts, aggregates, exports, WebSocket subscriptions, and writes. Return non-disclosing 404/403 outcomes for foreign IDs and test every alternate route.
   - **Severity:** Critical.

8. **PASS — JWTs without required tenant/org context are rejected by protected middleware.**
   - **Evidence:** [`backend/src/middleware/auth.js`](backend/src/middleware/auth.js), `authMiddleware` requires truthy `userId`, `orgId`, and `role` before calling `next()`. The test `rejects JWTs missing tenant context` verifies a token without `orgId` receives 401. Event POST routes also attach `authMiddleware`.
   - **Caveat:** `/api/auth/check-auth` reports token validity without checking tenant claims; it is not an authorization gate, but its result must not be treated as proof of authorized tenant access. The weak fallback still allows an attacker to mint claims that pass the presence check.

9. **FAIL — Event ingestion can be used to forge another tenant's events.**
   - **Files / functions:** [`backend/src/middleware/auth.js`](backend/src/middleware/auth.js), `verifyToken`; [`backend/src/routes/events.js`](backend/src/routes/events.js), `resolveAuthenticatedEventContext`, `processEvent`; [`backend/src/routes/auth.js`](backend/src/routes/auth.js), JWT secret fallback.
   - **Issue:** Ingestion correctly uses token context rather than a body tenant field, but a known fallback signing key permits arbitrary `orgId`/`userId` claims. In addition, the server accepts client-chosen `riskScore` and `severity` as authoritative detection results.
   - **Attack scenario:** With the fallback active, an attacker signs a token for a victim tenant and submits events there. A compromised extension can also report a high-risk prompt as `LOW` with score zero, causing the server's policy calculation to store it as unblocked.
   - **Remediation:** Eliminate the fallback, verify an active server-registered principal/device, and recompute or independently validate security-sensitive detection/policy inputs server-side. Treat extension severity and score as untrusted telemetry only.
   - **Severity:** Critical for cross-tenant forgery; High for policy bypass via fabricated severity.

10. **PARTIAL — Event schemas reject unexpected/malformed security-sensitive fields.**
    - **Files / functions:** [`backend/src/routes/events.js`](backend/src/routes/events.js), `EventSchema`, `POST /`, `POST /batch`.
    - **Issue:** `.strict()` rejects undeclared fields and Zod validates enums, lengths, ranges, and timestamp format. However, `riskScore`, `severity`, `findingLabels`, domain, and timestamp are client-authored; there is no semantic consistency check (for example, score 95 with `LOW`), no domain allowlist/normalization, and no timestamp age/future bound.
    - **Attack scenario:** A modified extension sends a benign-looking severity/score for a high-risk event, arbitrary labels/domain, or misleading timestamp. The schema accepts syntactically valid but security-inconsistent data.
    - **Remediation:** Make server-side policy decisions independent of extension-provided severity/score; validate canonical domains, bound timestamp skew, and explicitly model permitted client fields. Add tests for unknown tenant/role fields and inconsistent score/severity pairs.
    - **Severity:** High.

11. **PARTIAL — Idempotency/replay protection is not robust across tenant/user context.**
    - **Files / functions:** [`backend/src/routes/events.js`](backend/src/routes/events.js), `POST /`, `POST /batch`; [`backend/src/models/index.js`](backend/src/models/index.js), Event idempotency indexes.
    - **Issue:** Single-event lookup is keyed by `{orgId, idempotencyKey}` and reveals an existing event ID to any authenticated user in that organization. Batch ingestion skips the lookup and relies on the unique database index to reject duplicates; behavior therefore depends on index deployment and produces swallowed per-item failures. A client can evade logical duplicate detection by changing its client-generated key. Keys are not bound to a device/user principal.
    - **Attack scenario:** A same-tenant user reuses a known key and learns another event's ID; batch retries do not receive a deterministic duplicate response; an extension replaying the same semantic event with a fresh key creates another record. Changing a forged org claim also bypasses the org-scoped lookup while the JWT fallback is available.
    - **Remediation:** Use server-issued or cryptographically bound device/user idempotency keys, enforce uniqueness in an explicit transaction/upsert on all ingestion paths, return a non-sensitive deterministic duplicate result, and test races, batch retries, and cross-principal reuse. Keep tenant context server-derived.
    - **Severity:** Moderate to High.

12. **PARTIAL — Policy precedence cannot reliably avoid permissive fallback.**
    - **Files / functions:** [`backend/src/routes/events.js`](backend/src/routes/events.js), `processEvent`; [`backend/src/models/index.js`](backend/src/models/index.js), Org settings defaults; [`backend/src/routes/settings.js`](backend/src/routes/settings.js), `PolicySchema`.
    - **Issue:** The model defaults `defaultAction` to `BLOCK`, but `processEvent` does not validate loaded settings. If the value is absent or invalid, MEDIUM/LOW events are not blocked; the HIGH-only branch blocks only HIGH. The settings policy endpoint does not expose `defaultAction`, so the behavior is not covered by the policy update contract.
    - **Attack scenario:** A legacy/raw database document with incomplete or invalid settings processes a MEDIUM event with `blocked: false`; a configuration migration or out-of-band edit can silently produce this state.
    - **Remediation:** Validate/normalize policy on read and fail closed on missing/unknown values; define explicit ALLOW/WARN/BLOCK precedence and audit the decision. Add missing/invalid policy tests using real Mongoose documents and persisted legacy fixtures.
    - **Severity:** High.

13. **FAIL — Critical security decisions do not all fail closed when policy/configuration is missing or invalid.**
    - **Files / functions:** [`backend/src/routes/events.js`](backend/src/routes/events.js), `processEvent`; [`shadow-extension/src/content.js`](shadow-extension/src/content.js), `checkContent` and `showWarningModal`.
    - **Issue:** Invalid/missing policy can leave MEDIUM/LOW events unblocked as described above. More fundamentally, backend `blocked` is only a stored event flag; actual submission prevention is implemented in a user-controlled content script/modal, not enforced at the AI service/network boundary. A compromised extension can skip detection or the modal entirely.
    - **Attack scenario:** An attacker changes/disables the extension or submits a prompt through another client. The AI request proceeds without the backend seeing or blocking it, regardless of the tenant's BLOCK policy.
    - **Remediation:** Do not represent client-side modal state as a server-enforced block. Define the product security guarantee explicitly; if prevention is required, enforce it through a managed browser/network control or another trusted enforcement point. Independently fail closed for missing/invalid server policy and test decision outcomes.
    - **Severity:** Critical if product promises prevention; otherwise High for policy integrity and misleading audit state.

14. **PARTIAL — Existing authentication/authorization behavior has not been proven free of weakening.**
    - **Files / functions:** [`backend/src/middleware/auth.js`](backend/src/middleware/auth.js), `authMiddleware` and `requireRole`; [`backend/src/routes/auth.js`](backend/src/routes/auth.js), `/device/register`; [`backend/src/server.js`](backend/src/server.js), route mounts.
    - **Issue:** The implementation adds required tenant claims and protects event POSTs, which is positive. But role checks still trust token claims, no active-user/device revocation check exists, device registration creates a 30-day token without persisting a `Device`, and there are no integration tests showing all mounted/alternate routes retain authorization. Deactivation does not revoke existing JWTs.
    - **Attack scenario:** A deactivated or role-demoted user continues to use a valid token; a user can mint untracked device tokens that remain usable for 30 days. The known fallback expands this to forged roles.
    - **Remediation:** Validate active user/device and current role per request or use revocable token versions; persist and revoke device registrations; add route-mount integration tests for each role and tenant boundary.
    - **Severity:** High.

15. **PASS — The Phase 1 diff does not introduce a new production secret or credential.**
    - **Evidence:** The added test secret is test-only. The static JWT fallback in auth files and plaintext credential in [`backend/reset-password.mjs`](backend/reset-password.mjs) are present in the current repository but are not newly introduced by the inspected diff. They remain serious existing exposures and are included in the gate rationale; rotate/remove them before production.

## Additional Direct Findings

- **BOLA / IDOR:** `GET /api/users/:id/events` is the clearest direct BOLA: it authorizes manager/admin role but queries by `userRef` only. The user detail route is scoped, but this alternate route does not reuse or verify that tenant-scoped user lookup.
- **Tenant enumeration:** Justification pagination totals omit `orgId`; global signup uses one organization and globally unique email lookup exposes whether an email is registered. Counts are a cross-tenant side channel even where record lists are scoped.
- **Confused deputy / mass assignment:** Event context is generally separated from payload fields and the strict event schema blocks arbitrary fields. The larger deputy issue is accepting client-authored severity/score as the basis for a server policy decision. User update schemas project allowed fields, so this review did not find a direct user mass-assignment path in those handlers.
- **Alternate routes / inconsistent checks:** WebSocket connections have no auth or tenant binding; user event history misses tenant scope; justification counts and audit writes are inconsistent. The REST route mounts do apply `authMiddleware` to users, analytics, settings, justifications, and audit logs; event POSTs apply it on their own router.
- **Fail-open error handling:** Event persistence/config lookup errors return 500 rather than accepting the event, which is fail-closed for ingestion. Alert delivery failures are logged and swallowed after event storage; that may be acceptable operationally, but a BLOCK decision is only metadata and is not an enforcement mechanism.
- **Credential exposure:** [`backend/src/middleware/auth.js`](backend/src/middleware/auth.js) and [`backend/src/routes/auth.js`](backend/src/routes/auth.js) contain the known JWT fallback. [`backend/reset-password.mjs`](backend/reset-password.mjs) contains a plaintext account password. Treat the password as compromised, rotate it, and remove the credential from repository history/secret stores as appropriate. `docker-compose.yml` passes `JWT_SECRET` from the environment but does not itself prevent an empty value, so the application fallback remains reachable.
- **Extension enrollment:** [`shadow-extension/src/background.js`](shadow-extension/src/background.js) posts batches without an Authorization header and does not call `/api/auth/device/register`. Thus current extension ingestion will be rejected by the new auth requirement; the server-side device-registration endpoint also does not persist or validate the `Device` model. This is an implementation blocker, not a reason to make event ingestion public.

## Test Coverage Assessment

The seven focused tests cover selected middleware/event behaviors, but do not prove cross-tenant query scoping, writes, WebSocket isolation, role escalation resistance, active-user revocation, malformed policy behavior, user-history IDOR, justification counts, or batch idempotency. The event handler tests invoke the route handler directly rather than exercising Express mounting and all middleware together. Passing these tests is not sufficient evidence for a security pass.

## PHASE 1 SECURITY GATE

**SECURITY FAIL**

The current code has a forgeable JWT trust root when `JWT_SECRET` is absent, direct cross-tenant disclosure paths (including unauthenticated WebSocket broadcasts), an unscoped user-event history route, incomplete tenant-scoped aggregates/writes, and policy decisions that can rely on client-supplied severity. Phase 1 is not production-safe until Critical and High findings are remediated and validated with integration-level cross-tenant tests.
