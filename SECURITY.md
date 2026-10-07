# Security

How Shadow AI is secured, what is actually proven, and what is deliberately not
attempted. Detailed evidence lives in [`SECURITY_TEST_REPORT.md`](SECURITY_TEST_REPORT.md);
the control inventory is in [`SECURITY_FEATURES.md`](SECURITY_FEATURES.md); the
backlog is in [`PRODUCTION_GAP_ANALYSIS.md`](PRODUCTION_GAP_ANALYSIS.md).

## Threat model (PoC scope)

| Asset | Threat | Control |
|---|---|---|
| Tenant data (events, users, audit) | cross-tenant read/write | every query carries the authenticated `orgId`; client `orgId` is ignored |
| Enforcement decision | malicious/compromised extension claims `ALLOW` | decision is recomputed server-side from detection + policy |
| Prompt data leaving the org | secret exfiltration to AI providers | `BLOCK` (no upstream call) and `SANITIZE` (deterministic redaction) at the gateway |
| Service availability | brute force, oversized/hostile input | rate limits, body limits, zod validation, bounded pagination |
| Operator credentials | token forgery, replay, revoked sessions | HS256-only JWT with `exp`, `authVersion` revocation, device credential hashing |
| Outbound integrations | SSRF via Slack webhook | HTTPS-only URL guard, private/metadata/loopback hosts rejected |
| Source repository | committed secrets | git-ignored `.env`, placeholder-only examples, history scan |

Out of scope for this PoC: TLS interception, endpoint/DLP agents, SSO/SAML, MFA,
secrets managers, SIEM integration, distributed rate limiting, and protection
against a malicious **server operator**.

## Trust boundaries

```
[untrusted]  browser extension / any HTTP client
                |  (device credential, untrusted payload)
[trust]      API  →  authenticate → authorise (org-scoped)  →  policy engine
                                                                   |
                                            BLOCK ────────────────┤── STOP, audit
                                            SANITIZE ── redact ───┤── gateway ── provider
                                            ALLOW/WARN ───────────┘
```

Two rules that the tests exist to protect:

1. **The browser extension is not a security authority.** Severity, risk score,
   policy decision, enforcement status, `orgId`, and `userId` supplied by a
   client are ignored; the server derives all of them.
2. **`BLOCK` means no upstream request.** Proven by a `fetch` spy asserting zero
   provider calls, and in the container smoke test by
   `requestForwarded = false` on the stored event.

## Controls — status

| Area | Status |
|---|---|
| Authentication (signature, `alg` restriction, expiry, revocation, device/user state) | enforced + tested |
| Authorization / tenant isolation | enforced + tested |
| Server-authoritative policy at the gateway | enforced + tested |
| `BLOCK` / `SANITIZE` / `ALLOW` / `WARN` | enforced + tested (unit and container smoke) |
| Input validation (strict schemas, bounded pagination, CSV export) | enforced + tested |
| Rate limiting (auth, events, gateway, admin, policies) | enforced + tested (single instance) |
| CORS allowlist, CSP, security headers | enforced (nginx template) |
| Secrets hygiene and fail-fast startup | enforced + scanned |
| Structured logging with request IDs, no secrets/prompt content | enforced |
| Health / readiness / graceful shutdown | enforced (shutdown verified manually) |
| Response inspection | **detect + audit only — does not block or redact responses** |
| SSRF guard DNS resolution | **not implemented** (literal host/IP checks only) |
| Distributed rate limiting, HA WebSocket tickets | not implemented (single instance) |
| SSO/SAML, MFA, secrets manager, SIEM | not implemented (documented future work) |

## Reporting

Report suspected vulnerabilities privately to the repository owner; do not open
a public issue for exploitable bugs. Include the affected endpoint, reproduction
steps, and impact. Fixes for in-scope findings are recorded in
`SECURITY_TEST_REPORT.md` §4 with problem → root cause → fix → regression test.

## Verify it yourself

```bash
cd backend && npm test                    # 99 tests, incl. 51 security regression
cd ../shadow-extension && npm run test:config && npm run lint
cd ../frontend && npm run lint && npm run build
docker compose up -d --build              # /health, /ready
```

No test contacts a real AI provider: upstream `fetch` is a spy in unit tests,
and the container smoke test accepts a provider `401` (no credential) rather
than sending a real prompt for completion.
