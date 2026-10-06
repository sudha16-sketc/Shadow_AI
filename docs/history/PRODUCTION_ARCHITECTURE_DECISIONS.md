# Production Architecture Decisions for Shadow AI

## Decision 1 — Shadow AI uses a true multi-tenant SaaS architecture from day one.

- Decision: The product will be designed as a true multi-tenant SaaS platform from the initial production architecture, not as a single-tenant application with tenant-like labels.
- Rationale: The target product description explicitly requires multiple organizations/customers to operate independently; cross-tenant isolation is a baseline security requirement.
- Security impact: Prevents tenant data leakage, config bleed, and cross-organization visibility. It also reduces the risk of architecture rework after early customer onboarding.
- Implementation consequence: All user, device, policy, event, dashboard, and audit data must be modeled and accessed with an explicit tenant boundary. The application must resolve tenant context before all data access decisions.
- Open questions: None at the architecture level; the remaining work is implementation and validation.

## Decision 2 — Tenant context must be server-authoritative: Identity → Trusted Tenant Context → Authorization → Tenant-Scoped Data Access.

- Decision: Tenant context must flow from the authenticated identity through server-validated tenant resolution, not from a client-supplied field or extension-generated value.
- Rationale: A client cannot be trusted to assert tenant membership, role, policy identity, device ownership, or permissions. This is central to preventing privilege confusion and tenant spoofing.
- Security impact: Prevents tenant impersonation, cross-tenant access, and simple IDOR-style escalation by tampering with request metadata.
- Implementation consequence: The backend must resolve tenant context from secure identity and device registration, then enforce authorization before querying or writing any tenant-owned record.
- Open questions: Exact source of tenant context during extension registration and dashboard session issuance remains an implementation detail to confirm during design review.

## Decision 3 — The browser extension is never trusted for tenantId, userId, role, policy identity, or permissions.

- Decision: The browser extension is treated as a potentially compromised local environment. It may provide local detection and user interaction data, but it cannot be used as an authority for identity or authorization.
- Rationale: The extension runs in a user-controlled browser environment and may be modified, spoofed, or abused. Backend enforcement must not rely on extension-generated values.
- Security impact: Prevents direct event forgery, unauthorized API calls, forged tenant claims, and bypasses that rely on trusting client-side state.
- Implementation consequence: Device registration, signed or authenticated event submission, and server-side validation are required before event ingestion is accepted.
- Open questions: The exact authentication mechanism for extension-to-backend submission remains to be specified during implementation, but it must be server-authoritative.

## Decision 4 — SSO is not mandatory for v1, but the identity architecture must allow enterprise SSO to be added later.

- Decision: The first release does not require SSO, but the authentication model must be designed to support enterprise SSO addition without a disruptive redesign.
- Rationale: This preserves a manageable first implementation while leaving a clear upgrade path for enterprise customers.
- Security impact: Allows secure enterprise expansion without forcing a complete identity rewrite. It reduces long-term lock-in and supports future enterprise onboarding.
- Implementation consequence: The identity system should support pluggable authentication, a clear claims model, and tenant-scoped identity assertions. The platform should not hard-code a single local auth model in a way that prevents enterprise SSO later.
- Open questions: Which SSO providers are required by enterprise customers, and whether SSO is expected in v1 for specific pilots.

## Decision 5 — Tenant onboarding follows this model: platform admin creates tenant → tenant admin is created/invited → tenant configures policies → users/extensions are enrolled.

- Decision: The onboarding workflow is explicitly tenant-first and platform-controlled, with an organization admin establishing the tenant configuration and then onboarding users and devices.
- Rationale: This is the simplest safe onboarding model for customer independence and tenant configuration control.
- Security impact: Reduces the risk of orphan users, cross-tenant admin drift, and accidental policy sharing. It supports explicit tenant ownership and activation boundaries.
- Implementation consequence: The platform must support tenant creation, initial admin assignment, invitation or activation flow, policy initialization, user enrollment, and device registration with server-side validation.
- Open questions: Whether the platform will support self-service signup or require a platform-admin-driven onboarding flow for v1.

## Decision 6 — Critical security controls default to fail-closed. Individual detection policies may explicitly use WARN or BLOCK according to tenant configuration.

- Decision: Security-critical actions should default to the safe outcome unless a tenant policy explicitly and safely authorizes a less restrictive behavior.
- Rationale: The product deals with sensitive data exposure. Default-deny behavior is safer than a permissive default in a security product.
- Security impact: Reduces unintentional data leakage and prevents default permit decisions that could bypass detection or policy enforcement.
- Implementation consequence: The platform must define clear policy precedence, enforce default behavior, and support explicit WARN/BLOCK decisions with audit logging. A fail-open default is not acceptable for critical controls unless there is a deliberate product decision and strong justification.
- Open questions: Whether any tenant-specific default policies are intentionally permissive for pilot use cases.

## Decision 7 — Development, staging, and production must be isolated environments. The exact cloud provider remains a documented deployment decision.

- Decision: The architecture must support separate development, staging, and production environments with independent credentials, data, and deployment controls. The cloud provider choice is intentionally left as a deployment decision rather than being assumed.
- Rationale: Isolation is necessary for security, release management, and safe customer onboarding. The exact provider does not change the architecture requirement.
- Security impact: Reduces accidental cross-environment access, credential leakage, and unsafe production deployment behavior.
- Implementation consequence: Production deployment must include environment separation, secret isolation, deployment approvals, and different runtime credentials per environment.
- Open questions: Which provider or platform will be used for hosting and operations.

## Decision 8 — Data retention must be tenant-configurable within platform-enforced limits, with tenant export and deletion workflows.

- Decision: Each tenant must be able to configure retention policies within platform-defined minimum and maximum limits, and the platform must support export and deletion workflows.
- Rationale: Enterprise customers require clear operational controls around data retention and removal. The platform must also preserve the ability to support tenant privacy requests and offboarding.
- Security impact: Limits unnecessary retention, reduces exposure risk, and supports customer trust and compliance-oriented operational requirements.
- Implementation consequence: Retention settings, purge behavior, export APIs, and deletion workflows must be modeled as tenant-scoped and auditable. The platform must prevent accidental cross-tenant retention or deletion actions.
- Open questions: What retention limits are required by enterprise customers or expected contract terms.

## Decision 9 — Initial extension distribution may use the Chrome Web Store; enterprise-managed deployment must remain supported by the architecture.

- Decision: The architecture should support Chrome Web Store distribution for standard rollout, while still allowing enterprise-managed installation for controlled deployment and managed users.
- Rationale: This balances ease of distribution with the enterprise requirement for managed installation and policy control.
- Security impact: Reduces friction for common enterprise rollout while preserving the ability to manage larger, regulated deployments. It also supports safer distribution and version control.
- Implementation consequence: The architecture must not assume a single distribution model. It must support secure extension identity, update/version control, and optional enterprise deployment paths without weakening trust boundaries.
- Open questions: Whether enterprise-managed deployment is required immediately or is planned later for high-security customers.

---

## REMAINING HUMAN DECISIONS

- Which cloud provider or hosting platform should be used for the production environment?
- Whether SSO is required for v1 or only for enterprise customers later
- Whether the platform should support self-service tenant onboarding or platform-admin-only onboarding in v1
- Whether any tenant-specific defaults are intentionally permissive for pilot environments
- Whether enterprise-managed extension deployment is required immediately or a later rollout requirement
- What retention limits must be enforced for tenant-configurable settings
