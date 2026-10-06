# Phase 2B Security Review

## Client-Authoritative Risk
**Status:** PASS
**Evidence:** `processEvent` in `events.js` captures `data.riskScore` exclusively in `clientTelemetry.riskScore`. The root `riskScore` on the `Event` schema is strictly assigned from `decision.riskScore` returned by `evaluatePolicy`.

## Client-Authoritative Severity
**Status:** PASS
**Evidence:** Similar to risk, `data.severity` is relegated to `clientTelemetry`. The actual severity triggering alerts (Slack/Email) and WebSocket broadcasts relies entirely on the server-calculated `decision.severity` in `events.js`.

## Client-Authoritative Policy Decision
**Status:** PASS
**Evidence:** The client cannot pass a `policyDecision` field in the event payload. The Zod `EventSchema` drops unrecognized fields (`.strict()`). The backend calculates the decision using server-side rules.

## Tenant Isolation
**Status:** PASS
**Evidence:** Policy CRUD endpoints (`GET`, `POST`, `PUT`, `DELETE` in `policies.js`) explicitly scope all queries to `orgId: req.user.orgId`. Event evaluation queries `Policy.find` using the validated context `orgId`. 

## Authorization
**Status:** PASS
**Evidence:** A custom `requireOrgAdmin` middleware enforces that `req.user.role === 'admin'` on all policy mutation routes, preventing `viewer` or `manager` roles from changing security posture.

## Policy Version Isolation
**Status:** PASS
**Evidence:** Updating a policy (`PUT /api/policies/:id`) does not overwrite historical event records. It increments the `version` counter on the policy document (`$inc: { version: 1 }`). Events store the evaluated `policyVersion` statically at ingestion time.

## Policy Manipulation
**Status:** PASS
**Evidence:** Zod validation on `PolicySchema` restricts fields. Policies cannot be completely deleted (hard delete), only flagged as `status: 'DISABLED'`, preserving referential integrity for audits.

## Event Manipulation
**Status:** PASS
**Evidence:** Replay attacks and identity spoofing remain protected by Phase 1 idempotency keys, fingerprints, and strict JWT/device token verification.

## Audit Integrity
**Status:** PASS
**Evidence:** The `AuditLog.create` operations for events were expanded to explicitly contrast `clientReportedSeverity` with `serverCalculatedSeverity`, logging attempts where the client may have suppressed severity.

## Fail-Open Behavior
**Status:** PASS
**Evidence:** In `policy-engine.js`, if an exception occurs during policy evaluation or if the tenant's default action is mathematically invalid (not in the `POLICY_ACTIONS` Set), the engine fast-fails to a `BLOCK` decision.

## WebSocket Isolation
**Status:** PASS
**Evidence:** The WebSocket broadcast mechanism was untouched and relies entirely on Phase 1 tenant-scoped namespaces and the new server-derived `decision.severity`.

## Sensitive Data Exposure
**Status:** PASS
**Evidence:** Policies use categorical rules (`API_KEY`, `PII`) and thresholds. Raw matching string data is still absent from the DB, preserving the Phase 1 zero-knowledge constraint for raw inputs.
