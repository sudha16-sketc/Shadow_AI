# Production Gap Analysis

What is missing between this PoC and something a company could run for real
users. Ordered by priority. Each gap names the risk it leaves open, a concrete
next step, and whether it is cheap (days) or structural (weeks).

Scope lock reminder: Kubernetes, microservices, SSO/SAML, MFA, TLS
interception, SIEM, Redis, and secrets managers are deliberately **not** part of
this PoC. They appear here as future work, not as unfinished work.

---

## P0 — must close before any real data is processed

| # | Gap | Risk | Next step | Effort |
|---|---|---|---|---|
| P0-1 | **SSRF guard does not resolve DNS** — `url-guard.js` checks the literal host, so `https://internal.attacker.tld` resolving to `10.0.0.5` passes | Server reaches an internal service with alert payload | Resolve the hostname (or require a fixed Slack IP allowlist) and reject private ranges; prefer an egress proxy | 1–2 days |
| P0-2 | **Response inspection detects but does not block** — a provider that returns a secret relays it to the browser | Downstream secret exposure despite policy | Decide policy: buffer + redact, or block, or mark the session; currently only reported | 2–4 days |
| P0-3 | **No TLS termination guidance in code** — app speaks plain HTTP; security depends entirely on the deployment | Token/credential interception | Document + script an HTTPS reverse proxy (Caddy/nginx) with HSTS; verify WSS for the alert socket | 1–2 days |
| P0-4 | **7-day bearer tokens, no rotation or binding** | Stolen token is valid for a week anywhere | Short access token + refresh rotation, or device-bound tokens; add token denylist on logout (today only `authVersion` bump) | 3–5 days |
| P0-5 | **Secrets still live in local `.env` files** (real values exist on developer machines; git history is clean) | Leak via backup, sync, or a future commit | Rotate `JWT_SECRET`, MongoDB URI, SMTP and Slack credentials; move to a secret manager; delete local copies | 1 day |
| P0-6 | **No CI** — tests/lint/builds only run when someone remembers | Regressions land silently | GitHub Actions: backend `npm test`, extension `test:config`+lint+build, frontend lint+build, secret scan | 1 day |

## P1 — close before wider rollout

| # | Gap | Risk | Next step | Effort |
|---|---|---|---|---|
| P1-1 | Rate-limit thresholds are hard-coded | Tenants cannot tune abuse limits; limits not tenant-aware | Move to `RATE_LIMIT_*` env or per-org settings | 0.5 day |
| P1-2 | Rate limiting keys on `req.ip`; IPv6/shared NAT may over- or under-block | Legit users throttled; attacker not throttled | Key on tenant + IP; document `TRUST_PROXY` requirement | 0.5 day |
| P1-3 | Graceful shutdown untested | Dropped requests / orphaned Mongo sessions on deploy | Test with a running DB: in-flight request completes, then exit code 0 | 0.5 day |
| P1-4 | No audit-log tamper evidence | An admin could silently edit the trail | Append-only collection + daily hash chain or external log shipping | 2–3 days |
| P1-5 | Login timing only equalises the "no such user" branch | Account enumeration via DB timing | Fix password hash lookup by always loading a candidate; consider constant-time compare of a user-keyed hash | 1 day |
| P1-6 | Alert delivery untested end-to-end (Slack/SMTP mocked in tests) | Alerts silently fail in production | Add a staging webhook + SMTP smoke test outside the unit suite | 0.5 day |
| P1-7 | Detection pattern sets are duplicated (extension + gateway) | Drift: extension warns on something the gateway allows, or vice versa | Extract a shared `packages/detection-patterns` module consumed by both builds | 2–3 days |
| P1-8 | WebSocket tickets are in-process | Two backend instances break live alerts | Shared store (Redis or Mongo) or sticky sessions with a documented single-instance limit | 2–3 days |
| P1-9 | No dependency automation | Known CVEs accumulate (`npm audit` currently reports 4 moderate in the dashboard) | `npm audit` in CI, Renovate/Dependabot, pinned lockfiles | 0.5 day |
| P1-10 | No backend ESLint config | Style/refactor errors slip through the API | Add `eslint.config.js` + `npm run lint`, wire into CI | 0.5 day |

## P2 — quality, operability, and scale

| # | Gap | Next step |
|---|---|---|
| P2-1 | No metrics or dashboards on the backend | Prometheus `/metrics`: request latency, decision counts, BLOCK/SANITIZE rates |
| P2-2 | Logs are line-oriented, no central store | Ship to a log service; ensure no prompt text is ever logged |
| P2-3 | No error tracking | Sentry (or self-hosted) with payload scrubbing |
| P2-4 | No backup/restore story for Mongo | Scheduled dumps + restore drill; document RPO/RTO |
| P2-5 | No load testing | k6 profile for `/api/events` and `/gateway/v1` |
| P2-6 | Dashboard bundle is 1.6 MB | Route-level code splitting (`manualChunks`) |
| P2-7 | Frontend lint has 9 warnings | Fix `exhaustive-deps` warnings or convert to a lint-clean pattern |
| P2-8 | No API reference | Generate OpenAPI from the zod schemas already in the routes |
| P2-9 | Extension is loaded unpacked | Publish to Chrome Web Store or sign builds; enterprise policy deployment guide |
| P2-10 | `docs/history/` is large | Keep (decision trail) but add an index table in `docs/README.md` |
| P2-11 | No accessibility/i18n pass on the dashboard | Audit with Lighthouse; fix contrast/labels |
| P2-12 | Analytics aggregation runs per request | Materialised daily rollups once volume grows |

## Enterprise capabilities — explicitly deferred

Not started, and not started *on purpose*: SSO/SAML/OIDC, MFA, RBAC beyond
three roles, custom detection-rule UI, DLP tool integration, SIEM export,
regional data residency, SOC 2/ISO 27001 control mapping, dedicated tenant
infrastructure, secrets manager integration, policy simulation/sandbox mode.

Adding any of these should start from `ARCHITECTURE.md` and a new threat model,
not by patching the PoC.

## What is already in good shape

- Tenant isolation and role checks, with tests for cross-tenant attempts.
- Server-authoritative policy: client input never decides an outcome.
- `BLOCK` guarantee: zero upstream calls, asserted.
- Header hygiene in both directions of the gateway.
- Fail-closed sanitisation and fail-closed policy evaluation.
- Credential hygiene: pinned algorithm, revocation via `authVersion`, hashed
  device credentials, no self-service signup.
- Evidence culture: 100 automated tests, documented limitations, secret scans.

## Recommended order of work

1. Rotate real credentials and delete local `.env` values (P0-5).
2. Add CI so today's 100 passing tests become a gate (P0-6).
3. DNS-aware webhook validation (P0-1).
4. HTTPS/WSS deployment story (P0-3).
5. Token lifetime/rotation (P0-4).
6. Decide the response-blocking policy (P0-2).
7. Then P1 items, in table order.
