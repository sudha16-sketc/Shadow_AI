# Phase 2C Threat Model

## Assets
- Enterprise Prompts and Sensitive Data (PII, API Keys, Source Code).
- Policy Configuration Data.
- AI Provider API Keys.
- Audit Logs.

## Actors
- **End Users:** Employees attempting to use AI tools (benign or malicious).
- **Tenant Admins:** Enterprise administrators managing policies.
- **External Attackers:** Attempting to extract data from the Gateway or bypass policies.

## Trust Boundaries
1. **Client / Browser Boundary:** Untrusted. End users control the environment.
2. **Gateway Boundary:** Trusted. Must authenticate traffic and terminate TLS securely.
3. **Backend/Database Boundary:** Trusted. Stores policies and logs.

## Threats & Attack Paths

### 1. Gateway Authentication Bypass
- **Attack Path:** Attacker crafts a request to the Gateway without a valid JWT or spoofs an `orgId`.
- **Impact:** Attacker uses the Gateway as an open proxy or pollutes another tenant's logs.
- **Mitigation:** The Gateway strictly enforces the Phase 1 `requireDeviceAuth` middleware. Identity is extracted cryptographically from the token. `orgId` payload parameters are ignored.
- **Residual Risk:** Low. Relies on standard JWT security.

### 2. Tenant Escape via Policy
- **Attack Path:** Attacker sends a request, and a race condition or flaw in the Policy Engine applies Tenant B's permissive policy to Tenant A's request.
- **Impact:** Policy bypass and data leakage.
- **Mitigation:** `policy-engine.js` inherently scopes all `Policy.find()` queries with the cryptographically verified `orgId` from the token. Cross-tenant access fails closed.
- **Residual Risk:** Low.

### 3. Open Proxy Abuse (SSRF)
- **Attack Path:** Attacker uses the Shadow AI Gateway to send requests to arbitrary internal enterprise IP addresses or malicious external domains.
- **Impact:** Server-Side Request Forgery (SSRF), internal network scanning.
- **Mitigation:** The Gateway will implement a strict **Provider Allowlist** (e.g., only allowing upstream connections to `api.openai.com` or `api.anthropic.com`). Arbitrary URI routing will be rejected.
- **Residual Risk:** Low.

### 4. Direct Provider Access (Policy Bypass)
- **Attack Path:** User uninstalls the extension and goes directly to `chat.openai.com`.
- **Impact:** Shadow AI policies are completely bypassed.
- **Mitigation:** Requires Enterprise Network controls (firewall/DNS) to block direct traffic to AI providers, forcing it through the Gateway.
- **Residual Risk:** Medium (Dependent on Enterprise IT configuration, outside Shadow AI's direct codebase control).

### 5. Logging Data Leakage
- **Attack Path:** Gateway logs raw HTTP requests, inadvertently persisting highly sensitive trade secrets to disk.
- **Impact:** Shadow AI database becomes a high-value target for data breaches.
- **Mitigation:** Raw prompts are transient in memory during inspection. Only masked previews and categorical finding labels are persisted to the database.
- **Residual Risk:** Low.

### 6. Gateway Fail-Open Behavior
- **Attack Path:** Gateway crashes or Policy Engine connection times out, causing the Gateway to blindly forward traffic to avoid breaking UX.
- **Impact:** Policy bypass during downtime.
- **Mitigation:** Gateway explicitly **Fails Closed**. If a policy decision cannot be reached, a 500 error is returned to the client and the traffic is dropped.
- **Residual Risk:** Moderate (Causes availability issues for the end-user, but prioritizes security).

### 7. Large Payload DoS
- **Attack Path:** User sends a multi-gigabyte payload to the Gateway, exhausting memory and crashing the Node process.
- **Impact:** Denial of Service for all tenants on that Gateway node.
- **Mitigation:** Implementation of strict request body size limits (`express.json({ limit: '50kb' })` or similar adjusted for AI context limits) before inspection buffering occurs.
- **Residual Risk:** Low.

## Assumptions
- The enterprise deploying Shadow AI can configure DNS or Firewalls to force traffic through the Gateway.
- Phase 1 Authentication JWTs remain secure and resistant to forgery.
