# Shadow AI Phase 2A Architecture

## 1. Executive Summary

Shadow AI is evolving from an early-stage prototype (which relies on a browser extension for security detection and enforcement) to a production-grade enterprise AI security platform. 

This architecture document defines the Phase 2 target state, focusing on the **trusted enforcement boundary**. It establishes how Shadow AI can guarantee that AI requests are evaluated against tenant policies and safely prevented, regardless of whether the client extension is modified or compromised.

## 2. Current Architecture

Currently, Shadow AI relies entirely on a browser extension (acting as an untrusted client) to perform both detection and enforcement:
- The content script (`content.js`) intercepts user input (`paste`, `input`, and `click` on AI chat UI send buttons).
- Detection uses simple, local Regex patterns.
- Enforcement relies on a client-side warning modal and preventing the original UI event.
- If the user clicks "Proceed Anyway", or if a bypass occurs, the event is logged to the backend via `POST /api/events` with telemetry.
- The backend accepts this telemetry and evaluates the tenant's policy (logging a `policyDecision: BLOCK/WARN`), but **no actual request prevention occurs at the backend**. 

## 3. Current Trust Boundaries

In the current implementation, the browser extension acts as the primary trust boundary for enforcement, which is fundamentally flawed for an enterprise security product:
- **Untrusted (Currently Treated as Trusted):** Client-side enforcement (intercepting `click`/`paste`), client-provided risk scores and detection findings, bypass modal UI.
- **Trusted (But Ineffective for Enforcement):** The backend database, authentication layers, and the backend event policy evaluation engine (which can only audit).

## 4. Current Enforcement Limitations

- **Bypassable:** An attacker or malicious insider can easily bypass the browser extension by disabling it, modifying its code, or issuing HTTP requests to AI providers directly via scripts or curl.
- **False security claims:** `policyDecision = BLOCK` simply means the backend *desired* a block. `requestPrevented = false` indicates that the request was not actually prevented.
- **Client authority:** The client evaluates regex patterns and assigns a `severity` and `riskScore`. The backend blindly consumes this telemetry to record an audit log, trusting the client's assertion of the risk.

## 5. Enforcement Architecture Options

To establish a trusted enforcement point, three primary options exist:

### Option A — Extension-only enforcement
```text
User → Browser Extension → AI Provider
```
The current model. Cannot provide tamper-proof enterprise enforcement because the client environment is untrusted.

### Option B — Extension + backend policy decision
```text
User → Extension → Backend Policy Engine → Extension → AI Provider
```
The extension pauses the request, consults the backend for a policy decision, and then blocks or forwards it. While the backend makes the *decision*, the extension is still responsible for *enforcement*. If the extension is bypassed, the request is not prevented.

### Option C — Trusted enterprise gateway/proxy
```text
User → Managed Device → Enterprise AI Gateway → Policy Engine → AI Provider
```
The network routes traffic through a centrally controlled gateway (e.g., Forward Proxy or TLS intercepting Gateway). The gateway inspects the traffic, consults the backend, and drops or forwards the request. Provides strong trusted enforcement, but requires complex deployment (TLS interception, enterprise device management certificates).

### Option D — Hybrid architecture
```text
                  ┌── Browser Extension (Local Detection/Warning)
                  │
User → Enterprise Enforcement Layer (Gateway/API Proxy)
                  │
                  └── Backend Policy Engine (Policy Authority)
                            │
                            ↓
                         AI APIs
```
The browser extension provides immediate UX (warnings, alerts) and local evaluation, while a secondary enterprise enforcement layer (like a cloud-hosted API proxy for API-based AI traffic or integration with an existing SWG - Secure Web Gateway) enforces the absolute security policy.

## 6. Decision Criteria

- **Enforcement trust:** The enforcement mechanism must be located outside the user's control.
- **Bypass resistance:** Must not rely on client-side JS.
- **Deployment complexity:** Needs to balance robust security with realistic customer onboarding friction.
- **Privacy:** Must minimize plaintext data retention and ensure proper encryption.
- **Latency:** Inline enforcement requires extremely low latency to avoid degrading the AI experience.
- **Tenant isolation:** Must strictly preserve tenant context throughout the lifecycle.

## 7. Selected Target Architecture

**Option D (Hybrid Architecture) is the target for Phase 2.**

- **Why:** Pure extension enforcement (Option A/B) offers zero guarantee against bypass. Pure Gateway enforcement (Option C) creates massive friction (TLS MITM for all web traffic). A hybrid approach allows the extension to handle user-friendly interaction (warning modals, client-side redacting before sending) and telemetry, while a trusted backend API proxy or integration with enterprise SWG providers (e.g., Zscaler, Netskope) guarantees that managed enterprise AI API traffic is enforced at the network level.

*Note: For browser-based consumer AI usage (ChatGPT web UI), full enforcement mathematically requires either endpoint agent control (MDM/EDR) or network TLS interception. Shadow AI will use the extension for immediate UX, but network-level enforcement will be the trusted boundary for API traffic.*

## 8. Trust Boundaries

- **Trusted:** Backend API Gateway, Backend AuthN/AuthZ, Server-side Policy Engine, Server-side Tenant Context mapping, Database, Cloud Key Management.
- **Semi-Trusted:** Authenticated Browser Extension (can submit telemetry but cannot dictate policy outcomes or spoof identity).
- **Untrusted:** Raw Client Input, Client-provided policy decisions, Client-provided tenant IDs, Client-provided risk scores.

## 9. Data Flows

### Allowed Request Flow (Extension UX)
```text
User
 ↓
Enforcement (Extension)
 ↓
Detection (Local + Backend)
 ↓
Policy Evaluation (Backend)
 ↓
ALLOW
 ↓
AI Provider
 ↓
Audit (Backend)
```

### Blocked Request Flow (Gateway/Trusted API)
```text
User / App
 ↓
Enterprise Gateway / API Proxy
 ↓
Detection
 ↓
Policy Evaluation
 ↓
BLOCK
 ↓
Request Prevented (Connection dropped)
 ↓
Audit (Backend: requestPrevented = true)
```

### Bypassed Enforcement (Client Bypassed)
```text
User
 ↓
Modified/compromised client
 ↓
AI Provider

Backend later observes telemetry (if received):
policyDecision = BLOCK
requestPrevented = false
```

## 10. Policy Authority

The extension is **NOT** authoritative for any policy decisions.

**Authority Chain:**
```text
Identity (Auth Token)
   ↓
Trusted Tenant Context (Server-side mapping)
   ↓
Authorization (Role check)
   ↓
Policy Resolution (Backend Engine loads active policy version)
   ↓
Policy Decision (Backend determines BLOCK/WARN/ALLOW)
   ↓
Enforcement (Trusted Gateway drops request or Extension displays warning)
```

## 11. Tenant Isolation

- The existing multi-tenant model is preserved.
- `orgId` is resolved exclusively via server-side identity context (e.g., authenticated `deviceId` -> `orgId`).
- A client-provided `orgId` is completely ignored.
- All database queries and writes (Policies, Events, Devices) must include the `orgId` filter.

## 12. Failure Modes

- **Backend unavailable:** Extension fails open (allows request) but logs locally to queue telemetry; Trusted Gateway fails closed (blocks traffic).
- **Database unavailable:** API returns 503; Gateway fails closed.
- **AI provider unavailable:** Passed through as 5xx to the user.
- **Policy cannot be loaded:** Fails closed (default-deny).
- **Device revoked:** Auth rejected, event drops.

## 13. Privacy Architecture

- The backend must minimize the collection of raw prompts. Only deterministic metadata (e.g., risk scores, matching labels) and masked previews are ingested.
- The server will recalculate risk scores based on tenant-specific policy weights, rather than trusting the client's risk score.
- **Retention:** Tenant-configurable retention periods must be enforced, deleting events and logs after expiry.

## 14. Performance Requirements

- **Target API Latency:** < 50ms for telemetry ingestion.
- **Target Policy Evaluation:** < 20ms.
- **Target Gateway Overhead:** < 100ms per inline request.

## 15. Scalability Model

- **Bottlenecks:** MongoDB write throughput on the `Events` collection; WebSocket connection limits per server node; Policy Evaluation CPU overhead.
- **Scaling strategy:** Stateless Node.js API servers scale horizontally. Events can be decoupled using a message queue (e.g., SQS, Kafka) for asynchronous database ingestion if volume exceeds database write capacity.

## 16. Threat Model

See `PHASE_2A_THREAT_MODEL.md` for a detailed analysis of Client Compromise, Tenant Escape, Policy Bypass, and Data Leakage vectors.

## 17. Phase 2 Implementation Boundaries

- **Phase 2A (NOW):** Architecture, Threat Model, Implementation Plan. (No product code changes).
- **Phase 2B (NEXT):** Server-side policy engine, server-side evaluation, robust tenant context enforcement in telemetry.
- **Phase 2C (LATER):** Trusted enforcement implementation (Gateway / SWG integrations).

## 18. Open Architectural Decisions

- The exact mechanism for Trusted Enforcement (Option C/D integration): Should Shadow AI build a proprietary TLS forward proxy or integrate with existing SWGs (Zscaler, Palo Alto)?
- How to handle offline policy caching in the extension without relying on it as a trusted source of truth.
