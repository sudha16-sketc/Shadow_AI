# Security Test Report

Evidence for the controls described in `SECURITY_FEATURES.md`. Every result
below comes from a command executed in this workspace; nothing is inferred.

| | |
|---|---|
| Date | 2026-10-06 |
| Platform | Linux (WSL), Node v22.23.2, npm 10.9.8 |
| Database | none (in-memory model doubles) |
| Network | none (upstream `fetch` replaced by a spy) |
| Git revisions scanned | 16 |

---

## 1. Commands and results

### 1.1 Backend test suites

```
$ cd backend && npm test
Test Suites: 5 passed, 5 total
Tests:       90 passed, 90 total
Time:        32.857 s
```

| Suite | Tests |
|---|---|
| `tests/gateway.integration.test.js` | 10 |
| `tests/phase1-security.integration.test.js` | 16 |
| `tests/phase1-security.test.js` | 7 |
| `tests/policy-engine.test.js` | 10 |
| `tests/security-regression.test.js` | **47 (new)** |

The 43 pre-existing tests were not modified and still pass unchanged.

### 1.2 Extension

```
$ cd shadow-extension && npm run test:config
# tests 10
# pass 10
# fail 0

$ npm run lint
(exit 0, no findings)

$ npm run build:development
✓ built in 264ms   → dist/manifest.json, dist/src/popup.html, dist/{content,background,popup}.js
```

### 1.3 Dashboard

```
$ cd frontend && npm run lint
✖ 9 problems (0 errors, 9 warnings)      # all react-hooks/exhaustive-deps

$ npm run build
✓ built in 33.20s
```

### 1.4 Secret scan — working tree

Asserted by `repository secret scan` (2 cases) over `backend/src`,
`frontend/src`, `shadow-extension/src` (62+ files):

- AWS access key ids · GitHub tokens · Slack webhook paths
- private key blocks · URI-embedded credentials
- `JWT_SECRET`/`SMTP_PASS`/`API_SECRET` literal assignments
- `.env` files inside source trees

**Result: 0 findings.**

### 1.5 Secret scan — git history

```
$ git log -p --all | grep -E <pattern>      # 16 revisions, 64 tracked files
AKIA[0-9A-Z]{16}                     -> 0
ghp_[A-Za-z0-9]{36}                  -> 0
hooks.slack.com/services/T…          -> 0
BEGIN [A-Z ]*PRIVATE KEY             -> 1   (README documentation example table)
mongodb+srv://user:pass@…            -> 0
xox[baprs]-                          -> 0
```

The single hit is the documentation row `` `-----BEGIN PRIVATE KEY-----` `` in
the README detection table — no key material.

### 1.6 Environment files are ignored

```
$ git check-ignore -v .env backend/.env frontend/.env shadow-extension/.env.production
.gitignore:2:.env                     .env
.gitignore:2:.env                     backend/.env
.gitignore:2:.env                     frontend/.env
shadow-extension/.gitignore:2:.env.*  shadow-extension/.env.production

$ git ls-files | grep '\.env' | wc -l
0
```

No `.env` file is tracked. Committed `.env.example` files contain placeholders
only.

## 2. Result matrix

### 2.1 By suite

| Suite | Cases | Result |
|---|---|---|
| `security-regression.test.js` (new) | 47 | pass |
| `gateway.integration.test.js` (baseline, untouched) | 10 | pass |
| `phase1-security.integration.test.js` (baseline, untouched) | 16 | pass |
| `phase1-security.test.js` (baseline, untouched) | 7 | pass |
| `policy-engine.test.js` (baseline, untouched) | 10 | pass |
| extension `security.test.js` (new) | 6 | pass |
| extension `build-config.test.js` | 4 | pass |
| **Total executed** | **100** | **all pass** |

### 2.2 By plan section (`SECURITY_TEST_PLAN.md` §3)

| Section | Cases | Result |
|---|---|---|
| A. Authentication / credential tampering | 5 | pass |
| B. Tenant isolation | 3 | pass |
| C. Gateway server-authoritative decisions | 5 | pass |
| D. Gateway header & path hygiene | 5 | pass |
| E. Gateway resilience & response handling | 5 | pass |
| F. Input validation & abuse (incl. CSV export) | 8 | pass |
| G. SSRF on operator-supplied callbacks | 7 | pass |
| H. Rate limiting & CORS | 3 | pass |
| I. Operational safety | 4 | pass |
| J. Secrets & privacy (backend + extension) | 4 | pass |
| K. Extension packaging & build config | 8 | pass |
| **New coverage in this pass** | **57** | **all pass** |
| Phase 1 + policy-engine baseline | 43 | all pass |

## 3. Notable assertions

- **BLOCK never calls upstream** — `mockFetch` call count stays 0 while the
  response is 403 and the stored event reads `enforcementStatus=PREVENTED`.
- **Client cannot authorise itself** — a request body containing
  `severity: LOW`, `policyDecision: ALLOW`, `orgId: org-attacker` still produces
  an event with the caller's real tenant and `severity=CRITICAL` from
  server-side detection of an AWS key.
- **SANITIZE actually removes secrets** — the forwarded payload contains
  `[REDACTED:Email Address]` and `[REDACTED:AWS Access Key]`, and the original
  values do not appear anywhere in the upstream request body.
- **SANITIZE fails closed** — forcing the redaction round-trip to fail returns
  500 with `policyReason='sanitize_failed'` and zero upstream calls.
- **No cookie or JWT leakage** — upstream request headers contain neither
  `cookie` nor our `authorization`; the caller's provider key arrives only via
  `x-upstream-auth`.
- **No `set-cookie` reflection** — a provider response carrying `set-cookie` and
  `x-internal-debug` reaches the client without them.
- **USER-scoped policy works** — a policy targeting the authenticated user
  returns `matched_policy_rule_PII` with the policy's own version, proving the
  fix to `evaluatePolicy({ userRef })`.
- **Throttling** — 21 login attempts produce 429 with rate-limit headers when
  limiting is active.
- **CORS** — `https://evil.example` receives no `access-control-allow-origin`;
  configured origins and the packaged extension origin do.
- **SSRF** — metadata IP, RFC1918, loopback, `.internal`, and non-HTTPS
  webhooks are all rejected at the API boundary.

## 4. Findings fixed in this pass

| # | Severity | Finding | Fix | Proof |
|---|---|---|---|---|
| 1 | HIGH | `evaluatePolicy` received a string `userRef`, so USER/GROUP policies never matched | `req.authUser` set in `middleware/auth.js`, used by the gateway | C2 test |
| 2 | HIGH | Extension popup path in `manifest.json` did not match the built file | `default_popup: src/popup.html` + Vite entry assertion | K1/K2 |
| 3 | HIGH | CORS reflected any origin with credentials | allowlist + `chrome-extension://[a-p]{32}` | H2/H3 |
| 4 | HIGH | SANITIZE silently behaved as ALLOW | deterministic redaction with fail-closed handling | C4/C5 |
| 5 | HIGH | Gateway forwarded cookies and our own JWT upstream | request header allowlist | D1/D2 |
| 6 | MEDIUM | Slack webhook allowed SSRF to internal hosts | `utils/url-guard.js` (HTTPS, host/IP checks) | G1/G2 |
| 7 | MEDIUM | No upstream timeout; no redirects policy | `AbortSignal.timeout`, `redirect:'error'` | E1 |
| 8 | MEDIUM | No rate limit on auth/events/gateway/policies/platform-admin | per-route limiters | H1 |
| 9 | MEDIUM | Malformed JSON and non-string login input produced 500 | zod validation, central error handler | F1–F4 |
| 10 | MEDIUM | Unbounded `limit`, `page`, `days`, `$regex` inputs | `clampPagination`, `clampDays`, `escapeRegex` | F5–F7 |
| 11 | MEDIUM | CSV formula injection in audit export | cell neutralisation | F8 |
| 12 | MEDIUM | Login timing revealed account existence | dummy-hash comparison | A (behavioural) |
| 13 | MEDIUM | Raw pasted text logged by the content script | metadata-only logging | J3 |
| 14 | MEDIUM | Broken `/downloads/shadow-ai.zip` link + 24 MB stale artifact | build instructions link; artifact removed | manual |
| 15 | LOW | `clientTelemetry.severity` enum missing `CRITICAL` | enum extended | schema |
| 16 | LOW | Alert precedence bug (HIGH without CRITICAL) | fixed condition | schema/logic |
| 17 | LOW | No request IDs, readiness, graceful shutdown, JSON 404 | `app.js` + `server.js` | I1–I4 |
| 18 | LOW | Response header leakage, response findings unaudited | response allowlist + inspection + audit | D3/E4 |
| 19 | LOW | nginx shipped without CSP/frame/referrer headers | envsubst template with headers | manual |
| 20 | LOW | Frontend lint config present but tooling missing | ESLint installed, script added, errors fixed | §1.3 |

## 5. Manual checks performed

| Check | Result |
|---|---|
| `git check-ignore` on all `.env` files | ignored, none tracked |
| `git log -p --all` secret patterns | no key material (§1.5) |
| `docker-compose.yml` parsed as YAML | valid; `API_ORIGIN` under `frontend.environment` |
| nginx template rendered with `envsubst '${API_ORIGIN}'` | no leftover `${…}`; nginx `$uri` preserved |
| Extension popup built path | `dist/src/popup.html` → script resolves to `dist/popup.js` |
| `dist/index.html` inline scripts | none (CSP-compatible) |

## 6. Not executed / residual

| Item | Why | Tracking |
|---|---|---|
| Graceful shutdown under load | requires a running MongoDB | `PRODUCTION_GAP_ANALYSIS.md` |
| nginx CSP in a running container | image build not run in this pass | gap |
| SMTP/Slack delivery | outbound calls intentionally mocked | gap |
| Login timing measurement | no timing harness | gap |
| Load testing | out of scope for the PoC | gap |
| SSRF guard DNS resolution | needs resolver + egress policy | gap |
| Multi-instance WebSocket | requires shared ticket store | gap |

## 7. How to reproduce

```bash
cd backend && npm test                     # 90
cd ../shadow-extension && npm run test:config && npm run lint && npm run build:development
cd ../frontend && npm run lint && npm run build
git log -p --all | grep -E 'AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}'
```
