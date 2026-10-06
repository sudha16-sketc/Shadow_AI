# Phase 2C-B Implementation Report

## Summary
Phase 2C-B implements the minimal trusted enforcement gateway vertical slice for Shadow AI. The gateway is the first component capable of physically preventing an AI API request before it reaches an upstream provider — making `policyDecision = BLOCK` result in `enforcementStatus = PREVENTED` with zero upstream calls.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/routes/gateway.js` | **Created** — Core gateway route |
| `backend/src/app.js` | **Modified** — Mounted `/gateway/v1` under `authMiddleware` |
| `backend/src/models/index.js` | **Modified** — Added `enforcementStatus`, `requestForwarded`, `api_gateway` event type, `SANITIZE` to `policyDecision` enum, `CRITICAL` to severity enum |
| `backend/tests/gateway.integration.test.js` | **Created** — 10-test integration suite |

## Gateway Architecture Implemented

```
POST /gateway/v1/{provider}/{path}
         │
         ▼
    authMiddleware          ← Phase 1 JWT / device-token verification
         │
         ▼
   Provider Allowlist       ← Only "openai" and "anthropic" accepted
         │
         ▼
   Tenant Resolution        ← Org loaded from authenticated orgId (never from body)
         │
         ▼
   Request Normalization    ← Text extracted from messages[], analyzed for findings
         │
         ▼
   Policy Engine            ← Phase 2B evaluatePolicy() — server authoritative
         │
    BLOCK ─────────────────→ 403 Forbidden (provider NOT contacted)
         │                     enforcementStatus = PREVENTED
         │                     requestForwarded  = false
    ALLOW/WARN ─────────────→ fetch(upstream)
                                enforcementStatus = FORWARDED
                                requestForwarded  = true
    Upstream error ─────────→ 502 Bad Gateway
                                enforcementStatus = FAILED
                                requestForwarded  = false
```

## Authentication Flow
The `/gateway/v1` mount in `app.js` applies `authMiddleware` before any route handler is reached. `authMiddleware` validates the Bearer token (user JWT or `dvc_` device token), resolves tenant+user from the token, and populates `req.user`. The gateway route reads only `req.user.orgId` and `req.user.userId` — never request body fields.

## Trusted Tenant/User/Device Resolution
- `orgId` → derived from verified JWT claim via `authMiddleware`
- `userId` → `req.user.userId` set by `authMiddleware`
- `deviceId` → `req.user.deviceId` (populated for device tokens)
- **Org settings** are fetched via `Org.findById(orgId).lean()` using the authenticated `orgId`

No client-supplied values (`body.orgId`, `body.tenantId`, headers) are used for security context.

## Request Normalization
The gateway server-side detection adapter (`analyzeText()`) mirrors the extension PATTERNS/KEYWORDS inline. Text is extracted from:
- OpenAI: `body.messages[*].content` (string concatenation)
- Anthropic: `body.messages[*].content` (string or content-block array)

Finding labels flow directly into the Phase 2B `evaluatePolicy()` call.

## Policy Integration
`evaluatePolicy({ orgId, userRef, findingLabels, orgSettings })` from `backend/src/services/policy-engine.js` is called with zero client-supplied security context. The returned decision controls enforcement.

## Provider Adapters
Strict allowlist in `PROVIDERS` constant:

| Provider | Base URL |
|----------|----------|
| `openai` | `https://api.openai.com` |
| `anthropic` | `https://api.anthropic.com` |

The upstream path is derived from the Express wildcard parameter. Arbitrary URL routing is impossible.

## Enforcement Behavior

| Decision | Provider Contacted | Status | HTTP |
|----------|-------------------|--------|------|
| BLOCK | ❌ Never | PREVENTED | 403 |
| ALLOW | ✅ Yes | FORWARDED | upstream |
| WARN | ✅ Yes (pass-through) | FORWARDED | upstream |
| SANITIZE | ✅ Yes (not yet rewriting) | FORWARDED | upstream |
| Upstream error | ❌ Failed | FAILED | 502 |
| Auth failure | ❌ Never | — | 401 |
| Invalid provider | ❌ Never | — | 400 |

## Audit Model
Every gateway request creates an `Event` document with:
- `orgId`, `userId`, `deviceId` — server-derived
- `policyDecision`, `policyReason`, `policyVersion` — from policy engine
- `enforcementStatus` — `PREVENTED`, `FORWARDED`, or `FAILED`
- `requestForwarded` — boolean
- `findingLabels`, `riskScore`, `severity` — server-calculated
- `clientTelemetry: {}` — no raw prompt stored

## Failure Behavior (Fail-Closed)
- Auth failure → 401, no upstream call
- Invalid provider → 400, no upstream call
- Tenant not found → 401, no upstream call
- Policy engine throws → caught, returns 500
- Upstream unreachable → `enforcementStatus = FAILED`, 502

## Extension Changes
No extension changes were made. The extension continues to operate as the UX/detection telemetry layer.

## Dependencies Added
- `supertest` (devDependency) — required for integration test HTTP requests
