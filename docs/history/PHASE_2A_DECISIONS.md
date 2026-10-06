# Shadow AI Phase 2A Architectural Decisions

## Decision 1 — Enforcement Point Architecture

- **Context:** The current system relies on a browser extension to intercept DOM events (`paste`, `input`, `click`) and display warnings. This is treated as the enforcement mechanism, but it is executed in an untrusted client environment and is easily bypassed. Shadow AI requires a tamper-proof enforcement boundary to fulfill its enterprise security claims.
- **Options considered:**
  - Option A: Extension-only enforcement (current).
  - Option B: Extension pauses request and asks backend for decision.
  - Option C: Trusted enterprise gateway (Full TLS proxying).
  - Option D: Hybrid architecture (Extension for UX/telemetry + API Gateway/SWG for trusted network enforcement).
- **Chosen approach:** Option D (Hybrid Architecture).
- **Reason:** Pure extension enforcement cannot provide a strong security guarantee against bypasses (e.g., malicious insiders disabling the extension or using scripts). Pure network enforcement degrades UX (lack of immediate user warnings or redacting before submission) and creates massive deployment friction. A hybrid model delegates immediate UX to the extension and strict enforcement to a trusted network gateway.
- **Trade-offs:** Increases architectural complexity by introducing a secondary enforcement layer.
- **Consequences:** The backend and event schema must explicitly decouple `policyDecision` (what the policy dictates) from `requestPrevented` (what actually happened).

## Decision 2 — Policy Authority

- **Context:** Currently, the extension evaluates regular expressions and determines the `severity` and `riskScore` of a prompt, submitting this to the backend. The backend largely accepts these client-provided values to determine the policy outcome.
- **Options considered:**
  - Option A: Client evaluates content, determines outcome, and enforces.
  - Option B: Server evaluates metadata and dictates outcome.
- **Chosen approach:** Option B (Server dictates outcome).
- **Reason:** The client environment cannot be trusted to self-regulate or apply the correct policy. A compromised client could always claim `riskScore = 0`. The server must act as the sole authority for policy resolution and risk scoring.
- **Trade-offs:** Requires the server to have enough metadata to accurately score the risk without collecting raw plaintext.
- **Consequences:** The event ingestion pipeline must be refactored in Phase 2B to re-evaluate the submitted finding labels against the tenant's server-side policy to authoritatively determine `policyDecision`.

## Decision 3 — Tenant Identity Resolution for Enforcement

- **Context:** To evaluate policies, the system must know which tenant's policy applies. Client-side code could theoretically pass an `orgId`.
- **Options considered:**
  - Option A: Client passes `orgId` in API requests.
  - Option B: Server resolves `orgId` dynamically from a secure device/user authentication token.
- **Chosen approach:** Option B.
- **Reason:** Client-provided tenant IDs are trivial to spoof, leading to Cross-Tenant attacks (Tenant Escape).
- **Trade-offs:** Requires robust device enrollment and authentication mechanisms to be established before any telemetry is accepted.
- **Consequences:** All downstream components (Event ingestion, Policy Engine) must retrieve `orgId` from the trusted server context, never from the request body.

## Decision 4 — Decoupling Decision from Action

- **Context:** The current backend logic returns a generic `requestPrevented: false` static response, blurring the lines between a policy violation and successful prevention.
- **Options considered:**
  - Option A: A boolean `blocked` field.
  - Option B: Explicitly separating `policyDecision` (ALLOW, WARN, BLOCK) and `requestPrevented` (true/false).
- **Chosen approach:** Option B.
- **Reason:** A `BLOCK` policy might fail to enforce if the Trusted Gateway is bypassed by a client script. The audit log must accurately reflect that the policy demanded a block, but the enforcement failed (`requestPrevented: false`).
- **Trade-offs:** Slightly more complex audit logs.
- **Consequences:** Dashboards and analytics must clarify this distinction to administrators so they are aware of bypass events.

## Open/Unresolved Decisions

- **Gateway Implementation specifics:** Should Shadow AI implement its own forward proxy, or provide integration points (e.g., ICAP, REST APIs) for existing enterprise Secure Web Gateways (Zscaler, Netskope)? Building a bespoke TLS proxy is a massive undertaking, while SWG integration relies on external vendor support.
