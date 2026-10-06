# Phase 2B Implementation Report

## Objective
The objective of Phase 2B was to transition Shadow AI from a client-authoritative security model to a server-authoritative policy engine. This ensures that the backend is solely responsible for determining the risk, severity, and resulting policy decisions (ALLOW, WARN, SANITIZE, BLOCK), while the browser extension merely supplies local detection telemetry.

## Current Architecture Before Changes
In Phase 2A and prior, the `shadow-extension` calculated a `riskScore` and `severity` and sent them to the backend. The backend's `resolvePolicyDecision` simply applied the tenant's `defaultAction` to every event, ignoring the actual findings, while trusting the client-asserted `riskScore` and `severity` for event storage and alerts. This allowed a compromised client to manipulate event severity or suppress alerts.

## Implementation Changes
1. **Detection Normalization:** Implemented a mapping from client `findingLabels` to normalized categories (e.g. `API_KEY`, `PII`, `PASSWORD`, `PROPRIETARY`) with associated base scores.
2. **Server-Side Risk Calculation:** Implemented a deterministic algorithm that assigns the maximum base score among detections and adds a modifier for multiple findings (capped at 100).
3. **Server-Side Severity Calculation:** Mapped risk scores to strict deterministic severity bands (`LOW` < 40, `MEDIUM` < 70, `HIGH` < 90, `CRITICAL` >= 90).
4. **Policy Engine (`policy-engine.js`):** Built a dedicated module that evaluates findings against a defined `Policy` model, resolving rules by category, risk, and severity thresholds.
5. **Event Model & Flow:** Updated `events.js` so `processEvent` executes the `evaluatePolicy` function. The client-provided score and severity are preserved purely as `clientTelemetry`, while top-level security fields on the `Event` are strictly server-derived.
6. **Policy API (`policies.js`):** Implemented authenticated REST endpoints for tenant administrators to create, read, update, and disable policies.

## Policy Model
The new `Policy` model (`src/models/index.js`) defines:
- **Tenant Isolation:** Enforced via `orgId`.
- **Fields:** `name`, `status`, `version`, `precedence`, `scope` (TENANT, GROUP, USER), `action`, and a sub-document array of `rules`.
- **Rules:** Support matching by `category`, `severityThreshold`, or `riskThreshold`.

## Policy Precedence
Policies are fetched sorted by `precedence` descending (`sort({ precedence: -1 })`). The engine stops evaluating once a rule within a matching policy triggers. If no custom policy matches, the engine falls back to the tenant's `defaultAction`, enforcing `blockOnHigh` if applicable.

## Tenant Isolation & API Security
- **Tenant Context:** API routes use `authMiddleware` to derive `req.user.orgId`.
- **Authorization:** `policies.js` requires the `admin` role to mutate policies via a `requireOrgAdmin` middleware.
- **Fail-Closed:** Missing or invalid policy defaults automatically trigger a `BLOCK` decision with the reason `invalid_or_missing_policy`.

## Audit Behavior
All policy mutations (creation, updates, disabling) log to `AuditLog` with explicit references to the policy ID, actor, and version changes. Event processing audits capture the `clientReportedSeverity` alongside the `serverCalculatedSeverity` to easily spot client tampering.

## Limitations
- Actual enforcement (network disruption) is explicitly deferred to Phase 2C.
- Sanitization logic is currently a structural placeholder in the `action` enum and is not actively rewriting content.

## Deferred to Phase 2C
- Implementation of the Trusted Gateway, Proxy, or TLS Interception.
- True network-level Request Prevention based on the newly calculated server decisions.
