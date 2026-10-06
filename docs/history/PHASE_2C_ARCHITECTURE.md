# Phase 2C Architecture: Trusted Enforcement Boundary

## 1. Executive Summary
Phase 2C aims to establish the actual trusted enforcement boundary for Shadow AI. While Phase 2B successfully moved the security logic (policy evaluation, severity, risk) from the untrusted browser extension to the authoritative backend, enforcement remained a structural concept (the server evaluated `BLOCK`, but could not physically interrupt the request). Phase 2C architects a Trusted Gateway that will intercept requests, consult the Policy Engine, and actively prevent data egress before it reaches AI Providers.

## 2. Current Enforcement Model
Currently, the Shadow AI `shadow-extension` attempts to block users via UX (modals, disabled buttons) based on local detection. When a request is logged to the backend, the backend computes a `policyDecision: "BLOCK"`. However, this relies on the user not bypassing the browser extension. No actual network-layer prevention occurs.

## 3. Current Limitations
- **Client Compromise:** If a user disables the extension or uses cURL, the policy engine is entirely bypassed.
- **Structural Blocking Only:** The backend determines what *should* be blocked, but has no mechanism to *drop* the traffic in-flight.
- **Lack of Request Prevention:** There is no true `requestPrevented = true` state because Shadow AI does not route the traffic.

## 4. Trust Boundaries
- **Untrusted:** Browser Extension, Client Browser, End-User Device.
- **Trusted:** API Backend, Policy Engine, Database.
- **New Trusted Boundary:** Trusted Enforcement Gateway (Network Proxy / API Gateway).

## 5. Gateway Options
- **Option A (Forward Proxy):** A traditional HTTP/HTTPS proxy that requires enterprise TLS interception (CA certs installed on endpoints).
- **Option B (Application-Level AI Gateway):** An API-compatible gateway where clients are reconfigured to point to `https://gateway.shadow-ai.com/v1/chat/completions` instead of OpenAI directly.
- **Option C (Enterprise Network Gateway):** An integration with an existing SWG (Secure Web Gateway) like Zscaler or Palo Alto, using ICAP or similar protocols.
- **Option D (Hybrid):** Extension for UX + Option B or C for enforcement.

## 6. Decision Criteria
- Client compromise resistance.
- Deployment complexity for enterprise (specifically certificate management).
- Provider compatibility.
- Observability and identity flow.

## 7. Selected Architecture
**Option B (Application-Level AI Gateway)** is selected as the primary enforcement mechanism for Phase 2C, combined with the extension for UX (Option D).
By exposing an API-compatible endpoint (e.g., replicating the OpenAI or Anthropic API surface), enterprises can reroute traffic at the DNS level or via application configuration without deploying a custom Root CA for TLS interception across all employee devices. This heavily reduces deployment complexity while guaranteeing enforcement.

## 8. Identity Model
```text
Authenticated Device (via Phase 1 enrollment) -> JWT Token -> Gateway -> Resolves Tenant/User
```
The Gateway will require the same device authentication JWT used by the extension. If a user bypasses the extension, they must still authenticate to the Gateway.

## 9. Tenant Isolation
The Gateway strictly derives the `orgId` from the verified JWT. Cross-tenant pollution is impossible because the request context is entirely bounded by the cryptographic identity of the token, satisfying the Phase 1 server-authoritative tenant model.

## 10. Request Flow
### ALLOW Flow
1. Client sends request to AI Provider via Gateway.
2. Gateway authenticates JWT, resolves identity.
3. Gateway inspects request body (prompts).
4. Gateway queries Policy Engine.
5. Policy Engine returns `ALLOW`.
6. Gateway proxies request to AI Provider.
7. Gateway streams response back to Client.
8. Audit log records `enforcementStatus: ALLOWED`.

### BLOCK Flow
1. Client sends request to AI Provider via Gateway.
2. Gateway authenticates JWT.
3. Gateway inspects request body.
4. Policy Engine returns `BLOCK`.
5. Gateway drops request, returns `403 Forbidden` with a custom Shadow AI error.
6. Audit log records `enforcementStatus: PREVENTED`.

## 11. Enforcement Result Model
The Event schema will be extended to support:
`enforcementStatus`: `NOT_ATTEMPTED` (Phase 1/2B telemetry), `ALLOWED` (passed gateway), `PREVENTED` (dropped by gateway), `FAILED` (gateway error).

## 12. TLS Architecture
The Application-Level AI Gateway (Option B) natively terminates TLS for `gateway.shadow-ai.com` using standard web PKI (e.g., Let's Encrypt). This completely removes the need for enterprise custom CA injection. The Gateway then initiates a new standard TLS connection to the upstream AI Provider.

## 13. Provider Support Model
Initially scoped to **OpenAI** (ChatGPT API) and **Anthropic** (Claude API). The Gateway will parse standard JSON REST requests for these providers.

## 14. Streaming Model
AI providers heavily utilize Server-Sent Events (SSE). The Gateway will initially support **Streaming Responses** (pass-through). Request bodies (which contain the sensitive prompts) are typically fully buffered JSON payloads, meaning request inspection does not require complex streaming chunk reassembly.

## 15. Privacy Model
Raw prompt payloads inspected by the Gateway are **transient**. They are held in memory only long enough to perform detection and policy evaluation. Only normalized findings (`findingLabels`) and `maskedPreviews` are persisted to the database.

## 16. Failure Modes
- **Gateway Unavailable:** Fails closed (requests cannot reach upstream).
- **Policy Engine Unavailable:** Fails closed (Gateway blocks request).
- **AI Provider Unavailable:** Fails open to the client (returns upstream 503).
- **Identity Unavailable / Invalid JWT:** Fails closed (401 Unauthorized).

## 17. Bypass Analysis
- **Modified Extension:** Prevented. The gateway intercepts the actual network egress.
- **Direct API Calls:** Prevented if enterprise firewall blocks direct egress to `api.openai.com` and forces routing through the Gateway.
- **Unmanaged Device:** Out of scope for enterprise enforcement, but extension telemetry still functions if logged in.

## 18. Enterprise Deployment
Enterprises will deploy Shadow AI by:
1. Installing the browser extension for UX.
2. Updating internal DNS or enterprise firewalls to block direct access to AI domains and allow access only via the Shadow AI Gateway.

## 19. Observability
Logs will definitively answer: *Was this request physically prevented?* using the `enforcementStatus` field, removing ambiguity from `policyDecision`.

## 20. Scalability
The Gateway will be stateless. It can scale horizontally behind a load balancer. It will make synchronous local network calls (or imported module calls) to the `policy-engine`.

## 21. Open Decisions
- Should the Gateway be a separate Node.js service, or integrated into the existing `app.js` Express backend? (Recommended: Integrated for Phase 2C-B minimal implementation, separate service later).
