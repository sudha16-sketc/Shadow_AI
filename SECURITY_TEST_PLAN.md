# Security Test Plan

Threat-driven test matrix. Each row names a control from
`SECURITY_FEATURES.md`, the property that must hold, and the test that proves
it. Tests must run offline: no MongoDB, no real AI provider, no third-party
system is ever contacted.

---

## 1. Suites

| Suite | File | Cases | Runner |
|---|---|---|---|
| Gateway integration (baseline) | `backend/tests/gateway.integration.test.js` | 10 | `cd backend && npm test` |
| Phase 1 integration (baseline) | `backend/tests/phase1-security.integration.test.js` | 16 | same |
| Phase 1 unit (baseline) | `backend/tests/phase1-security.test.js` | 7 | same |
| Policy engine (baseline) | `backend/tests/policy-engine.test.js` | 10 | same |
| **Security regression (new)** | `backend/tests/security-regression.test.js` | 47 | same |
| Extension packaging/privacy | `shadow-extension/tests/security.test.js` | 6 | `cd shadow-extension && npm run test:config` |
| Extension build config | `shadow-extension/tests/build-config.test.js` | 4 | same |
| Shared harness | `backend/tests/helpers/mock-app.js` | — | imported by the regression suite |

Baseline suites are frozen: they must keep passing untouched. New coverage goes
into new files.

## 2. Harness contract (`tests/helpers/mock-app.js`)

- Every Mongoose model is replaced with an in-memory collection implementing the
  query chain used by the routes (`findOne`, `find`, `countDocuments`,
  `distinct`, `aggregate`, `create`, `findOneAndUpdate`, `updateOne/Many`,
  `deleteOne`, `findById`, `sort/skip/limit/populate/lean/select`).
- `global.fetch` is a Jest spy: **zero** outbound calls are possible, and every
  upstream request is inspectable (`mock.calls[i][0]` URL, `[1]` init).
- `alerting`, `scoring`, and `server.js` side effects are mocked.
- A real HTTP server listens on an ephemeral `127.0.0.1` port so middleware
  ordering, header handling, and status codes are exercised for real.
- `JWT_SECRET` and `GATEWAY_TIMEOUT_MS` are set for the suite (400 ms timeout so
  timeout behaviour is testable).

## 3. Matrix

### A. Authentication and credential tampering

| # | Property | Test |
|---|---|---|
| A1 | No credential → 401, no upstream call | `auth hardening › rejects requests with no credential` |
| A2 | Token signed with another secret → 401 | `rejects tokens signed with a different secret` |
| A3 | `alg:none` → 401 | `rejects alg:none tokens` |
| A4 | Expired token → 401 | `rejects expired tokens` |
| A5 | Revoked (`authVersion` mismatch) → 401 | `rejects a valid token whose authVersion no longer matches` |
| A6 | Missing tenant context, deactivated user, invitation expiry, role forgery, device pairing/revocation, logout revocation | phase1 suites (baseline) |

### B. Tenant isolation

| # | Property | Test |
|---|---|---|
| B1 | Queries never return another tenant's records | `tenant isolation › never returns another tenant's audit records` |
| B2 | Naming a foreign `orgId` → 403 | `rejects an explicit cross-tenant orgId parameter` |
| B3 | Stored events carry caller's tenant/user | `scopes gateway events to the authenticated tenant` |
| B4 | Event lists, user history, counts scoped; cross-tenant writes rejected | phase1 suites (baseline) |

### C. Gateway: server-authoritative decisions

| # | Property | Test |
|---|---|---|
| C1 | Client-claimed severity/decision/tenant fields ignored | `gateway trusts only server-side decisions › ignores client-claimed severity…` |
| C2 | USER-scoped policy matches the authenticated user object | `applies a USER-scoped policy using the authenticated user object` |
| C3 | `BLOCK` → 403, `PREVENTED`, zero upstream calls | `BLOCK never contacts the upstream provider` (new) + gateway baseline `BLOCK…` |
| C4 | `SANITIZE` removes secrets from the forwarded body | `SANITIZE redacts secrets before the request leaves the server` |
| C5 | SANITIZE fails closed on unparseable output | `fails closed when a SANITIZE payload cannot be redacted safely` |
| C6 | Fail-closed behaviour for missing/invalid policy | phase1 baseline |
| C7 | Tenant policy overrides client severity | phase1 baseline |

### D. Gateway: header and path hygiene

| # | Property | Test |
|---|---|---|
| D1 | Cookies, our JWT, forwarding headers never upstream | `gateway header allowlist › does not forward cookies, our JWT…` |
| D2 | `x-upstream-auth` → `authorization` only | `maps the caller-supplied provider credential onto authorization only` |
| D3 | `set-cookie`/unknown headers never relayed to client | `only reflects allowlisted provider headers in the client response` |
| D4 | Path traversal rejected | `rejects provider paths that try to escape the API surface` |
| D5 | Unknown provider rejected | `rejects unsupported providers` (new + baseline) |

### E. Gateway: resilience and response handling

| # | Property | Test |
|---|---|---|
| E1 | Upstream timeout → 502, recorded `FAILED`, no stack leak | `converts an upstream timeout into a 502 without leaking details` |
| E2 | Connection failure recorded | `records upstream failures instead of silently dropping them` |
| E3 | Non-2xx status relayed with `upstreamStatus` | `surfaces a non-2xx upstream status without pretending it succeeded` |
| E4 | Provider response scanned, findings audited | `flags provider responses that contain secrets and writes an audit record` |
| E5 | Clean response → zero findings, no audit noise | `reports zero findings for a clean response` |
| E6 | Unreachable provider recorded as `FAILED` | gateway baseline |

### F. Input validation and abuse

| # | Property | Test |
|---|---|---|
| F1 | Malformed JSON → 400 with request id | `input validation › returns 400 (not 500) for malformed JSON` |
| F2 | Oversized body → 413 | `rejects payloads above the configured body limit with 413` |
| F3 | NoSQL operator in login email → 400 | `rejects a non-string login email…` |
| F4 | Unknown login fields rejected | `treats unknown login fields as a bad request` |
| F5 | Pagination clamped | `clamps unbounded pagination…` |
| F6 | Search input is not a regex | `does not treat search input as a regular expression` |
| F7 | Analytics window bounded | `bounds the analytics window instead of accepting arbitrary values` |
| F8 | CSV formula injection neutralised | `audit export › neutralises spreadsheet formula injection` |
| F9 | Malformed event payload / idempotency replay | phase1 baseline |

### G. SSRF on operator-supplied callbacks

| # | Property | Test |
|---|---|---|
| G1 | Metadata IP, RFC1918, loopback, `.internal`, non-HTTPS rejected | `webhook URL validation` (7 URL cases) |
| G2 | Legitimate HTTPS webhook accepted | same suite |
| G3 | Guard re-checked at send time | implementation + settings test endpoint |

### H. Rate limiting and CORS

| # | Property | Test |
|---|---|---|
| H1 | Repeated login attempts → 429 with limit headers | `rate limiting › throttles repeated login attempts` |
| H2 | Unknown origin receives no CORS grant | `CORS allowlist › does not grant CORS to an unknown origin` |
| H3 | Allowlisted origin and extension scheme granted | `grants CORS to an allowed origin and the packaged extension scheme` |

### I. Operational safety

| # | Property | Test |
|---|---|---|
| I1 | `/health` returns no internals, no fingerprint | `operational endpoints › serves health without exposing internals` |
| I2 | `/ready` = 503 without a database | `reports readiness as unavailable when the database is not connected` |
| I3 | Hostile `X-Request-Id` replaced, valid one echoed | `echoes a well-formed caller request id and replaces a hostile one` |
| I4 | Unknown API route → JSON 404 | `returns JSON 404s for unknown API routes` |
| I5 | Graceful shutdown | manual (see `SECURITY_TEST_REPORT.md`) · [gap] |

### J. Secrets and privacy

| # | Property | Test |
|---|---|---|
| J1 | No credential-shaped literals in application source | `repository secret scan › finds no committed secrets in application source` |
| J2 | No `.env` files inside source trees | `keeps environment files out of the source tree` |
| J3 | Content script never logs raw text | extension `content script never writes pasted or typed text to the console` |
| J4 | API origin comes from build config | extension `background worker takes its API origin from build configuration` |
| J5 | Git history free of real secrets | manual, re-run before each release |

### K. Extension packaging

| # | Property | Test |
|---|---|---|
| K1 | Popup entry resolves in source and in the Vite build | extension `popup entry point resolves to a real file` |
| K2 | Built popup has no inline script and resolves its script src | `built popup … loads an external, same-origin script` |
| K3 | Host permissions scoped to HTTPS AI sites | `host permissions stay scoped to supported AI sites` |
| K4 | Minimal permission set | `requested API permissions are minimal` |
| K5 | Staging/production refuse local or non-HTTPS origins | `build-config.test.js` (4 cases) |

## 4. Coverage of the documented gaps

Not covered by automation, tracked in `PRODUCTION_GAP_ANALYSIS.md`:

- Graceful shutdown behaviour (drain + Mongo disconnect).
- nginx CSP rendering in a running container.
- SMTP alert delivery; Slack delivery (outbound call is intentionally mocked).
- Timing side-channel measurement for login.
- Load/performance of rate limiters and event ingestion.
- Multi-instance WebSocket ticket behaviour.

## 5. Rules of engagement

1. Never target a real third-party system; upstream calls are always the `fetch`
   spy.
2. Never print or assert on real secrets; fixtures use obviously fake values.
3. A control without a test is reported as unproven, not as "secure".
4. When a test is disabled, the corresponding row is removed from this plan and
   the gap is added to `PRODUCTION_GAP_ANALYSIS.md` in the same change.
