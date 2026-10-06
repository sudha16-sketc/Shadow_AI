# Security Features

Control-by-control description of what is implemented today, where it lives, and
what it does **not** do. Anything not listed here should be assumed absent.
Proof is in `SECURITY_TEST_REPORT.md`; remaining work is in
`PRODUCTION_GAP_ANALYSIS.md`.

Legend: **[T]** has an automated test · **[D]** documented limitation · **[N]**
no test yet

---

## 1. Transport & platform hardening

| Control | Implementation | Status |
|---|---|---|
| Security headers (MIME sniffing, frame, referrer, CORS restrictions) | `helmet()` in `backend/src/app.js` | [T] `/health` assertions |
| Server fingerprint removed | `app.disable('x-powered-by')` | [T] |
| Dashboard CSP + frame/referrer/permissions headers | `frontend/nginx.conf` (envsubst template) | [T] render check in workflow · [N] automated |
| Request correlation | `X-Request-Id` middleware, registered **before** body parsing, echoed on every response, hostile values replaced | [T] |
| JSON 404 + central error handler | `app.js` — malformed JSON → 400, oversize → 413, other errors → `{error:'Internal error', requestId}` with no stack | [T] |
| Body size limit | `express.json({ limit: '50kb' })` | [T] 413 case |
| Graceful shutdown | SIGTERM/SIGINT in `backend/src/server.js`: stop accepting, drain up to `SHUTDOWN_GRACE_MS`, disconnect Mongo, exit | [N] |
| Liveness / readiness | `GET /health` (always 200), `GET /ready` (503 until Mongo `readyState === 1`) | [T] |

## 2. Browser-transport protections

| Control | Implementation | Status |
|---|---|---|
| CORS allowlist | `resolveAllowedOrigins()` / `isOriginAllowed()` — configured origins plus `chrome-extension://[a-p]{32}`; unknown origins get **no** CORS grant | [T] preflight cases |
| Credentialed CORS only for allowlisted origins | `credentials: true` combined with the allowlist instead of reflecting any origin | [T] |
| Proxy awareness | `TRUST_PROXY` opt-in so `req.ip`/rate limits are correct behind a proxy and not spoofable otherwise | [N] |
| Rate limiting | `/api/auth` 20/min · `/api/events` 100/min · `/api/platform-admin` 30/min · `/api/policies` 60/min · `/gateway/v1` 60/min; disabled only when `NODE_ENV=test` | [T] login throttle (429) |

## 3. Authentication

| Control | Implementation | Status |
|---|---|---|
| JWT algorithm pinned | `jwt.verify(..., { algorithms: ['HS256'] })` | [T] `alg:none` rejected |
| Secret strength enforced at startup | `backend/src/config/security.js`: ≥48 bytes, ≥16 distinct characters, no fallback | [N] (fails fast by construction) |
| Signature verification | wrong-secret and expired tokens rejected | [T] |
| Revocation | `authVersion` on every user/device/platform-admin document; logout increments it and revokes WebSocket tickets | [T] authVersion mismatch |
| Device credentials | random `dvc_…` token stored only as a hash (`hashDeviceCredential`), per-device revocation | [T] (phase1 suite) |
| Login input validation | zod `.strict()` schema: non-string `email` (NoSQL operator injection), unknown fields → 400 instead of 500 | [T] |
| Login timing side channel | one bcrypt comparison per attempt against a dummy hash when the account does not exist | [T] (behavioural; timing not asserted) · [D] |
| Platform admin plane | separate collection, 15-minute tokens, `tokenType: platform_admin` required | [T] |
| No self-service signup | `POST /api/auth/signup` always 403 | [N] |
| WebSocket tickets | 32 random bytes, single use, 20s TTL, tenant- and user-bound, revoked on logout/tenant change | [T] phase1 suite |

## 4. Authorization and tenant isolation

| Control | Implementation | Status |
|---|---|---|
| Tenant scoping | every query is filtered by `req.user.orgId` | [T] audit-log cross-tenant case |
| Explicit cross-tenant rejection | `requireTenantAccess` compares any `orgId`/`tenantId` in params, query, or body against the caller | [T] 403 case |
| Role checks | `requireRole('admin','manager')`, `requireRole('admin')` per route | [N] (covered indirectly) |
| Tenant must be active | `lifecycleStatus === 'active'` checked during auth and gateway resolution | [N] |
| Server-side identity for policy | `req.authUser` is the loaded user document, so `USER`/`GROUP` policy scope actually matches | [T] USER-scoped policy case |

## 5. Gateway enforcement (the core control)

| Control | Implementation | Status |
|---|---|---|
| Provider allowlist | only `openai`, `anthropic`; fixed base URLs | [T] unknown provider → 400 |
| Upstream path validation | `isSafeUpstreamPath`: charset, length ≤512, no `//`, no `..` | [T] traversal case |
| Body must be a JSON object | arrays/null/scalars rejected | [T] |
| Server-side detection | `analyzeText()` runs on the prompt the server actually received | [T] spoofed-severity case |
| Client claims ignored | tenant/user/severity/decision come from the credential and the policy engine, never from the body | [T] spoofed fields case |
| `BLOCK` short-circuits | 403 + `enforcementStatus=PREVENTED`, `requestForwarded=false`, upstream **never** called | [T] |
| `SANITIZE` redacts | every pattern match replaced by `[REDACTED:<label>]` in the serialized body; `sanitizedRedactions` recorded | [T] 2+ redactions asserted |
| SANITIZE fails closed | if the redacted payload cannot be re-parsed: 500, `policyReason='sanitize_failed'`, nothing forwarded | [T] |
| Request header allowlist | content-type, accept, accept-language, provider headers, x-request-id only; `x-upstream-auth` → `authorization`; cookies, our own JWT, forwarding chains, hop-by-hop dropped | [T] |
| Response header allowlist | content-type/cache/date/etag/retry-after/ratelimit/www-authenticate + `openai-*`/`anthropic-*`; `set-cookie` and arbitrary headers never relayed | [T] |
| Upstream timeout | `AbortSignal.timeout(GATEWAY_TIMEOUT_MS)` (default 60s) → 502, recorded as `FAILED` | [T] |
| No redirects followed | `redirect: 'error'` | [N] |
| Upstream failure surfaced | 502 `{error:'Failed to reach AI Provider'}`, `upstreamStatus` stored | [T] |
| Response inspection | provider output scanned for the same patterns; count returned in `X-Shadow-Response-Findings`, labels stored, `AuditLog` entry written | [T] |
| Everything audited | each gateway call produces an `Event` with decision, reason, version, enforcement, redaction count | [T] |

**[D] Response inspection does not redact or block.** A provider that returns a
secret is reported, not withheld. Blocking on response would require buffering
and a rewrite policy that this PoC does not implement.

## 6. Input handling on the REST API

| Control | Implementation | Status |
|---|---|---|
| Pagination bounds | `clampPagination()` — `page ≥ 1`, `limit ≤ max` per route | [T] `limit=9999999` |
| Regex injection | `escapeRegex()` on every `$regex` input (user search, audit action) | [T] `.*` case |
| Date-window bounds | `clampDays()` for analytics (`> 0`, ≤ 365) | [T] |
| String coercion + length caps | inputs sliced to fixed maxima before querying | [N] |
| CSV formula injection | export cells double-quoted and neutralised when starting with `= + - @ \t \r` | [T] |
| Audit export cap | `AUDIT_EXPORT_MAX_ROWS` (default 10 000) | [N] |
| Invalid ObjectId | audit-log `:id` validated with `isValidObjectId` → 404, not 500 | [N] |

## 7. Outbound requests that are not the AI gateway

| Control | Implementation | Status |
|---|---|---|
| Slack webhook SSRF guard | `backend/src/utils/url-guard.js`: HTTPS only, no credentials in URL, rejects loopback/private/link-local/CGNAT/multicast IPs, `.local`/`.internal`, cloud metadata hostnames | [T] seven URL cases |
| Same guard applied where it is sent | settings write **and** `sendSlackAlert` re-checks stored value; test endpoint refuses | [T] write path |
| Alert fetch bounded | `AbortSignal.timeout(10s)`, `redirect: 'error'` | [N] |
| SMTP | host/credentials from environment only | [N] |

**[D] The guard does not resolve DNS.** A hostname that resolves to an internal
address still passes. Production needs outbound egress filtering — recorded in
`PRODUCTION_GAP_ANALYSIS.md`.

## 8. Data protection and privacy

| Control | Implementation | Status |
|---|---|---|
| No raw prompt storage on the report path | extension sends masked previews/labels; `clientTelemetry` is stored empty by the gateway | [T] `clientTelemetry` equality |
| No raw text in logs | content script logs only metadata (`textLength`, tag, id, labels) | [T] extension source assertion |
| Local detection | analysis runs in the browser; nothing leaves the device until the user submits/accepts | [D] design |
| User opt-out | `chrome.storage.sync` `optedOut` honoured by the content script | [N] |
| Secrets absent from source | repository scan for AWS/GitHub/Slack/private-key/credential-URI/env-assignment shapes | [T] two scan cases |
| Secrets absent from git history | verified manually across all 16 revisions (no real values found) | [T] manual verification, re-run before release |
| Env files git-ignored | `.env` / `.env.*` ignored in every package; `.env.example` files contain placeholders only | [T] source-tree assertion |
| `JWT_SECRET` never logged | logger prints request metadata only | [N] |

## 9. Alerting and audit

| Control | Implementation | Status |
|---|---|---|
| Alert threshold | `severity in (HIGH, CRITICAL)` **and** not already alerted (fixes the previous precedence bug) | [N] |
| CRITICAL severity supported | `clientTelemetry.severity` enum includes `CRITICAL` | [N] |
| Audit coverage | admin/manager actions, policy changes, gateway response findings | [T] response-finding case |
| Audit integrity | **none** — records are plain documents, no hash chain or WORM storage | gap |

## 10. Extension packaging

| Control | Implementation | Status |
|---|---|---|
| Least-privilege permissions | `tabs`, `scripting`, `storage`, `alarms` only | [T] |
| Scoped host permissions | specific HTTPS AI sites; the API origin is injected at build time | [T] |
| No wildcard patterns | `<all_urls>`, `*://*/*` rejected by test | [T] |
| Popup packaging | manifest path matches the Vite entry and the emitted file | [T] (2 cases) |
| Staging/production builds refuse localhost / non-HTTPS API origins | `resolveApiOrigin()` | [T] |
| API origin from build config, not hardcoded | `background.js` uses `import.meta.env.VITE_API_URL` | [T] |
| Inline scripts avoided | MV3 CSP compliance checked on the built popup | [T] when `dist/` exists |

## 11. Known weaknesses (accepted for this PoC)

1. Response inspection detects but does not block (`§5`).
2. SSRF guard does not perform DNS resolution (`§7`).
3. Detection patterns are duplicated between extension and gateway (`ARCHITECTURE.md §6`).
4. Rate-limit thresholds are hard-coded, not tenant-configurable.
5. Single-instance WebSocket tickets; no shared store.
6. 7-day bearer tokens with no refresh rotation or token binding.
7. No MFA, SSO, or IP allowlisting on admin actions.
8. No audit-log tamper evidence.
9. Login timing is equalised only for the "no such account" branch; database
   timing differences remain.
10. `SANITIZE` leaves keyword-only findings (e.g. "confidential") in the
    payload — they are labels, not replaceable strings.
