# Phase 1 Implementation Plan for Shadow AI

## Overview

This plan is intentionally focused on securing and scaling the existing product toward a production-ready multi-tenant SaaS architecture. It prioritizes security dependencies before feature expansion.

The phases below correspond to the production architecture described in the target design.

---

## Phase 0 — Secret cleanup

### Objective
Remove and rotate all secrets currently exposed or suspected in the repository and environment, and establish a production secrets model.

### Files/modules likely affected
- backend/.env
- docker-compose.yml
- any environment templates
- deployment config and secret references
- documentation referencing live credentials

### Database/model changes
- None required for the secret cleanup phase itself.

### API changes
- None required in code; environment values must be removed from repository and injected externally.

### Extension changes
- None required beyond ensuring no hardcoded production secrets or tenant-specific credentials are embedded.

### Dashboard changes
- None required.

### Security requirements
- Secrets must be stored in an external secret manager.
- Repository history must be reviewed for leaked credentials.
- Secret rotation and credential revocation must be tracked.

### Tests required
- Secret scan validation
- repository leak verification
- environment secret validation

### Dependencies
- secret management platform
- environment management pipeline
- operational signoff

### Exit criteria
- No live or suspect secrets remain in source control or environment templates.
- Secret rotation is complete and validated.
- All services use environment variables or secret manager injection.

---

## Phase 1 — Multi-tenant foundation

### Objective
Create the platform’s tenant model and enforce tenant boundaries across the application.

### Files/modules likely affected
- backend/src/models/index.js
- backend/src/routes/auth.js
- backend/src/routes/users.js
- backend/src/routes/events.js
- backend/src/routes/analytics.js
- backend/src/routes/settings.js
- backend/src/services/scoring.js
- backend/src/routes/audit-log.js

### Database/model changes
- Add explicit tenant ownership model to all tenant-owned records.
- Define organization model as the canonical tenant boundary.
- Ensure user, device, event, policy, and audit records are bound to a tenant.
- Add tenant indexes and query restrictions.

### API changes
- All read/write APIs must resolve authenticated tenant context before resource access.
- All tenant-scoped endpoints must use authorization + tenant resolution checks.
- Export, aggregation, and search endpoints must enforce the same scope.

### Extension changes
- Require extension-to-tenant binding before event submission.
- Remove any client-controlled tenant identity assumptions.

### Dashboard changes
- Tenant-scoped dashboard views and admin scoping.
- Org switch logic must be server-validated.

### Security requirements
- No data access without trusted tenant context.
- No cross-tenant queries allowed.
- All list, search, and aggregation queries must be tenant-filtered.

### Tests required
- cross-tenant user access tests
- cross-tenant event access tests
- cross-tenant dashboard tests
- policy-isolation tests

### Dependencies
- tenant identity design
- role model decision
- database schema design

### Exit criteria
- Tenant isolation is enforced in every API access path and is validated by automated tests.
- Data access is impossible across tenant boundaries.

---

## Phase 2 — Authentication & authorization

### Objective
Establish a production-grade authentication and authorization system.

### Files/modules likely affected
- backend/src/middleware/auth.js
- backend/src/routes/auth.js
- backend/src/routes/users.js
- backend/src/routes/settings.js
- backend/src/routes/audit-log.js
- frontend/src/hooks/useAuth.js

### Database/model changes
- Add session and refresh token records if required.
- Add user/organization membership tables if not already represented.
- Add login failure, session revoke, and account lockout state.

### API changes
- Add proper login/logout lifecycle.
- Add refresh token rotation endpoints.
- Add token revocation and session invalidation flow.
- Add organization-scoped access checks.

### Extension changes
- Replace insecure or untrusted client-side identity assumptions with device-bound auth.
- Add secure token storage and rotation.

### Dashboard changes
- Use secure session handling and server-validated auth.
- Remove reliance on browser-local-only permission assumptions.

### Security requirements
- Strong password hashing
- short-lived access tokens
- rotated refresh tokens
- revocation support
- explicit tenant-scoped authorization
- no raw client trust of tenant or user identity

### Tests required
- missing token access tests
- invalid token tests
- expired token tests
- revoked token tests
- wrong-organization access tests
- privilege escalation tests

### Dependencies
- tenant model
- security review of auth flows
- identity lifecycle decisions

### Exit criteria
- AuthN/AuthZ are proven for users, admins, and devices.
- Session compromise is mitigated with revocation and rotation.

---

## Phase 3 — Secure extension identity

### Objective
Introduce a trusted, tenant-bound extension identity and secure event submission model.

### Files/modules likely affected
- shadow-extension/src/background.js
- shadow-extension/src/content.js
- shadow-extension/src/popup.js
- shadow-extension/public/manifest.json

### Database/model changes
- Add device records, extension registration status, install metadata, and token state.
- Add device-to-tenant mappings.

### API changes
- Device registration API
- device revocation API
- extension auth token issuance
- per-device rate-limit metadata

### Extension changes
- device registration on install / activation
- secure storage for tokens
- token rotation flow
- event signing or authenticated submission
- timeout and replay protection

### Dashboard changes
- device inventory and tenant admin view
- device recall / revoke actions

### Security requirements
- The extension is not a trust anchor.
- Device identity must be issued and validated by the backend.
- Extension can be tampered with; backend must validate and enforce limits.

### Tests required
- device spoofing tests
- token extraction tests
- unauthorized API call tests
- replay tests
- event injection tests

### Dependencies
- tenant model
- auth model
- event ingestion validation

### Exit criteria
- The backend can authenticate device-originated events and reject forged or spoofed requests.

---

## Phase 4 — Secure event ingestion

### Objective
Protect the event pipeline from spoofing, rate abuse, and large malicious payloads.

### Files/modules likely affected
- backend/src/routes/events.js
- backend/src/server.js
- backend/src/services/scoring.js
- backend/src/services/alerting.js
- backend/src/models/index.js

### Database/model changes
- event record schema with tenant metadata and device metadata
- idempotency tracking
- rate-limit counters or derived metrics
- event audit metadata

### API changes
- authenticate every event ingress request
- validate tenant and device ownership
- enforce strict schemas and payload limits
- reject duplicate or replay events
- apply rate limits per device, user, org, and global

### Extension changes
- submit only authenticated, validated payloads
- include event metadata and timestamps
- use retry logic without duplicate processing

### Dashboard changes
- report event health and ingestion anomaly signals

### Security requirements
- No event accepted without server-side auth and tenant resolution.
- No client-controlled trust for org, user, or device.
- Strict limit on payload sizes and batch lengths.

### Tests required
- spoofed user ID tests
- spoofed org ID tests
- oversized payload tests
- malformed payload tests
- duplicate/replay tests
- rate-limit bypass tests

### Dependencies
- secure identity model
- policy model
- rate-limit strategy

### Exit criteria
- Event ingestion is authenticated, scoped, and abuse-resistant.

---

## Phase 5 — Tenant-aware policy engine

### Objective
Move from singleton settings to organization-owned, versioned, auditable policy enforcement.

### Files/modules likely affected
- backend/src/routes/settings.js
- backend/src/models/index.js
- backend/src/routes/events.js
- extension detection policy handling
- dashboard policy UI

### Database/model changes
- policy table with org scoping, versioning, status, and effective date
- policy audit log entries
- default policy templates

### API changes
- policy CRUD and versioning endpoints
- policy evaluation API for extension retrieval
- policy rollback endpoint

### Extension changes
- policy cache logic
- offline policy fallback behavior
- policy version validation
- policy refresh scheduling

### Dashboard changes
- org policy management UI
- policy version comparison
- rule toggles and alerting changes

### Security requirements
- policy retrieval must be tenant-scoped
- stale policy must be detected and rejected
- ALLOW/WARN/SANITIZE/BLOCK must behave consistently

### Tests required
- policy enforcement tests for each action
- policy precedence tests
- version rollback tests
- offline cache tests

### Dependencies
- tenant model
- device identity
- event ingestion model

### Exit criteria
- Every policy decision is tenant-aware and validated.

---

## Phase 6 — Data protection

### Objective
Minimize and protect customer security data, while preserving the audit trail necessary for enterprise customers.

### Files/modules likely affected
- backend/src/models/index.js
- backend/src/services/alerting.js
- backend/src/routes/audit-log.js
- backend/src/routes/events.js
- backend/src/services/scoring.js
- storage and backup architecture

### Database/model changes
- retention configuration per tenant
- export metadata and deletion tracking
- encrypted storage requirements for sensitive fields
- schedule for automatic data purge

### API changes
- tenant data export endpoint
- tenant deletion/offboarding API
- retention settings APIs

### Extension changes
- ensure only masked preview leaves the browser
- keep raw detection results local and transient

### Dashboard changes
- data export, retention, and deletion management
- review of sensitive detection metadata display

### Security requirements
- avoid raw secret storage in general-purpose logs
- masked previews only for UI and alerts
- services must separate application secrets from customer security data
- backup encryption and restore validation

### Tests required
- secret scanning tests
- retention enforcement tests
- deletion tests
- export tenant-scoping tests

### Dependencies
- data minimization decision
- retention policy decision
- backup design

### Exit criteria
- Customer data is minimized, tenant-bound, encrypted appropriately, and properly retained or purged.

---

## Phase 7 — Automated security testing

### Objective
Build a repeatable security validation layer before enterprise onboarding.

### Files/modules likely affected
- test suite creation under repository root or backend/test area
- security test harnesses for API and extension flows
- CI configuration outside the app source tree

### Database/model changes
- none directly, though test fixtures may need isolated tenant data sets

### API changes
- security test endpoints for isolated validation only if needed in non-production

### Extension changes
- backend integration tests for extension auth and event validation

### Dashboard changes
- dashboard security view validation and tenant scope checks

### Security requirements
- tests must assert cross-tenant isolation
- tests must assert token/session validation
- tests must assert policy enforcement actions
- tests must assert extension message validation

### Tests required
- authentication tests
- authorization tests
- tenant isolation tests
- event injection tests
- rate-limit tests
- extension tampering tests

### Dependencies
- stable tenant and auth model
- secure event ingestion model
- CI environment

### Exit criteria
- At least the critical production security behaviors are covered by automated tests before release.

---

## Phase 8 — Production infrastructure

### Objective
Provide a production-grade runtime for the platform outside the local prototype environment.

### Files/modules likely affected
- infrastructure files outside source code tree
- deployment manifests
- environment templates
- CI/CD configuration

### Database/model changes
- production database sizing and failover design
- backup and restore logic

### API changes
- none organizationally; runtime environment is the focus

### Extension changes
- update distribution and signing process
- enterprise installation flow

### Dashboard changes
- production frontend hosting and TLS configuration

### Security requirements
- TLS everywhere
- secret manager integration
- separate environments
- logging and monitoring
- incident response procedures

### Tests required
- deployment smoke tests
- secret verification tests
- environment isolation tests
- restore validation tests

### Dependencies
- provider selection
- domain strategy
- compliance / enterprise requirements

### Exit criteria
- Deployment topology is defined, secure, and reproducible.

---

## Phase 9 — Adversarial/runtime validation

### Objective
Run realistic security and resilience checks against the production architecture before customer onboarding.

### Files/modules likely affected
- security test plan documents
- operational runbooks
- incident response procedures

### Database/model changes
- none directly

### API changes
- none directly; validation focuses on runtime behavior

### Extension changes
- validation of message handling and storage tampering

### Dashboard changes
- validation of tenant-scoped UI behavior and data access

### Security requirements
- red-team validation for tenant boundaries
- event spoofing and replay simulation
- extensional abuse simulation
- malicious payload test suite

### Tests required
- adversarial cross-tenant access tests
- rate-limit response validation
- policy bypass tests
- dashboard access isolation tests

### Dependencies
- complete security controls
- production-like environment

### Exit criteria
- Production risk is reduced to acceptable levels and all critical scenarios are exercised.

---

## Phase 10 — Customer onboarding readiness

### Objective
Prepare the platform for real customer deployment only after all security gates are satisfied.

### Files/modules likely affected
- tenant onboarding workflows
- admin operations interfaces
- support and audit documentation
- environment configuration

### Database/model changes
- onboarding metadata and tenant activation records
- org onboarding configuration records
- support and audit retention settings

### API changes
- customer onboarding APIs
- admin role and membership flows
- export and deletion lifecycle flows

### Extension changes
- tenant-specific provisioning and registration workflow
- device lifecycle orchestration

### Dashboard changes
- organization onboarding and policy rollout flows
- admin controls and audit visibility

### Security requirements
- strict tenant separation during onboarding
- secure invite or provisioning model
- separation between platform admin and tenant admin

### Tests required
- onboarding security validation
- tenant creation and isolation tests
- admin permission tests
- export and deletion validation

### Dependencies
- all earlier phase exit criteria met
- production infrastructure ready

### Exit criteria
- A new organization can be onboarded without compromising a different tenant.

---

## Critical dependency ordering

The required sequence is:

1. Secret cleanup
2. Multi-tenant foundation
3. Authentication and authorization
4. Secure extension identity
5. Secure event ingestion
6. Policy engine
7. Data protection
8. Security testing
9. Production infrastructure
10. Runtime validation
11. Customer onboarding readiness

This ordering is intentional: tenant isolation and identity control are security dependencies for all subsequent work.
