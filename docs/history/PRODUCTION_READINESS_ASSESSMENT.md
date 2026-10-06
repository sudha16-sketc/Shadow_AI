# Shadow AI Production Readiness Assessment

## 1. Executive Summary

This repository is a functional prototype and early security tooling demo, not a production-grade multi-tenant SaaS platform. The architecture is a Chrome extension that detects sensitive patterns locally, a Node.js/Express backend that accepts event data and stores it in MongoDB, and a React dashboard that reads aggregated event information.

The current implementation has several major production gaps:

- No verified multi-tenant isolation or organization boundary enforcement.
- The backend accepts unauthenticated event ingestion from the browser extension.
- Client-controlled `userId` values are trusted for event attribution.
- JWT secrets and live-looking external credentials are present in the source tree.
- User authentication is limited to simple JWTs with no refresh rotation or revocation model.
- No CI/CD, no security tests, no multi-tenant tests, and no production deployment topology.
- The browser extension uses a hardcoded localhost backend and no enterprise distribution/update model.

This system is currently best classified as a single-tenant demo or pilot product, not a multi-company SaaS platform ready for production onboarding.

---

## 2. Product Architecture

### Functional summary

- Browser extension monitors AI websites and inputs.
- Detection runs in the browser via inlined regex/keyword logic.
- High-risk detections trigger a warning modal and send a batch event to the backend.
- Backend receives events, resolves a matching user by extension-generated identifier, stores masked metadata, and optionally triggers Slack/email alerts.
- Dashboard shows overview, event logs, users, analytics, settings, and audit logs.

### In-scope components

- Extension: Chrome MV3 browser extension
- Frontend: React + Vite dashboard
- Backend: Node.js + Express API
- Data store: MongoDB via Mongoose
- Alerts: Slack Webhook and SMTP email
- Real-time dashboard: WebSocket broadcast on the backend

### Actual architecture diagram

```text
Employee browser
  |
  v
Chrome Extension (MV3)
  - content.js: local detection + modal
  - background.js: batching + queue + flush
  - storage.sync: userId, settings, session stats
  |
  +--> fetch POST /api/events/batch (HTTP, hardcoded localhost)
  |
  +--> AI sites monitored: OpenAI, Claude, Gemini, Copilot, etc.

Backend API (Express + Node.js)
  - auth routes
  - events routes
  - analytics routes
  - settings routes
  - users routes
  - audit log routes
  - justifications routes
  |
  +--> MongoDB (single database; Org/User/Event models)
  |
  +--> WebSocket broadcasts to dashboard clients
  |
  +--> Slack webhook / SMTP email alerts

Dashboard (React)
  - JWT stored in browser local storage
  - fetches API data with Authorization header
  - WebSocket connection to backend for alerts
```

---

## 3. Repository Inventory

### Browser extension
- Purpose: inspect AI site inputs and flag sensitive content before leakage.
- Language: JavaScript
- Framework/runtime: Chrome extension MV3, DOM + service worker
- Dependencies: none beyond browser APIs
- Production relevance: high
- Communication: fetch to backend, chrome.storage.sync, content script injection

### Dashboard frontend
- Purpose: admin dashboard and user management UI
- Language: JavaScript/React
- Framework/runtime: Vite + React + Tailwind
- Production relevance: high
- Dependencies: React, Zustand, Recharts, Vite
- Communication: HTTPS fetch to backend + WebSocket

### Backend API
- Purpose: authentication, ingestion, analytics, settings, alerts
- Language: JavaScript
- Framework/runtime: Node.js + Express
- Production relevance: high
- Dependencies: Express, Mongoose, JWT, Zod, Winston, nodemailer, ws, bcryptjs
- Communication: HTTP REST and websocket

### Database
- Purpose: persistence for users, org config, events, justifications, audit logs
- Language: MongoDB document store
- Framework/runtime: MongoDB via Mongoose ODM
- Production relevance: high
- Dependencies: MongoDB server
- Communication: mongoose connection

### Workers/background jobs
- Purpose: none implemented beyond event queue flush and alerting calls
- Language: JavaScript
- Runtime: extension service worker + Node process
- Production relevance: low-to-medium
- Dependencies: none beyond fetch

### Policy engine
- Purpose: minimal org settings toggles only
- Language: JavaScript
- Runtime: backend logic in settings and event processing
- Production relevance: medium
- Dependencies: MongoDB

### Detection engine
- Purpose: regex and keyword-based detection for secrets and sensitive data
- Language: JavaScript
- Runtime: extension content script
- Production relevance: high
- Dependencies: browser DOM APIs

### Authentication/authorization
- Purpose: JWT login and role checks
- Language: JavaScript
- Runtime: backend middleware
- Production relevance: high
- Dependencies: jsonwebtoken, bcryptjs

### Infrastructure
- Purpose: local docker-compose for Mongo, backend, frontend
- Language: YAML
- Runtime: Docker Compose
- Production relevance: medium
- Dependencies: Docker

### CI/CD / tests
- Current state: not present in source tree

---

## 4. Actual Architecture

### Extension → backend communication
- background.js sends `POST /api/events/batch` with JSON payload.
- No authentication or tenant ID binding is required.
- Hardcoded backend URL: http://localhost:3001
- No certificate pinning, no mutual TLS, no API key, no signed client identity.

### Extension → AI website interception
- content.js injects into listed AI domains via manifest host permissions.
- It tracks typing/paste events and inspects text for patterns.
- It triggers a modal for high-risk events before user final submission.

### Dashboard → backend communication
- Frontend fetches JSON APIs with Bearer JWT in Authorization header.
- Dashboard also opens a raw WebSocket to `ws://localhost:3001`.
- Auth is stored in browser local storage through Zustand persist middleware.

### Backend → database
- mongoose.connect() to MongoDB between app boot and server start
- Core collections: User, Team, Org, Event, Justification, AuditLog

### Backend → cache / queues
- No Redis cache, BullMQ, or worker queue found.

### Backend → external APIs
- Slack webhook calls for alerts
- SMTP email calls for alerts
- No AI provider API integration found in code

### Deployment topology
- Local dev-only Docker Compose: Mongo, backend, frontend
- No reverse proxy, TLS termination, CDN, secrets manager, or autoscaling infrastructure

### System classification
- This is a modular monolith prototype, not a true microservice architecture.

---

## 5. Multi-Tenant Architecture

### Findings
- There is an `Org` model, `Team` model, and `teamId` on users.
- However, there is no `orgId` or `tenantId` on `User`, `Event`, `AuditLog`, or `Justification`.
- The app uses singleton queries like `Org.findOne()` and `Event.find()` without scoping by tenant.
- There is no tenant-aware middleware, repository layer, DB index, or tenant filter in query paths.

### Important conclusion
This is not multi-tenant. It is effectively a single-tenant application with a pseudo-organization configuration object.

### Tenant isolation status
- Application-level tenant logic: not implemented
- Database-enforced tenant isolation: not implemented
- Multi-tenant boundary guarantee: absent

### Security implication
A user in one organization could potentially access another organization’s data if records were logically separated in a shared deployment. The code does not enforce boundaries.

---

## 6. Identity and Authentication

### Authentication model
- Login route accepts email and password and verifies bcrypt password hash.
- JWT is signed using `jsonwebtoken` with `JWT_SECRET`.
- `role` is included in token.
- Token lifetime: 7d.
- No refresh tokens.
- No token rotation.
- No token revocation list.
- No password reset flow.
- No email verification.
- No device registration or device revocation.

### Security issues
- JWT secret falls back to a default string if missing.
- `backend/.env` contains live-looking credentials.
- JWTs are stored in browser localStorage.
- No cookie security attributes, no secure/httpOnly cookies.
- No CSRF protection is implemented.
- CORS is permissive (`origin: true`, `credentials: true`).

### Browser extension authentication
- Extension makes no authenticated request to the backend.
- Event ingestion is unauthenticated.
- Authentication is not differentiated for extension and dashboard.

---

## 7. Authorization / RBAC

### Roles found
- admin
- manager
- viewer

### Authorization checks
- `requireRole` checks the JWT `role` only.
- No organization scoping, no permission matrix tied to organization membership, no tenant-specific ACLs.

### Risks
- Vertical privilege escalation is possible if a user can self-create or self-promote a role through API behavior in the future.
- No explicit `organization admin` or `platform admin` model exists.
- No server-side authorization against organization membership.

---

## 8. Browser Extension Security

### Manifest and permissions
- Manifest version: 3
- Permissions: tabs, scripting, storage, alarms
- Host permissions: specific AI domains

### Extension security observations
- Content scripts are injected into AI sites only, which is narrow but not strong enough as a security boundary.
- The content script reads the DOM and can inspect user input.
- It stores a generated `userId` in `chrome.storage.sync`.
- It sends event payloads to backend without signature, auth token, or tenant binding.
- The extension has no secure update channel or enterprise management model.

### Notable issue
The modal uses `innerHTML` with values derived from user text and detection labels. That creates a potential DOM XSS / injection vector if malicious content reaches the template.

### Security impact
- Potential bypass of the user-warning flow if content script/malicious code interferes with extension state.
- Server trusts extension-originated data due to lack of verification.
- Extension can be abused to submit fake events or flood the backend.

---

## 9. Detection Engine

### Detection model
- Local detection only in the browser content script.
- Pattern matching uses regex for:
  - AWS access keys
  - Stripe keys
  - GitHub tokens
  - NPM tokens
  - JWTs
  - private keys
  - database connection strings
  - SSN
  - credit card numbers
  - email addresses
  - password/secret patterns
- Keyword heuristics for sensitive phrases like "confidential", "trade secret", etc.

### Output
- `riskScore`
- `severity` (`LOW` / `MEDIUM` / `HIGH`)
- `findingLabels`
- `maskedPreview`

### Result
- Sensitive user input is scanned before network transmission.
- Full input is not sent to the backend.
- The product is designed to minimize raw data leakage, but masking is best-effort and not cryptographically robust.

### Risks
- Regex engine is limited and can miss many obfuscated or encoded formats.
- No canonical normalization or deduplication.
- High false-positive and false-negative risk remains unmeasured.
- Local only detection may be bypassed by input methods or alternative page structures.

---

## 10. Policy Engine

### What exists
- Minimal org-level settings:
  - `blockOnHigh`
  - `requireJustification`
  - `alertOnMedium`
  - `retentionDays`
- Backend settings routes update singleton Org settings.

### What does not exist
- No tenant-scoped policy objects
- No user-specific overrides
- No domain allow/deny policy list by org or user
- No emergency policy or versioning
- No default policy hierarchy

### Failure behavior
- If backend unavailable, extension still continues locally and may lose policy enforcement.
- There is no offline policy cache and no explicit fail-closed/fail-open contract.

---

## 11. Sensitive Data Handling

### Stored data observed
- Event records hold risk metadata plus masked preview and finding labels.
- Full prompt bodies are not stored in schema definitions.
- Logs are not shown to include raw prompts by default.
- However, `maskedPreview` may still include partially disclosed secret-like values; it is not a true sanitization or cryptographic redaction layer.

### Data flow summary
- Local browser detection inspects text
- Masked snippet is sent over network
- Backend stores metadata and masked preview in MongoDB
- Slack/email alerts can include masked preview and labels, not raw content

### Missing protections
- No database encryption-at-rest claim is implemented in the code.
- No explicit transit encryption model beyond HTTPS assumptions.
- No key management or KMS integration described.
- No secure deletion, retention enforcement, or purge process beyond TTL on Event/AuditLog.

---

## 12. API Security

### Endpoint exposure
- `/api/events` and `/api/events/batch` are public and unauthenticated.
- The rest of the API uses JWT auth or role middleware.

### Security issues
- No rate limiting on extension event ingestion beyond API route limit of 500 per minute and login limit of 20 per minute.
- No tenant attribution on event ingestion.
- No event signing or trusted device identity.
- No server-side validation of extension origin/device.
- No explicit pagination or filtering enforcement beyond route code.

---

## 13. Dashboard Security

### Dashboard overview
- Uses `Authorization: Bearer <token>` from browser storage.
- Role-based access is enforced at route level but not by tenant.
- Real-time event alerts via raw WebSocket.

### Risks
- JWT stored in local storage can be read by XSS or compromised browser scripts.
- No client-side authorization beyond UI gating.
- No secure admin check on data fetching beyond JWT role.

---

## 14. Database

### Schema highlights
- User: email, passwordHash, role, department, teamId, extensionUserId, optedOut, isActive
- Org: name, domain, securityScore, Slack/Webhook, alert email, monitoredDomains, settings
- Event: domain, eventType, riskScore, severity, maskedPreview, findingLabels, blocked, justificationId
- Justification: event-linked user reason, approval state
- AuditLog: action, actor, target, changes, IP, user-agent

### Important gaps
- No multi-tenant indexes or tenant identifiers.
- Event TTL set to 30 days but no retention policy governance.
- AuditLog TTL set to 90 days.
- No migration framework or schema governance in the repo.

---

## 15. Redis / Queue

### Findings
- No Redis usage found.
- No queue abstraction found.
- No background workers found.
- Event flush occurs in extension memory and backend handles bursts synchronously.

### Security relevance
- There is no distributed job boundary or tenant-scoped queue consumer.

---

## 16. External AI Providers

### Findings
- No direct backend or extension integration with OpenAI/Anthropic/Gemini APIs was found in the repo.
- The product monitors these AI domains but does not call their APIs.
- The product is a detection and enforcement layer around AI-website usage, not an AI service itself.

---

## 17. Secrets

### Files with secrets or credentials
- backend/.env — contains JWT secret, MongoDB URI, SMTP credentials, Slack webhook, alert email
- docker-compose.yml — references environment variables for JWT_SECRET, SMTP values, etc.

### Status
- High risk: live-looking credentials are present in the source tree and should be treated as compromised until rotated and cleaned.
- Remediation required: rotate secrets, remove committed secret files, move to a secret manager, and prevent them from entering source control.

---

## 18. Dependencies

### Backend package manifest
- Node.js runtime: v20 in Dockerfile
- Package manager: npm
- Dependencies include Express, Mongoose, JWT, bcryptjs, nodemailer, ws, Zod, Helmet, rate limiter.

### Frontend package manifest
- Vite + React + Recharts + Zustand + Tailwind

### Security note
- Dependency versions are not evaluated here beyond manifest inspection. No vulnerability scan was run as part of this phase.

---

## 19. Infrastructure

### Existing repo support
- Dockerfiles for backend and frontend
- docker-compose.yml for MongoDB, backend, frontend
- No Kubernetes, Terraform, CloudFormation, or deployment manifests

### Production requirement
- Reverse proxy / TLS termination
- Managed PostgreSQL or MongoDB cluster if used in production
- Secrets manager
- Monitoring and log aggregation
- CI/CD pipeline
- Backup and restore process
- Extension distribution strategy

---

## 20. Scalability

### Current state
- In-memory event queue in browser extension
- In-memory WebSocket client set on server
- No horizontal scaling strategy
- No Redis or shared session store
- No stateless model for extension configuration or policy state

### Scaling risk
- Multiple backend instances would not share WebSocket broadcasts or local in-memory sets.
- Policies are not centralized or cached in a multi-instance-safe way.
- Event ingestion may be limited by synchronous processing and database writes.

---

## 21. Rate Limiting / Abuse Protection

### Present
- Express rate limiter for `/api/auth` and `/api/events`

### Missing
- Per-user, per-organization, per-device controls
- IP reputation controls
- Login lockouts
- Abuse protection for extension event flooding
- Device registration and revocation

### Impact
- Event flooding from one compromised browser or fake extension could overwhelm the backend.

---

## 22. Browser Extension Distribution

### Current repo support
- Manifest is present; Chrome extension loads unpacked in dev.
- No Chrome Web Store packaging, enterprise distribution, or managed browser policy support is defined.
- No update mechanism other than manual installation from local files.

### Production requirement
- Enterprise distribution model
- Signed extension package
- Versioning and rollback process
- Tenant configuration flow

---

## 23. Organization Onboarding

### Current state
- There is no org creation workflow in the app.
- Settings route creates a singleton `Org` document if missing.
- No invitation flow, no tenant activation, no onboarding pipeline.

### Conclusion
- The product is not yet multi-company onboarding ready.

---

## 24. User / Device Lifecycle

### Current state
- Users can login and signup.
- Roles are admin/manager/viewer.
- Extension creates a `userId` in browser storage.
- No device revocation, no ability to revoke extension access, no re-registration flow.

### Risk
- A stolen browser or extension can continue generating events under the same device identifier.

---

## 25. Audit Logging

### Present
- AuditLog model exists.
- It captures action, actor, target, changes, IP, and user-agent.
- Some admin actions log to audit trail.

### Missing
- Secure log immutability
- Retention enforcement beyond TTL
- Centralized SIEM or external SIEM integration
- Org-scoped audit access

---

## 26. Observability

### Present
- morgan request logging
- winston logger
- health endpoint at `/health`
- WebSocket alerts
- Slack/email alerts

### Missing
- structured log sink (e.g., OpenTelemetry, ELK, Loki, Datadog)
- metrics collection
- tracing
- alerting on tenant security anomalies
- request correlation IDs

---

## 27. Backup / Disaster Recovery

### Present
- MongoDB volume in docker-compose
- Container restart strategy exists

### Missing
- Backup schedule, encryption, retention, restore validation, RTO/RPO definition
- Disaster recovery runbooks

### Status
- Configured only at a superficial volume level; not production-proven.

---

## 28. Testing Inventory

### Findings
- Package scripts include Jest in the backend package, but the source tree contains no application test files.
- No API, auth, security, extension, multi-tenant, or E2E tests were found.
- No CI workflow files were found.

### Conclusion
- Test coverage is effectively zero.
- The repository does not currently prove tenant isolation or security correctness.

---

## 29. Detection Test Coverage

### What exists
- Detection engine logic is present in the extension code.
- No automated tests were found for detector behavior.

### Missing test coverage
- API keys
- passwords
- JWTs
- cloud credentials
- PII
- source code
- prompt injection
- malicious instructions
- agent actions
- obfuscated secrets
- Unicode and whitespace variations
- false positives/negatives

---

## 30. Performance / Scale

### Observed characteristics
- Detecting patterns locally on each input can be CPU-heavy but bounded.
- Batch flushing is one-minute-only, but event ingestion flows are unthrottled at the server layer beyond basic route limits.
- MongoDB queries are mostly aggregate queries over events; scaling will depend on index strategy and volume.

### Unknowns
- expected traffic, concurrency, and retention volume are not defined in the repo.

---

## 31. Enterprise Technical Requirements

### Technical capability present
- Event logging
- Risk scoring
- Admin dashboard
- Some alerting
- Basic user management

### Technical capability missing
- Strong tenant isolation
- Secrets manager integration
- Data retention governance
- Secure extension distribution
- Enterprise onboarding and admin controls
- Data export and purge controls
- Formal security logging pipeline

### Legal / regulatory compliance
- Not evidenced; no formal compliance artifact or rigorous control framework was found.

---

## 32. Previous Security Findings

### Evidence-based current status
- Previous claims of “multi-tenant SaaS” are not backed by current code.
- Previous assumptions of secure private data handling are partially supported only for local detection and masked previews, but not for transport, storage, secret management, or tenant isolation.
- The current code does not provide runtime validation of tenant boundaries or auth trust assumptions.

---

## 33. Production Infrastructure Requirements

### Required external infrastructure
- Managed MongoDB
- TLS termination / reverse proxy
- Host for frontend dashboard
- Host for backend API
- Email service for alerts
- Slack integration
- Secret manager
- Monitoring/log aggregation
- Backup storage
- CI/CD runner
- Browser extension distribution channel

### Current repo support
- Local Docker Compose only; no production deployment manifests

---

## 34. Questions Requiring User Answers

### A. Product
- What is the exact target customer and deployment model?
- Is the product intended for single-company pilot only or multi-tenant B2B SaaS from day one?

### B. Organizations / tenants
- How many tenants are expected in v1?
- What is the desired tenant onboarding model?

### C. Users
- Is there an identity provider or SSO requirement?
- Are users employee-managed in the tenant, or directory-synced?

### D. Authentication
- Is SSO required?
- Are refresh tokens acceptable, or must we use session cookies and rotation?

### E. Browser extension
- Will the extension be distributed through Chrome Web Store or enterprise force-install?

### F. Detection
- What alert thresholds are acceptable for false positives?
- What detection categories are required in v1?

### G. Policies
- Are policies per organization, per user, or both?

### H. Data retention
- What retention period is required by customer contract?

### I. Infrastructure
- Which cloud provider will be used?
- Are there requirements for HA, backups, and DR?

### J. Database
- Is MongoDB acceptable for production, or must there be a managed relational store?

### K. Redis/queues
- Is an async queue required for high-volume event ingestion?

### L. External AI providers
- Will the product integrate with AI APIs directly in future releases?

### M. Extension distribution
- Is enterprise force-install required?

### N. Monitoring
- Is SIEM or log platform already available?

### O. Backups
- What are the required RPO/RTO targets?

### P. Incident response
- Who owns incident response and secret rotation?

### Q. Expected scale
- What is the expected peak event volume per tenant?

### R. Enterprise requirements
- Are there requirements for SSO, SCIM, audit exports, data residency, or DLP retention compliance?

---

## 35. Production Readiness Matrix

| Area | Current State | Evidence | Production Requirement | Status |
|---|---|---|---|---|
| Multi-tenant isolation | Missing | singleton Org / Event queries | Mandatory | BLOCKED |
| Authentication | Basic JWT only | auth.js, localStorage | Required | CONFIGURATION_REQUIRED |
| Authorization | Role-only checks | requireRole | Required | IMPLEMENTED_NOT_VALIDATED |
| Browser extension security | Prototype | hardcoded localhost, unverified origin | Required | BLOCKED |
| Detection engine | Local regex engine | content.js | Required | IMPLEMENTED_NOT_VALIDATED |
| Policy engine | Minimal singleton settings | settings.js | Required | IMPLEMENTED_NOT_VALIDATED |
| Data protection | Partial masking | maskedPreview present | Required | CONFIGURATION_REQUIRED |
| API auth for extension | Missing | /api/events public | Mandatory | BLOCKED |
| Database | MongoDB working | Mongoose models | Required | CONFIGURATION_REQUIRED |
| Observability | Basic logs only | morgan + winston + health | Required | CONFIGURATION_REQUIRED |
| CI/CD | Missing | no workflow files | Required | MISSING |
| Tests | Missing | no test files found | Required | MISSING |
| Production infra | Not defined | docker-compose only | Required | MISSING |
| Backups/DR | Not defined | no runbook | Required | MISSING |

---

## 36. Critical Production Blockers

### 1. No tenant isolation
- Evidence: `Org.findOne()` and event queries without org filtering
- Impact: cross-tenant data leakage risk
- Component: backend models and API routes
- Code change required: yes
- Infrastructure change required: yes, tenant-aware DB strategy
- Runtime validation required: yes

### 2. Unauthenticated event ingestion
- Evidence: `/api/events` and `/api/events/batch` are public routes
- Impact: forged or spammed events, fake event injection
- Component: backend event routes
- Code change required: yes
- Infrastructure change required: no immediate, but auth scheme required
- Runtime validation required: yes

### 3. Client-trusted tenant/user identity
- Evidence: `userId` from extension is accepted as input and looked up directly
- Impact: user spoofing and tenant confusion
- Component: extension + backend event processing
- Code change required: yes
- Infrastructure change required: no
- Runtime validation required: yes

### 4. Secret exposure in source tree
- Evidence: backend/.env exists with JWT secret, MongoDB URI, SMTP credentials, Slack webhook, and email address
- Impact: credential compromise and data exfiltration risk
- Component: repo configuration
- Code change required: yes, remove from source and rotate secrets
- Infrastructure change required: yes, move to a secrets manager
- Runtime validation required: yes

### 5. Browser extension security / DOM XSS risk
- Evidence: modal uses dynamic injection with `innerHTML` based on detection content
- Impact: malicious content or script execution inside page context
- Component: extension content script
- Code change required: yes
- Infrastructure change required: no
- Runtime validation required: yes

### 6. Local-only security assumptions
- Evidence: JWT stored in localStorage, no secure cookie or server-side revocation
- Impact: theft of tokens or stale sessions
- Component: frontend auth layer
- Code change required: yes
- Infrastructure change required: no
- Runtime validation required: yes

### 7. Missing production deployment and runtime controls
- Evidence: docker-compose only; no reverse proxy, TLS, monitoring, backup strategy, or CI/CD
- Impact: production cannot be securely operated
- Component: infrastructure
- Code change required: no at this phase, but new infrastructure is required
- Infrastructure change required: yes
- Runtime validation required: yes

### Non-blocking hardening items
- Add explicit structured logging and request correlation IDs
- Reduce extension permissions and restrict host coverage
- Validate false-positive and false-negative detection quality
- Add retention metadata and deletion workflow
- Add WebSocket auth and origin validation
- Harden CORS policy
- Implement logout invalidation and password reset flow

---

## 37. Production Roadmap

### STAGE 0 — PRODUCT / SECURITY DECISIONS
- Prerequisites: deciding whether the product is single-tenant pilot or true multi-tenant SaaS
- Tasks: define tenancy model, security goals, risk thresholds, deployment target
- Expected result: concrete product security baseline
- Validation: review with stakeholders and security lead
- Failure condition: no agreed tenant model
- Rollback: pause rollout

### STAGE 1 — MULTI-TENANT FOUNDATION
- Prerequisites: tenant model decision
- Tasks: add tenant keys and enforcement at DB and API levels
- Expected result: tenant-scoped queries and allowed record ownership
- Validation: security tests verifying cross-tenant isolation
- Failure condition: any cross-tenant query can succeed
- Rollback: disable tenanted features

### STAGE 2 — AUTHENTICATION / AUTHORIZATION
- Prerequisites: decision on SSO and token model
- Tasks: rotate secrets, secure JWT handling, enforce RBAC, add refresh/session lifecycle
- Expected result: secure auth and authorization
- Validation: auth tests and attack simulation
- Failure condition: token theft or privilege bypass
- Rollback: revert to short-lived local session model only for pilot

### STAGE 3 — EXTENSION SECURITY
- Prerequisites: secure distribution plan
- Tasks: harden extension messaging, add origin validation, reduce permissions, add enterprise distribution
- Expected result: trusted extension model
- Validation: extension security review and local exploitation tests
- Failure condition: client can forge or bypass policy
- Rollback: disable extension distribution until fixed

### STAGE 4 — DETECTION ENGINE
- Prerequisites: detection requirements
- Tasks: define heuristics, benchmark false positives, add normalization/deduplication
- Expected result: reliable detection thresholds
- Validation: test matrix execution
- Failure condition: major false-positive or false-negative issues
- Rollback: keep legacy detection mode with safe mode

### STAGE 5 — POLICY ENGINE
- Prerequisites: approved policy model
- Tasks: define per-tenant policy hierarchy and enforcement semantics
- Expected result: enforceable policy decisions
- Validation: policy test suite
- Failure condition: conflicting or unenforced policies
- Rollback: revert to safe default deny / warn mode

### STAGE 6 — DATA PROTECTION
- Prerequisites: approved retention and masking model
- Tasks: add deletion, retention, encryption strategy, and secret handling hardening
- Expected result: data protection controls in place
- Validation: secret scanning and backup restore validation
- Failure condition: raw secret exposure or unscoped retention
- Rollback: suspend ingestion until controls are fixed

### STAGE 7 — INFRASTRUCTURE
- Prerequisites: cloud and runtime decisions
- Tasks: set up managed MongoDB, TLS, ingress, secrets manager, backups, monitoring
- Expected result: production-grade environment
- Validation: smoke tests and security checks
- Failure condition: no managed credentials or backup plan
- Rollback: reduce to isolated test environment

### STAGE 8 — OBSERVABILITY
- Prerequisites: production runtime
- Tasks: central logging, tracing, alerting, dashboards, anomaly detection
- Expected result: production visibility
- Validation: simulated outage and event failures
- Failure condition: no alerting or troubleshooting path
- Rollback: no release to production

### STAGE 9 — SECURITY TESTING
- Prerequisites: core security controls implemented
- Tasks: run auth, tenant, extension, and abuse tests
- Expected result: proof of tenant and request integrity
- Validation: red-team and multi-tenant validation
- Failure condition: any cross-tenant or auth bypass
- Rollback: block production release

### STAGE 10 — PERFORMANCE / LOAD TESTING
- Prerequisites: stable app and infra
- Tasks: simulate high event volume and scaling
- Expected result: identified bottlenecks and scaling strategy
- Validation: load tests
- Failure condition: ingestion failures, worker saturation, broken DB performance
- Rollback: reduce tenant volume or disable high-throughput features

### STAGE 11 — BACKUP / DISASTER RECOVERY
- Prerequisites: production environment and retention policy
- Tasks: validate backups, restoration, and secret recovery
- Expected result: documented DR plan
- Validation: restore drill
- Failure condition: unable to restore data or secrets
- Rollback: keep service in restricted mode

### STAGE 12 — ENTERPRISE ONBOARDING
- Prerequisites: secure tenant and auth foundation
- Tasks: onboarding flows, admin controls, data privacy workflow, deployment templates
- Expected result: repeatable and auditable onboarding
- Validation: dry-run onboarding for pilot tenant
- Failure condition: onboarding creates security gaps
- Rollback: stop onboarding new companies

### STAGE 13 — PRODUCTION RELEASE
- Prerequisites: all earlier stages passed
- Tasks: final release review, security signoff, production cutover
- Expected result: controlled launch
- Validation: final smoke test and signoff
- Failure condition: unresolved blockers or failed validation
- Rollback: keep service in pre-production or rollback to prior stable release

---

## 38. Command Inventory

### Install
- npm install (SAFE)
- docker compose build (SAFE)

### Build
- npm run build (SAFE)
- docker compose up --build (SAFE in controlled environment)

### Lint
- npm run lint (if configured; not present here) (SAFE)

### Typecheck
- not configured in repo (UNKNOWN)

### Unit tests
- npm test (SAFE if tests exist; currently no test suite)

### Integration tests
- not configured (UNKNOWN)

### Security tests
- dependency scanners, auth tests, tenant isolation tests (REQUIRES APPROVAL before use in production)

### Extension build
- not configured (UNKNOWN)

### Extension packaging
- not configured (UNKNOWN)

### Database migration
- no migration system found (UNKNOWN)

### Database verification
- manual MongoDB validation needed (REQUIRES APPROVAL)

### Docker startup
- docker compose up (SAFE for local/dev only)

### Health checks
- curl /health (SAFE)

### Production build
- no production build manifest found (UNKNOWN)

### Vulnerability scanning
- npm audit / osv scanner / Snyk (SAFE for non-production only, but risk of exposure if run against live env)

### Dependency scanning
- npm audit / repo scanner (SAFE for non-production only)

---

## 39. Final Production Gate

The repository is not ready for production onboarding of real companies. The product is still a prototype with important security boundaries missing.

Production release should be blocked until the following are true:

- tenant isolation is implemented and proven
- unauthenticated event ingestion is closed
- all secrets are removed from the repo and rotated
- JWT handling is hardened and verified
- extension security is validated
- secure deployment infrastructure is in place
- CI, tests, and security validation exist
- backup/restore and monitoring are defined

---

## 40. Runtime Validation Requirements

Before any production or pilot deployment, the following must be validated in a non-production environment:

- user-role enforcement across all routes
- tenant boundary enforcement on user/event/analytics/exports
- ability to forge or spoof event ingestion without valid credentials
- JWT expiration and revocation behavior
- WebSocket auth and origin validation
- extension user impersonation and bypass tests
- database access patterns for cross-tenant leakage
- secret rotation and repository cleanup
- backup restore process
- event flooding rate tests
- extension install/update process

---

## 41. Production Roadmap Summary

1. Decide tenancy and enterprise architecture.
2. Implement tenant-bound data model and API filtering.
3. Harden authentication and authorization.
4. Secure the extension and distribution model.
5. Quality-test detection and policy engine.
6. Add secret management, retention controls, and backups.
7. Stand up production infrastructure and CI/CD.
8. Validate with red-team and load tests before release.

---

## 42. Command Inventory and Safety Summary

- SAFE: npm install, docker compose up for local dev, health checks, package builds in controlled non-prod environments
- NON-PRODUCTION ONLY: dependency vulnerability scans, local app runs, test execution
- DESTRUCTIVE: any command that deletes data, secrets, or database contents
- REQUIRES APPROVAL: production deployments, credential rotation, secret cleanup in live environments

---

## Final Conclusion

This repository is a promising proof-of-concept but not a production-ready multi-tenant SaaS platform. It requires a significant hardening effort before onboarding real customers or organizations. The highest-priority gaps are tenant isolation, event authentication, secret management, and deployment/operational security.
