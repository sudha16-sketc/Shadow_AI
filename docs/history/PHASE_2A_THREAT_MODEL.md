# Shadow AI Phase 2A Threat Model

## 1. Assets

- **Enterprise Prompts / Intellectual Property:** Confidential company data entered into AI models.
- **Secrets:** Passwords, API keys, JWT tokens, etc., exposed in AI interactions.
- **Tenant Policies:** The security rules dictating ALLOW/WARN/BLOCK behaviors.
- **Event Audit Logs:** The historical record of security events and telemetry.
- **Tenant Identity Data:** User information, org mappings, device tokens.

## 2. Actors

- **Malicious Insider / Employee:** Attempts to bypass restrictions to use unauthorized AI tools or leak data.
- **External Attacker (Compromised Endpoint):** Malware on the user's device modifying the extension or intercepting traffic.
- **External Attacker (Network):** Attempts to replay events, forge telemetry, or perform man-in-the-middle attacks.
- **Curious Employee:** Tries to see what is logged, bypass warnings, or view other tenants' data.
- **Tenant Administrator:** Could be compromised, allowing platform-wide attacks if tenant isolation fails.

## 3. Trust Boundaries

- **Untrusted:** 
  - The Browser Extension (runs in client execution context).
  - Client-side DOM.
  - Client-submitted API payloads (except for structural validation).
- **Semi-Trusted:**
  - Authenticated Browser Extension (can assert its device ID, but not tenant orgId or policy decisions).
- **Trusted:**
  - Node.js Backend API.
  - Server-side Policy Engine.
  - Trusted Enforcement Gateway (Future).
  - MongoDB Database.

## 4. Threats and Mitigations

### 4.1. Client Compromise (Attacker modifies extension)
- **Threat:** An attacker disables `content.js` or modifies the source code to return `severity = LOW` or skip telemetry submission.
- **Impact:** Complete bypass of client-side warnings and telemetry auditing.
- **Mitigation:**
  - **Phase 2A Arch:** Acknowledge that extension-only enforcement is bypassable.
  - **Target Arch:** Move enforcement to a Trusted Gateway (Option D) which cannot be bypassed via local extension modification.
- **Residual Risk:** Until the Trusted Gateway is implemented, the system remains a detection/telemetry platform, not a strict enforcement platform.

### 4.2. Tenant Escape (Cross-Tenant Access)
- **Threat:** An attacker manipulates request parameters (e.g., swapping `orgId`) to access another tenant's policies, events, or users.
- **Impact:** Critical data breach of another customer's IP and audit logs.
- **Mitigation:**
  - **Phase 2A Arch:** Ensure Tenant Context is strictly server-authoritative. The `orgId` is resolved exclusively via the authenticated session/device token, and enforced on all DB queries. Client-provided `orgId` fields must be strictly ignored.
- **Residual Risk:** Application logic bugs in DB queries could miss the `orgId` filter.

### 4.3. Policy Bypass
- **Threat:** An attacker manipulates the payload submitted to the backend to claim `policyDecision = ALLOW` or `riskScore = 0`, hoping the backend trusts the client.
- **Impact:** The backend records a false state, corrupting the audit log and failing to trigger alerts.
- **Mitigation:**
  - **Phase 2A Arch:** The backend Policy Engine must re-evaluate the risk and policy based on the raw finding labels/metadata (or eventually the Gateway payload), acting as the sole authority on `policyDecision`.
- **Residual Risk:** If the client completely omits findings from the payload, the backend cannot recreate them.

### 4.4. Identity Abuse
- **Threat:** An attacker steals an active session token, device credential, or enrollment credential.
- **Impact:** Forging events or viewing dashboards as the victim.
- **Mitigation:**
  - Tokens are short-lived.
  - Device revocation mechanisms exist.
  - Extension storage uses `TRUSTED_CONTEXTS` access levels.
- **Residual Risk:** Device tokens stored in extension storage could be extracted by local malware.

### 4.5. Enforcement Bypass
- **Threat:** Attacker sends requests directly to AI providers via `curl` or a custom script, bypassing the browser entirely.
- **Impact:** Complete bypass.
- **Mitigation:**
  - **Phase 2A Arch:** Requires moving enforcement to the network layer (Trusted Gateway). The extension cannot prevent this.
- **Residual Risk:** Bypassing the network Gateway (e.g. using a personal hotspot) requires Endpoint MDM controls, which are out of scope for the app itself.

### 4.6. Replay Attacks
- **Threat:** Attacker replays previously observed `POST /api/events` requests to flood the audit log.
- **Impact:** Denial of Service or audit log corruption.
- **Mitigation:**
  - Server-side idempotency keys and replay protection (already implemented in `events.js` via `EventReplay`).
- **Residual Risk:** Low.

### 4.7. Data Leakage
- **Threat:** Sensitive enterprise content (e.g., passwords, SSNs) appears in plaintext in logs, analytics, or telemetry.
- **Impact:** The security product itself becomes the source of a data breach.
- **Mitigation:**
  - Only deterministic metadata, risk scores, labels, and masked previews are sent to the backend. Raw prompts are never stored unless strictly required.
  - Ensure logging mechanisms (Winston, etc.) strip sensitive fields before writing to stdout/files.
- **Residual Risk:** Masking algorithms might fail to fully redact anomalous or obfuscated secrets.

### 4.8. Administrator Abuse
- **Threat:** A Tenant Administrator attempts unauthorized platform-level operations, or a Platform Admin views tenant-specific plaintexts.
- **Impact:** Breach of confidentiality and integrity.
- **Mitigation:**
  - Strictly separate Platform Admin roles from Tenant Admin roles.
  - Audit logging of all administrative actions.

## 5. Assumptions

- The underlying cloud provider (AWS/GCP/Azure) and TLS infrastructure are secure.
- The MongoDB database is isolated within a private VPC and inaccessible from the public internet.
- Developers follow secure coding practices to avoid injection attacks.
