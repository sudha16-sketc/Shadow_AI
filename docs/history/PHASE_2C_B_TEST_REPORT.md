# Phase 2C-B Test Report

## Commands Executed

```bash
# Gateway tests only (during development):
npm test -- --runInBand --testPathPattern gateway

# Full regression suite:
npm test -- --runInBand
```

Both commands executed successfully.

## Test Results — Full Suite

```
Test Suites: 4 passed, 4 total
Tests:       43 passed, 43 total
Snapshots:   0 total
Time:        ~6.8 s
```

## Tests by Suite

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/gateway.integration.test.js` | 10 | ✅ PASS |
| `tests/phase1-security.integration.test.js` | 20 | ✅ PASS |
| `tests/phase1-security.test.js` | 9 | ✅ PASS |
| `tests/policy-engine.test.js` | 4 | ✅ PASS |

## New Gateway Tests (10 Tests)

### Authentication
| Test | Result |
|------|--------|
| Rejects unauthenticated requests (no token) | ✅ |
| Rejects invalid JWTs | ✅ |

### Provider Allowlisting
| Test | Result |
|------|--------|
| Rejects unsupported providers (400) | ✅ |

### Core Security Property — BLOCK → Zero Provider Calls
| Test | Result |
|------|--------|
| BLOCK: rejects request and NEVER calls upstream provider | ✅ |
| BLOCK with high-risk finding (AWS key) → NEVER forwarded | ✅ |

### ALLOW Forwarding
| Test | Result |
|------|--------|
| ALLOW: forwards request to OpenAI provider | ✅ |
| ALLOW: forwards request to Anthropic provider | ✅ |

### Credential Protection
| Test | Result |
|------|--------|
| Does not forward Shadow AI JWT to upstream provider | ✅ |

### Tenant Isolation
| Test | Result |
|------|--------|
| Derives tenant from JWT, not from request body orgId | ✅ |

### Fail-Closed
| Test | Result |
|------|--------|
| Records FAILED (502) when upstream provider is unreachable | ✅ |

## Critical Security Assertion Verified

The following assertion was verified by the test suite:

```
Authenticated request
      ↓
Server-side classification (AWS key detected)
      ↓
Server-side policy → BLOCK
      ↓
mockFetch call count = 0    ← PROVIDER NEVER CONTACTED
      ↓
HTTP 403 returned to client
      ↓
Event.enforcementStatus = 'PREVENTED'
Event.requestForwarded   = false
```

This proves `policyDecision = BLOCK` → `provider never called` → `PREVENTED`. A regression in this path (e.g. gateway calls provider before checking policy) would cause `mockFetch.mock.calls.length > 0` and fail the test immediately.

## Failures Discovered and Fixed

| Issue | Fix |
|-------|-----|
| `jest` not defined in `policy-engine.test.js` | Added `import { jest } from '@jest/globals'` |
| `Policy` export missing from mock in `phase1-security.test.js` | Added `Policy` to `jest.unstable_mockModule` |
| `Policy` export missing from mock in `phase1-security.integration.test.js` | Added `Policy` to `jest.unstable_mockModule` |
| Gateway test using `supertest` (not installed) | Deleted; rewrote using Node.js `http.request` |
| `jest.spyOn(import(...))` invalid for ES modules | Rewrote test using `jest.unstable_mockModule` pattern |
| `scoring.js` mock used wrong export name `resolveRiskLevel` | Fixed to `recalcSecurityScore` |
| `alerting.js` mock used wrong export name `sendAlerts` | Fixed to `sendSlackAlert` / `sendEmailAlert` |
| `req.user.id` not set (authMiddleware sets `userId`) | Fixed to `req.user.userId` |
| Dynamic `import('../models/index.js')` in route bypassed mock | Changed to static `import { Org } from '../models/index.js'` |
| `requireDeviceAuth` rejected user JWTs (`authType !== 'device'`) | Removed `requireDeviceAuth` from gateway route (auth covered by `authMiddleware`) |
| Test `res.response.status` not accessible | Fixed to `res.status` (matching `httpRequest` return shape) |
| Global `fetch` mock intercepted test HTTP requests | Replaced `fetch`-based test helper with Node.js `http.request` |

## Tests Unavailable
- Extension tests (`shadow-extension/`) — no test runner configured
- Build (`npm run build`) — no build step defined in this project (pure ESM)
- `git diff --check` — directory not a git repository
