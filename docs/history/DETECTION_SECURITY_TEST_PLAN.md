# Detection Security Test Plan for Shadow AI

## Purpose

This plan defines a focused security validation strategy for the Shadow AI production architecture. It is designed to verify that detection, policy enforcement, tenant isolation, and extension trust assumptions remain correct under adversarial conditions.

## General pass/fail criteria

A test passes only when:

- the server enforces tenant scoping correctly
- identity and device claims are verified server-side
- no sensitive raw content is stored or exposed without approval
- policy actions match expected behavior
- unauthorized access fails deterministically
- invalid or malformed requests are rejected

A test fails if any of the following occur:

- cross-tenant access is possible
- unauthorized API requests succeed
- raw secret content is exposed in logs or responses
- event ingestion can be spoofed
- extension-generated identity claims are accepted without validation

---

## A. Tenant isolation tests

### Test: Tenant A → Tenant B event access

- Scenario: authenticated Tenant A user attempts to fetch or query Tenant B events
- Expected: request denied with 403 or 404; no record returned
- Pass criteria: tenant data remains inaccessible
- Fail criteria: any Tenant B event is visible or returned

### Test: Tenant A → Tenant B dashboard access

- Scenario: Tenant A admin attempts to open Tenant B dashboard context or endpoint
- Expected: server rejects cross-tenant access
- Pass criteria: no dashboard context is resolved for another tenant
- Fail criteria: tenant switch or exposure occurs

### Test: Tenant A → Tenant B policy access

- Scenario: query a policy object belonging to Tenant B using Tenant A credentials
- Expected: no policy data returned
- Pass criteria: policy lookup is scoped to the authenticated tenant
- Fail criteria: policy object is readable across tenants

### Test: Tenant A → Tenant B user access

- Scenario: attempt to read or modify a user record from another tenant
- Expected: access denied
- Pass criteria: no user data leaks
- Fail criteria: user records from another tenant are visible or updateable

### Test: Tenant A → Tenant B device access

- Scenario: Tenant A user or device attempts to view or revoke Tenant B device records
- Expected: denied
- Pass criteria: devices remain isolated by tenant
- Fail criteria: device metadata or tokens from another tenant become visible

---

## B. Authentication tests

### Missing token
- Request a protected endpoint without any Authorization header.
- Expected: 401

### Invalid token
- Use malformed or unsigned token content.
- Expected: 401

### Expired token
- Use token expired beyond allowed lifetime.
- Expected: 401

### Revoked token
- Revoke token after issuance, then use it.
- Expected: 401 and invalidation recorded

### Modified token
- Alter a JWT payload claim.
- Expected: verification failure and no privileged access

### Wrong organization
- Authenticate as a valid user but request a resource in another organization.
- Expected: 403 or 404

### Privilege escalation
- Attempt to access admin-only function as a lower-privileged user.
- Expected: denial

### Pass/fail criteria
- Every case must result in explicit denial, never silent fallback.

---

## C. Event ingestion tests

### Spoofed user ID
- Submit an event with a user ID not associated with the authenticated device or user.
- Expected: rejected or remapped to verified identity only

### Spoofed organization ID
- Submit event payload containing a different organization claim.
- Expected: server ignores client claim and resolves tenant from trusted auth context

### Spoofed device ID
- Use a device ID not assigned to the extension or tenant.
- Expected: rejected

### Replay attacks
- Resubmit the same event payload with old timestamp and same device identity.
- Expected: deduplicated or rejected as replay

### Oversized payloads
- Submit batches or payloads exceeding defined limits.
- Expected: 413 or validation error

### Malformed payloads
- Send wrong types, invalid enums, missing required fields, or broken JSON.
- Expected: schema rejection

### Rate-limit bypass
- Repeatedly send requests from a single device or IP to attempt bypass logic.
- Expected: rate limit triggers and requests are blocked or throttled

### Duplicate events
- Send the same detection event multiple times.
- Expected: deduplication if idempotency is supported; otherwise explicit rejection

### Pass/fail criteria
- No malicious event enters storage without authenticated device and tenant context.

---

## D. Extension security tests

### Token extraction
- Attempt to read stored extension tokens from the browser storage or accessible JavaScript context.
- Expected: token is not exposed in plain text to page scripts or other untrusted contexts.

### Message manipulation
- Send forged `LOG_EVENT` or policy requests from a content script or injected script.
- Expected: server rejects invalid message or insufficient auth context.

### Content-script abuse
- Inject custom scripts on monitored pages to trigger a false positive or bypass detection.
- Expected: content script logic remains isolated and backend trust remains intact.

### Background-script abuse
- Attempt to manipulate queue logic, event timing, or token state in the service worker.
- Expected: backend still validates and rejects tampered or forged requests.

### Unauthorized API requests
- Attempt direct fetch calls from the page or extension outside the approved flow.
- Expected: rejected by backend if no authenticated device identity exists.

### Extension storage manipulation
- Modify extension storage values such as user IDs, device IDs, or policy state.
- Expected: backend must ignore untrusted client values and enforce server-side tenant resolution.

### Pass/fail criteria
- The extension is treated as a potentially compromised local environment; the backend stays authoritative.

---

## E. Detection engine tests

### Known secrets
- AWS keys, GitHub tokens, Stripe tokens, JWTs, private keys, database URLs
- Expected: detector identifies and classifies correctly

### Obfuscated secrets
- secrets with whitespace, separators, or deliberate splitting
- Expected: depending on supported detection model, either flag or explicitly document unsupported format

### Encoded secrets
- base64 or URL-encoded variants
- Expected: detection either catches them or clearly documents a false negative risk

### Unicode tricks
- Unicode homographs, normalization tricks, and visually confusing forms
- Expected: detection handles known edge cases without silent bypass

### Case variations
- uppercase/lowercase mixes for keys and tokens
- Expected: detection is case-insensitive where required

### Split tokens
- tokens split across newlines or segments
- Expected: detection detects or rejects with explicit false-negative risk reporting

### Prompt injection variants
- known malicious instructions, extraction prompts, roleplay prompt injection payloads
- Expected: classification occurs or model-specific fallback is logged

### False positives
- benign internal text that may resemble credentials or secrets
- Expected: system should not over-alert without acceptable configured risk thresholds

### False negatives
- known malicious but adversarially formatted input
- Expected: security team reviews and documents coverage gaps

### Pass/fail criteria
- Each category has documented expected outcome and risk status.
- Missing handling must be tracked as a known gap, not ignored.

---

## F. Policy enforcement tests

The policy engine must verify the following actions for each relevant condition:

- ALLOW
- WARN
- SANITIZE
- BLOCK

### Policy test matrix

| Condition | Expected action | Notes |
|---|---|---|
| known secret in allowed domain | ALLOW or WARN per policy | must be policy-driven |
| known secret in blocked domain | BLOCK | strict deny condition |
| PII in low-risk context | WARN | depending on org policy |
| private code leak pattern | SANITIZE or BLOCK | depends on policy |
| prompt injection indicator | WARN or BLOCK | risk-based decision |
| high-risk secret + high severity | BLOCK | default protective policy |

### Expected results
- Each policy action must be enforced in the extension or backend according to the policy model.
- The final action must be tenant-aware.
- Policy precedence must be consistent.

### Pass/fail criteria
- A policy decision must not depend on client-supplied data alone.
- A policy decision must be consistent across extension and backend.
- A stale or invalid policy must not be blindly trusted.

---

## G. Security test execution strategy

### Recommended execution order

1. tenant isolation tests
2. authentication and authorization tests
3. event ingestion and replay tests
4. extension security tests
5. detection tests
6. policy enforcement tests

### Reporting format

Each test should report:

- title
- scenario
- environment
- expected result
- actual result
- pass/fail
- risk level
- remediation required

### Exit criteria for production readiness

The project is not ready for production onboarding until all critical tests pass and the following are verified:

- no cross-tenant access is possible
- no user/device spoofing is possible
- no raw secrets are stored or exposed by the system under test
- all policy actions are enforced server-side or by trusted policy evaluation
- extension tampering cannot bypass tenant or policy enforcement

---

## H. Unknowns / decisions required

The following remain subject to a product decision and must be resolved before final production validation:

- whether SSO is required in v1
- whether user/device overrides are permitted in the policy model
- whether policy defaults are fail-open or fail-closed
- whether prompt injection detection is handled by keyword heuristics, model-based detection, or both
- whether data retention exceptions are allowed for customer-specific requirements

`UNKNOWN — requires decision`
