# Shadow AI Phase 2A Implementation Plan

This document breaks down the future implementation of Phase 2 into small, actionable stages. **These stages are for Phase 2B and 2C and are NOT to be implemented in Phase 2A.**

---

## Stage 1: Server-Side Policy Engine (Phase 2B)

**Objective:**
Establish the backend as the sole authority for policy decisions. The backend must independently determine if a request should be blocked, warned, or allowed based on metadata, rather than accepting the client's decision.

- **Files/components likely affected:**
  - `backend/src/utils/event-policy.js`
  - `backend/src/routes/events.js`
  - `backend/src/models/Policy.js` (to be created/expanded)
- **Dependencies:**
  - Existing Tenant Isolation and Event Ingestion.
- **Security requirements:**
  - The client must not dictate the `policyDecision`.
  - Fail-closed (default-deny) behavior if policies fail to load.
- **Tests required:**
  - Unit tests verifying that various client payloads result in correct server-side decisions, regardless of client `riskScore`.
- **Acceptance criteria:**
  - Backend recalculates policy decisions and risk scores.
  - Client-side severity claims are recorded only as telemetry (`reportedSeverity`), not as the actual `policyDecision`.
- **Explicitly excluded work:**
  - No network interception/proxying yet.

---

## Stage 2: Robust Tenant Policy Management (Phase 2B)

**Objective:**
Allow tenant administrators to configure custom detection rules, thresholds, and policy actions (ALLOW/WARN/BLOCK) scoped strictly to their organization.

- **Files/components likely affected:**
  - `backend/src/routes/policies.js` (to be created/expanded)
  - `backend/src/models/Policy.js`
  - `frontend/src/pages/Policies.jsx` (to be created/expanded)
- **Dependencies:**
  - Server-Side Policy Engine (Stage 1).
- **Security requirements:**
  - Strict tenant authorization on all policy CRUD operations.
  - Policy versions must be immutable; updates create new versions.
- **Tests required:**
  - Integration tests for cross-tenant policy access denial.
- **Acceptance criteria:**
  - Tenant Admin can create a policy specifying "BLOCK on SSN".
  - Backend event ingestion correctly applies this new policy.
- **Explicitly excluded work:**
  - No complex group/user-specific policy hierarchies yet (tenant-level only).

---

## Stage 3: Trusted Enforcement Gateway Design & PoC (Phase 2C)

**Objective:**
Implement the network-level trusted enforcement point (Option D) to actively prevent requests that violate the BLOCK policy, immune to client-side bypass.

- **Files/components likely affected:**
  - New service: `gateway/` or API Proxy infrastructure.
  - Updates to `backend/src/routes/events.js` to distinguish `requestPrevented` true/false based on Gateway enforcement vs Extension telemetry.
- **Dependencies:**
  - Stage 1 and 2.
- **Security requirements:**
  - Must intercept TLS (or integrate with an existing SWG).
  - Must authenticate the source of the traffic (device/user) and resolve `orgId` securely.
- **Tests required:**
  - E2E testing of `curl` requests being blocked by the Gateway.
- **Acceptance criteria:**
  - A test script directly calling an AI provider with sensitive data is blocked at the network level and logged.
  - The audit log accurately reflects `requestPrevented = true`.
- **Explicitly excluded work:**
  - Full production deployment of the proxy.
  - Large-scale TLS certificate management automation (focus on PoC first).

---

## Stage 4: Extension UX Evolution (Phase 2C)

**Objective:**
Modify the browser extension to act as a pure UX and telemetry layer, deferring to the Gateway or Backend for absolute truth, but still providing immediate user feedback (warnings, sanitization).

- **Files/components likely affected:**
  - `shadow-extension/src/content.js`
  - `shadow-extension/src/background.js`
- **Dependencies:**
  - Stage 3.
- **Security requirements:**
  - Extension must gracefully handle offline/unavailable backends according to tenant fail-open/fail-closed rules.
- **Tests required:**
  - Extension unit tests for UX flows under latency/offline conditions.
- **Acceptance criteria:**
  - Extension warns user, but if bypassed, the Trusted Gateway successfully drops the connection anyway.
- **Explicitly excluded work:**
  - Attempting to make the extension "tamper-proof" (which is impossible).
