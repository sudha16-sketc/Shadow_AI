# Phase 2C Implementation Plan

## Objective
Establish a Minimal Trusted Gateway (Phase 2C-B) capable of securely proxying requests to AI providers, enforcing the server-authoritative policy decisions, and logging true request prevention.

---

### Stage 1: API Gateway Scaffolding & Routing
- **Objective:** Establish the proxy endpoint in the backend that intercepts traffic.
- **Components:** Express router, HTTP proxy middleware (e.g., `http-proxy-middleware`).
- **Files Affected:** `backend/src/app.js`, `backend/src/routes/gateway.js`.
- **Dependencies:** `http-proxy-middleware`.
- **Security Controls:** Provider Allowlist (block arbitrary destinations), JWT authentication (`requireDeviceAuth`).
- **Acceptance Criteria:** Authenticated user can send a request to the gateway, and the gateway proxies it to a mock upstream server successfully.
- **Excluded Work:** Policy inspection.

### Stage 2: Request Interception & Inspection
- **Objective:** Buffer the outgoing request body and perform detection.
- **Components:** Body parser, Detection extraction logic.
- **Files Affected:** `backend/src/routes/gateway.js`, `backend/src/services/detection.js`.
- **Security Controls:** Payload size limits to prevent DoS. Memory-only buffering for prompts.
- **Acceptance Criteria:** Gateway correctly extracts text from an OpenAI-format JSON payload.

### Stage 3: Enforcement & Policy Integration
- **Objective:** Wire the intercepted text to the Phase 2B Policy Engine and drop traffic on BLOCK.
- **Components:** `evaluatePolicy` integration.
- **Files Affected:** `backend/src/routes/gateway.js`.
- **Dependencies:** None.
- **Security Controls:** Fail-closed on error.
- **Acceptance Criteria:** If `evaluatePolicy` returns `BLOCK`, the gateway intercepts the request, does NOT forward to the upstream provider, and returns a 403 Forbidden to the client.

### Stage 4: Enforcement Result Auditing
- **Objective:** Update the Event schema to record actual enforcement status.
- **Components:** Event Model, Event Ingestion.
- **Files Affected:** `backend/src/models/index.js`, `backend/src/routes/gateway.js`.
- **Security Controls:** Server-authoritative assertion of `enforcementStatus`.
- **Acceptance Criteria:** Event records show `enforcementStatus: PREVENTED` when blocked, and `ALLOWED` when proxying succeeds.

### Stage 5: Client UX Updates
- **Objective:** Update the browser extension to handle Gateway 403 errors gracefully.
- **Components:** `shadow-extension/src/content.js`.
- **Files Affected:** `shadow-extension/src/*`.
- **Acceptance Criteria:** When the Gateway blocks a request, the extension detects the failure and displays a native warning modal explaining the policy violation.

---

## Explicitly Excluded Work (Future Phases)
- Streaming request body inspection.
- Advanced Response / DLP inspection.
- Custom TLS CA interception (Transparent Proxying).
- Integration with third-party Enterprise SWGs (e.g., Zscaler ICAP).
