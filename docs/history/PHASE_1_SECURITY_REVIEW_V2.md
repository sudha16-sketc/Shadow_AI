# Phase 1 Security Review V2

## Scope

Re-evaluation of all 15 properties from [`PHASE_1_SECURITY_REVIEW.md`](PHASE_1_SECURITY_REVIEW.md) after the remediation. Evidence includes actual route/middleware code, Mongoose schema/index setup, extension/dashboard enrollment paths, 20 passing backend tests, and mounted HTTP/WebSocket tests. Integration tests use in-memory model fakes; they do not establish real MongoDB index/migration behavior.

## Property Results

1. **PASS — Tenant context is derived from authenticated identity.** JWT user claims are matched to an active database user and organization; role is loaded from the user record. Signup no longer assigns users to a shared default organization.

2. **PASS — Extension-supplied `tenantId` cannot override trusted context.** Event schema rejects undeclared tenant fields; protected REST context and WebSocket tickets derive org from validated identity/device records.

3. **PASS — Extension-supplied `userId` cannot override authenticated identity.** User identity is resolved from the active registered device owner; the strict event schema rejects a client `userId` field.

4. **PASS — Extension-supplied role/permissions cannot influence authorization.** User roles are loaded from the database. Device credentials receive only the device role, and event payload role/permission fields are rejected.

5. **PASS — Tenant-sensitive reads are tenant-scoped in reviewed backend paths.** Users, event lists/history, event and user aggregates, analytics user joins, justification lists/counts, audit lists/exports/details, settings, score calculations, and device authentication use trusted org context.

6. **PASS — Tenant-sensitive writes are tenant-scoped in reviewed backend paths.** Events, users, settings, justifications, audit entries, score updates, devices, logout/password updates, and the reset utility derive or require organization context server-side.

7. **PASS — Cross-tenant access fails closed in reviewed code paths.** Foreign user reads/writes return non-disclosing 404; invalid/foreign credentials fail authorization; WebSocket tickets and broadcasts are bound to one tenant.

8. **PASS — JWTs without required tenant/org context are rejected.** User JWTs require user type, user ID, org ID, valid signature, active database membership, and current auth version. Device submissions use a separately stored opaque credential.

9. **PASS — Event ingestion cannot forge another tenant's events through client identity fields.** Only active registered devices may post; org/user/device are resolved from the credential. Forged payload tenant/user fields are rejected and forged JWT signatures fail.

10. **PASS — Event schema rejects undeclared and malformed security-sensitive fields.** Zod schema is strict, constrains enums/ranges/lengths/domain syntax, requires a recent timestamp and idempotency key, and persists submitted detection fields separately as `clientTelemetry`. Telemetry does not select the policy action.

11. **PARTIAL — Idempotency is tenant/device-authenticated and duplicate keys are rejected, but semantic replay can use a fresh client key.**
    - **File / function:** [`backend/src/routes/events.js`](backend/src/routes/events.js), `ingestEvent`, `POST /`, `POST /batch`; [`backend/src/models/index.js`](backend/src/models/index.js), Event index.
    - **Issue:** Same-key retries are checked and protected by a unique partial index; changing tenant/user context cannot bypass the check because those values are server-derived. A compromised registered device can submit the same telemetry again under a newly generated key.
    - **Attack scenario:** A modified extension resubmits a previously observed event payload with a new idempotency key to inflate event/score/alert volume.
    - **Remediation:** Add a bounded server-issued nonce or server-computed replay fingerprint with a documented duplicate window; retain tenant/device binding and test changed-key replays against MongoDB uniqueness.
    - **Severity:** Moderate.

12. **PASS — Policy precedence cannot silently fall back to permissive behavior.** Only ALLOW/WARN/BLOCK are accepted; missing or invalid policy resolves to BLOCK. Policy changes are tenant-scoped and versioned. Integration tests exercise all three valid decisions and invalid/missing legacy-style values.

13. **PARTIAL — Policy decisions fail closed as server records, but do not enforce external request prevention.**
    - **Files / functions:** [`backend/src/utils/event-policy.js`](backend/src/utils/event-policy.js), `resolvePolicyDecision`; [`backend/src/routes/events.js`](backend/src/routes/events.js), `processEvent`; [`shadow-extension/src/content.js`](shadow-extension/src/content.js), local detection/modal path.
    - **Issue:** Server policy selection is independent of client severity/risk score and invalid policy records BLOCK. However, the browser extension is tamperable and the backend cannot stop an AI request from reaching the external service. `policyDecision` is an audit decision only; API responses say `requestPrevented: false`.
    - **Attack scenario:** A user disables/modifies the extension or uses another client, so no event reaches the backend even though tenant policy is BLOCK.
    - **Remediation:** Keep the limitation explicit. If product requirements promise actual prevention, add an approved trusted enforcement point such as a managed network control or future proxy phase; do not reinterpret the stored decision as proof of blocking.
    - **Severity:** High for any prevention promise; otherwise an acknowledged product boundary.

14. **PASS — Existing authentication/authorization behavior is not weakened in reviewed paths.** Current roles and active state are checked server-side; logout/password reset invalidate auth versions; role change/deactivation closes user WebSockets; device enrollment is persistent and revocable; event writes require devices.

15. **PARTIAL — No secret is present in the changed production source, but historical/runtime rotation is not verified.**
    - **Files / configuration:** [`backend/src/config/security.js`](backend/src/config/security.js), [`backend/reset-password.mjs`](backend/reset-password.mjs), ignored `backend/.env`, Git history.
    - **Issue:** The JWT fallback and literal reset credentials were removed; reset inputs are runtime-only, and the local `.env` is ignored/untracked. Prior exposed credentials may remain valid or present in Git history; the environment file's contents and external secret systems were intentionally not inspected.
    - **Attack scenario:** A previously exposed signing/database/password credential remains usable even though the current source no longer contains it.
    - **Remediation:** Operations must rotate JWT/database/SMTP/webhook/account credentials, invalidate old sessions, and review/sanitize repository history according to repository policy. Verify secret-manager/runtime values without placing them in logs or reports.
    - **Severity:** Critical until credential rotation and history review are completed.

## Additional Review

- **BOLA/IDOR:** The user-event history route now resolves the requested user within the caller org before querying events; the tested Tenant A to Tenant B read/write/delete attempts return 404.
- **Tenant enumeration:** Public signup no longer reveals/creates a shared default tenant. Login uses a uniform invalid-credentials response. Justification totals are org-scoped.
- **Confused deputy and mass assignment:** Detection fields are telemetry; strict event payload validation and explicit update schemas prevent client identity/policy fields from becoming authority. Security score and notification volume can still be influenced by a compromised device's reported telemetry and should be treated as untrusted metrics.
- **Alternate routes:** Event batch and single routes both require device auth; user history, exports, justifications, settings, scoring, and WebSockets have scoped paths. REST tests exercise the app's actual mounts.
- **Fail-open handling:** Missing/invalid policy returns BLOCK; auth/database failure does not grant access; event ingestion errors do not return accepted success. External alert delivery failure remains an operational notification failure, not a policy override.

## Remaining Blockers

- Platform-admin tenant invitation/provisioning is absent. Self-service signup is intentionally disabled; existing legacy org assignments require verified customer mapping before onboarding.
- Previously exposed credentials require external rotation, and Git history review is outstanding.
- MongoDB is unavailable in this environment. Startup index replacement, legacy duplicate handling, and database-backed integration must be validated on a backed-up staging copy.
- WebSocket one-time tickets are process-local; multi-instance deployment requires shared state or a tested routing constraint.
- Production extension API URL/HTTPS host permissions must be configured; checked-in URL is development localhost.
- Actual AI request prevention is not implemented in this Phase 1 and is not claimed.
- Backend/frontend do not define dedicated typecheck scripts; extension lint currently reports existing Chrome-global/regex/empty-catch diagnostics.

## PHASE 1 SECURITY GATE

SECURITY PASS WITH REMEDIATION REQUIRED
