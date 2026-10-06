# Phase 2C-B Security Review

## Trust Boundaries

```
┌───────────────────────────────────────────────┐
│                   UNTRUSTED                   │
│  Browser / Client / Extension / API Consumer  │
│  (all body fields, headers, query params)     │
└───────────────────────────┬───────────────────┘
                            │ HTTPS
                            ▼
┌───────────────────────────────────────────────┐
│              TRUSTED GATEWAY BOUNDARY         │
│  POST /gateway/v1/{provider}/{path}           │
│  • authMiddleware validates Bearer token      │
│  • orgId/userId/deviceId from JWT only        │
│  • Provider allowlisted constants only        │
│  • Policy Engine (Phase 2B) authoritative     │
└───────────────────────────┬───────────────────┘
                            │ TLS (standard web PKI)
                            ▼
                   AI Provider (OpenAI / Anthropic)
```

## Authentication Controls
**Status: PASS**

`authMiddleware` runs before any gateway logic. It:
- Requires a `Bearer` token
- For device tokens (`dvc_...`): hashes credential, verifies against `Device` collection, checks `isActive = true` and `revokedAt = null`
- For user JWTs: verifies HMAC-SHA256 signature, checks `authVersion` match against DB
- In both paths: verifies org `lifecycleStatus === 'active'`

Missing, invalid, expired, or revoked credentials return `401` before any gateway logic runs. The integration test confirms `401` on no-token and invalid-JWT requests.

## Tenant Isolation
**Status: PASS**

The critical tenant isolation invariant is enforced at two levels:

1. `authMiddleware` derives `req.user.orgId` from the signed JWT payload — it cannot be forged without the `JWT_SECRET`
2. The gateway uses `req.user.orgId` (not `req.body.orgId`, not query params) for:
   - `Org.findById(orgId)` — fetching tenant settings
   - `evaluatePolicy({ orgId })` — policy scope
   - `Event.create({ orgId })` — audit record attribution

The test `'derives tenant from JWT, not from request body orgId'` injects `body.orgId = 'org-attacker'` and confirms the audit record carries the real JWT-derived `orgId`.

## Client Authority Over Security Fields
**Status: PASS**

The following client-supplied fields are **never used** for security decisions in the gateway:
- `body.riskScore`
- `body.severity`
- `body.policyDecision`
- `body.blocked`
- `body.allowed`
- `body.orgId`
- `body.tenantId`

Text extraction reads only `body.messages[*].content` for detection; all security classification happens server-side.

## SSRF / Open Proxy Controls
**Status: PASS**

The gateway is **not** a generic proxy. Upstream destinations are determined exclusively from the `PROVIDERS` constant keyed by the `:provider` URL segment. Accepted values are only `'openai'` and `'anthropic'`. Any other value returns `400 Unsupported provider` before any network call is made.

There is no mechanism for a client to supply an arbitrary URL, IP, or port. Localhost, RFC-1918 ranges, and cloud metadata endpoints (`169.254.169.254`) are unreachable because they are not in the allowlist.

## Provider Credential Protection
**Status: PASS**

The gateway strips the incoming `Authorization` header before forwarding to the upstream provider (`delete headers.authorization`). Our internal JWT is **never** sent to OpenAI or Anthropic. The test `'does not forward the Shadow AI JWT to upstream provider'` verifies `calledOpts.headers.authorization` is `undefined`.

Provider API credentials (if any) would be injected from server-side environment config via `x-upstream-auth` header — a controlled mechanism that the client cannot forge (the client's own JWT would have been deleted by the gateway before forwarding).

## Policy Enforcement Guarantee
**Status: PASS**

The core invariant tested:
```
policyDecision = BLOCK  →  fetch() never called  →  enforcementStatus = PREVENTED
```

The test `'BLOCK: rejects request and NEVER calls upstream provider'` verifies `mockFetch` call count remains `0` when the policy engine returns `BLOCK`. This proves the enforcement is real — not just a JSON label.

## Fail-Closed Behavior
**Status: PASS**

| Failure Scenario | Behavior |
|-----------------|----------|
| Missing auth | 401 — no upstream call |
| Invalid/expired JWT | 401 — no upstream call |
| Unknown provider | 400 — no upstream call |
| Tenant not found in DB | 401 — no upstream call |
| Policy engine throws | Gateway `catch` block → 500 |
| Upstream unreachable | 502, `FAILED` audit record |

No code path results in silent fail-open.

## Privacy Protections
**Status: PASS**

- Raw prompt text is never stored in the database
- Only `findingLabels` (categorical) and metadata are persisted
- `clientTelemetry: {}` in gateway events — no raw content
- Provider API keys are never logged (no credential logging in `gateway.js`)

## Remaining Limitations

1. **Sanitization not implemented** — `policyDecision = SANITIZE` is recorded but content is forwarded unmodified. This is documented behavior for Phase 2C-B.
2. **Device-only enforcement** — Users can access the gateway with a user JWT. Phase 2C-C should consider restricting to device tokens only for stronger endpoint attribution.
3. **Response inspection absent** — AI model output is passed through without inspection. Out of scope for Phase 2C-B.
4. **No rate limiting on gateway** — Rate limiting at `/gateway/v1` is not yet configured. Should be added in Phase 2C-C.
5. **Bypass via direct provider access** — If enterprise firewalls do not block direct egress to `api.openai.com`, users can bypass the gateway entirely. This is a deployment constraint, not a code defect.
