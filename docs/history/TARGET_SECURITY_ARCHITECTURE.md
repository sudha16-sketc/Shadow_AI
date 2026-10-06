# Target Security Architecture for Shadow AI

## Scope and framing

This document describes the target production architecture for Shadow AI as a multi-tenant B2B SaaS security product.

It deliberately separates:

- CURRENT: what the repository demonstrates today
- TARGET: what the production system should become
- GAP: what is missing between current state and target state
- IMPLEMENTATION: the deterministic work required to close the gap

## CURRENT

The current repository is a prototype: a browser extension, a Node.js API, MongoDB storage, and a React dashboard. The assessment documents show that the system does not yet enforce tenant isolation, authenticated extension event ingestion, or production-grade secret management.

## TARGET

Shadow AI should operate as a tenant-aware security platform where each organization owns its own users, devices, policies, events, dashboards, and administrative configuration. The system must ensure that tenant data is isolated by policy and by architecture, not by shared assumptions in application code alone.

## A. System architecture

### High-level architecture

```text
Authenticated User / Admin
        |
        v
Browser Dashboard (React)
        |
        v
HTTPS API (Backend)
  - AuthN/AuthZ
  - Tenant Resolution
  - Event Ingestion
  - Policy Retrieval
  - Analytics + Admin APIs
        |
        +--> Tenant-scoped Database
        +--> Secret Manager
        +--> Audit/Log Pipeline
        +--> Alerting / Monitoring
        |
        v
Chrome Extension (MV3)
  - local detection engine
  - policy cache
  - device identity
  - secure event submission
        |
        v
AI Websites / User Input Surface
```

### Security boundaries

1. Browser boundary
   - The extension runs in a user-controlled browser environment.
   - It must never be trusted as an authority for tenant identity, permissions, or data access.

2. Extension-to-API boundary
   - The extension must authenticate as a registered device/extension instance for a tenant.
   - All event ingestion must be validated server-side.

3. API boundary
   - The API must resolve authenticated identity and tenant context before any data access.
   - Authorization decisions must be enforced on every request.

4. Database boundary
   - The database must enforce tenant ownership or the API must require tenant-scoped filters on every query.
   - This must not rely on application conventions alone.

5. Dashboard boundary
   - Admin and security views must operate within the authenticated organization context.
   - Client-side UI cannot be the only enforcement boundary.

6. Admin / platform boundary
   - Platform-level administrative functions must be separated from tenant administrative functions.

---

## B. Multi-tenancy

### Ownership model

```text
Organization
 ├── Users
 ├── Devices / Browser Extensions
 ├── Policies
 ├── Security Events
 ├── Audit Logs
 ├── Settings
 ├── Admin Roles
 └── Data Retention / Export Controls
```

### Tenant model

The production model must be built around explicit tenant ownership:

- Organization is the top-level tenant boundary.
- Users belong to one organization.
- Devices belong to one organization.
- Policies belong to one organization.
- Events belong to one organization.
- Audit logs belong to one organization.
- Dashboard contexts are organization-scoped.

### Tenant context flow

```text
Authenticated Identity
        ↓
Trusted Tenant Context
        ↓
Authorization
        ↓
Tenant-Scoped Data Access
```

### Critical rules

- A user must not be able to access another organization’s data simply because the record shares an ID format or app route pattern.
- The tenant boundary must be resolved from trusted auth context or server-validated device context, not from a browser-supplied value.
- Every data access path must include tenant enforcement: read, write, search, export, aggregation, device lookup, policy retrieval, and audit access.
- `organizationId` alone is not sufficient if the application does not enforce it on every query path.

### Tenant resolution sources

Trusted tenant context can come from:

- authenticated JWT claims validated by the server
- authenticated session claims tied to user and organization
- authenticated device registration bound to an organization
- server-side lookup tables that map user or device to organization

### Explicit non-trust list

The following must never be trusted directly from browser or client input:

- `organizationId`
- `tenantId`
- `userId`
- `deviceId`
- `policyId`
- any client-supplied object that claims to represent another tenant’s record

---

## C. Authentication and authorization

### User authentication

Target design:

- Email/password authentication for dashboard and admin users
- server-side password hashing using a strong adaptive algorithm
- optional enterprise SSO integration later
- secure session issuance after successful auth
- short-lived access token and refresh token separation

### Token strategy

Required design principles:

- Access tokens should be short-lived.
- Refresh tokens should be rotated and stored securely.
- Tokens must carry minimal claims, including user identity and organization scope.
- Token verification must happen on the server.
- Revocation must be supported for logout and suspicious activity.

### Password and security handling

- Passwords must be hashed server-side.
- No plaintext or reversible password handling in logs.
- No password storage in browser extension or frontend local state beyond the session flow.
- Password resets and account lockout must be handled centrally.

### Refresh/session lifecycle

- Access token issued on login
- Refresh token issued separately
- Refresh token rotation on use
- Revoke on logout and suspected compromise
- Support for token invalidation on password change, role change, or device revoke

### Authorization model

Authorization must be layered:

1. Authentication
2. Tenant resolution
3. Role evaluation
4. Resource ownership / permission check
5. Data access filtering

### Role model

At minimum, the platform should support:

- Platform admin
- Organization admin
- Security admin
- Manager
- Employee / user
- Viewer

The exact role model must be mapped to production access requirements. The system must never treat organization membership as an implicit authorization grant without checking role and resource ownership.

### Organization-level authorization

- Users can only act within their tenant context.
- Organization administrators manage only members and policies in their tenant.
- Security admins may see tenant-scoped events, but not cross-tenant data.
- Platform admins are a separate trust boundary and must be explicitly scoped.

### Extension/device authentication

The browser extension is not a trusted user. It must authenticate as a device or extension instance bound to a tenant and user context.

Requirements:

- device registration before event submission
- device identity bound to organization
- token storage in extension secure storage
- token rotation on renewal
- device revocation support
- extension cannot impersonate another user or organization

### What must never be trusted from the browser/client

- raw `userId`
- raw `organizationId`
- raw `deviceId`
- extension-generated claims about tenant membership
- any client-side permission state
- any browser-provided session claims that are not verified by the backend

---

## D. Extension security

### Target extension design

The extension should operate as a trusted but unprivileged local security agent. It is never a source of truth for tenant authorization.

### Required protections

1. Device registration
   - Each extension instance registers with the backend as a device for a tenant.
   - The backend issues a device-specific credential.
   - Device activation is tied to a tenant, user, and installation context.

2. Token storage
   - Tokens must be stored in secure extension storage, not in shared page scripts or unprotected browser storage.
   - Tokens must be scoped and rotated.

3. Token rotation
   - Access tokens rotate regularly.
   - Refresh tokens rotate on use.
   - Device token revocation is supported.

4. Event signing or authentication
   - Event payloads should be authenticated with a device-bound credential or signed request token.
   - The server must validate signature, device, tenant, and timestamp.
   - This prevents straightforward event forgery and replay.

5. Replay protection
   - Include nonce, timestamp, or event hash validation.
   - Require idempotency keys or deduplication for significant event submissions.

6. Message validation
   - The content script and background script must validate message origin, type, and payload format.
   - Content-script messages must not be accepted without strict schema checks.

7. Content script vs background script boundaries
   - Content script should be limited to local detection and page interactions.
   - The background script should own network and storage operations.
   - Sensitive logic should remain isolated from page DOM.

8. DOM security
   - Avoid direct string injection into DOM APIs whenever values originate from user input.
   - Use safe text insertion rather than `innerHTML` for content derived from detected data.
   - The extension must not execute code from user text.

9. CSP and content isolation
   - The extension’s pages should avoid unsafe inline scripts.
   - No arbitrary execution of downloaded scripts.
   - Avoid unsafe host-level injection into AI pages.

10. Handling of sensitive information
    - The extension must never persist raw sensitive content beyond the minimum necessary for local evaluation.
    - Masking must be deterministic and must not expose re-usable raw values.
    - Only masked previews, labels, and metadata should be sent externally.

### Realistic security posture

A browser extension cannot be made completely tamper-proof. The production target is: strong authentication, strict backend validation, limited permissions, device-bound credentials, and robust detection outputs with no raw secret transmission.

---

## E. Event ingestion

### Secure event flow

```text
Extension
   ↓
Authenticated Request
   ↓
API Validation
   ↓
Tenant Resolution
   ↓
Authorization
   ↓
Schema Validation
   ↓
Rate Limiting
   ↓
Event Storage
   ↓
Dashboard
```

### Required event fields

The server must require a minimum set of fields, such as:

- event type
- timestamp
- tenant or device binding
- device ID or extension instance ID
- event category/severity
- detection labels
- risk score
- masked preview or redacted snippet
- domain / AI application source

### Server-generated fields

The backend must generate or enforce:

- authenticated organization context
- device-to-tenant resolution
- event ingestion timestamp
- server-side event ID
- ingestion validation result
- deduplication / idempotency metadata
- rate-limit metadata
- audit correlation IDs

### Client-provided fields that must not be trusted

- tenant ID
- organization ID
- user ID
- device ID
- risk score
- severity
- any content-based claim that affects policy decisions
- any field used to control access or authorization

### Rate limiting and abuse controls

- Per-device, per-user, per-organization, and global limits should be enforced.
- Request size limits must be enforced.
- Batch endpoints must have strict payload limits.
- Event ingestion must reject malformed JSON and oversize payloads.

### Idempotency and replay protection

- Event ingestion must support idempotency keys.
- Duplicate events should be detected and deduplicated.
- Replay attempts should be rejected when timestamps, nonce values, or device signatures do not match server rules.

### Payload limits

The event ingress layer must define:

- max request body size
- max events per batch
- max per-event payload size
- max detection label count
- max preview length

### Abuse prevention

- device fraud detection
- suspicious burst detection
- per-tenant ingestion quotas
- server-side correlation of device identity and user identity
- detection of repeated invalid submissions

---

## F. Detection engine

### Current repository detection approach

The current assessment indicates that detection is primarily performed in the browser extension using regex and keyword heuristics. It includes categories such as:

- API keys
- passwords and secrets
- PII
- proprietary/confidential text
- prompt injection indicators
- risky agent actions
- sensitive code fragments

### Production architecture target

The detection engine remains local-to-the-browser for immediate enforcement, but the platform should support a layered model:

- local detection in the extension for user-time blocking or warning
- server-side policy evaluation using the same detection metadata
- tenant-specific detector configuration and thresholds
- auditing of detection results without storing raw content

### Detection categories to support

- API keys and tokens
- password and credential matches
- PII and sensitive identifiers
- proprietary code and confidential text
- prompt injection patterns
- malicious instructions and risky agent behavior
- encoded and obfuscated secrets
- Unicode / whitespace / case variations

### False positives and false negatives

The target production system must explicitly track:

- false positive rate by category
- false negative rate by category
- tuning behavior per organization
- alert suppression for known safe patterns
- exception handling for real enterprise use cases

### Adversarial bypasses

The system must assume adversarial content and handle:

- obfuscation
- encoded payloads
- split secret fragments
- case and whitespace variations
- mixed Unicode characters
- prompt/instruction manipulations
- malicious content that attempts to bypass content scans

---

## G. Policy engine

### Tenant-aware policy model

The policy engine must support organization-level policy objects that are:

- tenant-scoped
- versioned
- auditable
- cached but refreshable
- safe to roll back

### Policy hierarchy

Recommended precedence order:

1. Platform default policy
2. Organization policy
3. Group/team policy if supported
4. User override if supported
5. Device override if technically required

### Policy actions

- ALLOW
- WARN
- SANITIZE
- BLOCK

### Policy categories

- secret detection thresholds
- PII detection thresholds
- prompt injection handling
- risky agent action handling
- domain allow/deny lists
- AI site allow/deny lists
- user or device exceptions
- organization-specific retention and reporting settings

### Policy updates and versioning

- Policy updates must create a new version.
- Policy changes must be auditable.
- Policy changes must propagate to the extension with validation and rollback support.
- Offline extension behavior must be explicit: fail-safe or fail-open based on policy decision and risk model.

### Policy caching

- The extension may cache the active policy for offline use.
- The cache must be versioned and signed if used for enforcement.
- Stale policies must not be treated as trusted indefinitely.

### Policy rollback

- Previous policy versions should be retrievable.
- Rollback must preserve auditability.
- Rollback must not cross tenant boundaries.

---

## H. Data protection

### Data minimization

Rules:

- Only collect the minimum set of data needed for detection and auditing.
- Prefer metadata, risk scores, labels, and masked previews over raw content.
- Do not store raw secrets unless a legally justified and explicitly approved exception exists.

### Masked previews

- Masked values must show partial evidence without exposing raw content.
- Use deterministic masking, not ad hoc truncation.
- Masked values must be safe for include in dashboards and alerts.

### Encryption in transit

- All API and dashboard traffic must use TLS.
- Internal service-to-service traffic must also use encrypted channels where applicable.
- Browser-to-API and API-to-database communications must not rely on insecure network assumptions.

### Encryption at rest

- Data at rest must be protected using managed encryption standards and key management.
- Secret material must be kept out of low-trust data stores.
- Database encryption must be part of the production design, not a later assumption.

### Secrets management

The system must distinguish:

- Application secrets: JWT signing keys, service credentials, webhook secrets
- Customer security data: secrets, PII, proprietary content, code snippets
- Authentication credentials: username/password, SSO secrets, API tokens
- Telemetry: usage metrics, event metadata, risk metadata
- Logs: operational, security, audit logs

Application secrets and customer security data must have different controls and lifecycle requirements.

### Retention and deletion

- Retention periods must be tenant-configurable and auditable.
- Data deletion must be supported for tenant offboarding or policy changes.
- Delete operations must propagate to all tenant-owned records.
- Logs and exported data must follow the same retention rules.

### Organization data export

- Organization admins should be able to export tenant data in a controlled and auditable manner.
- Exports must be tenant-scoped and not include other organizations’ data.

### Auditability

- Policy changes, admin changes, configuration changes, and event handling must be logged.
- Audit logs must be tied to user identity, tenant, timestamp, and source.
- Audit logs must be protected from tampering.

### Backup protection

- Backups must be encrypted and access-controlled.
- Restore processes must be tested and documented.
- Backup access must follow tenant isolation rules as well.

---

## I. Production infrastructure

The target infrastructure is provider-neutral until environment decisions are made.

### Core services

- API deployment
- dashboard deployment
- database service
- reverse proxy / load balancer
- TLS termination
- secrets manager
- centralized logging and observability
- alerting / monitoring
- backup service
- CI/CD pipeline
- environment separation

### Production deployment model

Recommended architectural pattern:

- multiple stateless backend instances behind a load balancer
- managed database with failover and backups
- centralized log ingestion
- separate dev/test/staging/prod environments
- tenant-scoped configuration storage per environment
- separate secrets per environment

### Environment separation

Required:

- development
- test
- staging
- production

Each environment must have isolated credentials, isolated data, isolated monitoring, and explicit change approval gates.

### Security operational requirements

- TLS everywhere
- least-privilege access for operators
- no plaintext secrets in repositories, artifacts, or logs
- environment-specific key rotation
- incident response procedure
- backup restore test plan

---

## Implementation note

This document defines the target architecture only. It does not claim that the repository already implements this state.

The repository currently demonstrates a prototype and is missing the production-grade controls described above. The gap must be closed in stages, with security validation before tenant onboarding.
