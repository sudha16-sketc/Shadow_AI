# Demo Guide

A 15-minute script for showing the PoC to a potential collaborator. Everything
below runs locally, needs no AI-provider account, and never contacts a
third-party system.

---

## 0. Before anyone arrives (10 minutes)

```bash
# one-time
cp .env.example .env && cp backend/.env.example backend/.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # → backend/.env JWT_SECRET
docker compose up -d --build          # or run backend/frontend separately
```

Provision the platform administrator and a tenant:

```bash
cd backend
PLATFORM_ADMIN_EMAIL=admin@example.test PLATFORM_ADMIN_PASSWORD='…' npm run provision:platform-admin

# platform login → token
TOKEN=$(curl -s localhost:3001/api/platform-admin/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.test","password":"…"}' | jq -r .token)

# create a tenant
TENANT=$(curl -s localhost:3001/api/platform-admin/tenants \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Acme Corp","domain":"example.test"}' | jq -r .tenantId)

# invite the tenant admin (single use, 24h)
curl -s localhost:3001/api/platform-admin/tenants/$TENANT/invitations \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"email":"secadmin@example.test","role":"admin"}'
```

Open the invitation link in the dashboard (`/signup`) to create the tenant
admin, then sign in at `/`.

Build and load the extension:

```bash
cd shadow-extension && npm ci && npm run build:development
# chrome://extensions → Developer mode → Load unpacked → shadow-extension/dist
```

Prove the suite is green (show this on screen):

```bash
cd backend && npm test                      # 90 passed
cd ../shadow-extension && npm run test:config   # 10 passed
```

## 1. Minute 0–2 — the problem (screen: any AI chat)

> "An employee pastes an AWS key into a public AI tool. Nobody in the company
> ever finds out."

Paste a fake key: `AKIAIOSFODNN7EXAMPLE`. Point out there is no feedback on the
site itself.

## 2. Minute 2–5 — detection in the browser

1. Open the AI site in the extension's supported list (chatgpt.com, claude.ai,
   gemini.google.com …).
2. Paste the fake key into the prompt box.
3. **Expected:** the extension warning modal appears with severity and finding
   labels; the console shows metadata only (`textLength`, labels) — no raw text.

Talking points:

- Detection runs locally; nothing leaves the browser until the user acts.
- The user can justify the action (it lands in **Justifications** for review),
  or opt out entirely from the popup.

## 3. Minute 5–8 — the audit trail (screen: dashboard)

1. Sign in as the tenant admin → **Overview** (security score, recent events).
2. **Events** → find the detection: `findingLabels`, `riskScore`, `severity`,
   `policyDecision`, and `enforcementStatus`.
3. **Settings** → show the policy controls (default action, `blockOnHigh`,
   monitored domains, Slack webhook field).
4. **Audit Log** → every admin action, plus `gateway_response_finding` records.
5. **Justifications** → approve/reject the user's explanation.

Talking points:

- Events are tenant-scoped: the query carries the caller's `orgId`; a request
  naming another tenant is rejected with 403 (show the test name).
- `clientTelemetry` stored on gateway events is always empty — the client
  cannot authorise or downgrade anything.

## 4. Minute 8–12 — enforcement at the gateway (screen: terminal)

**a. BLOCK — the headline guarantee, no outbound call**

```bash
# tenant admin token
T=$(curl -s localhost:3001/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"secadmin@example.test","password":"…"}' | jq -r .token)

# set the tenant default action to BLOCK
curl -s -X PATCH localhost:3001/api/settings/org/policy \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"defaultAction":"BLOCK"}'

# mint a device credential (normally the extension does this after pairing)
CODE=$(curl -s localhost:3001/api/auth/device/enrollment-code \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"label":"demo"}' | jq -r .code)
DVC=$(curl -s localhost:3001/api/auth/device/register \
  -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}" | jq -r .token)

# send a prompt through the gateway
curl -s -i localhost:3001/gateway/v1/openai/v1/chat/completions \
  -H "authorization: Bearer $DVC" -H 'content-type: application/json' \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"use key AKIAIOSFODNN7EXAMPLE"}]}'
```

**Expected:** `HTTP/1.1 403`, body
`{"error":"Blocked by Shadow AI Security Policy","decision":{…},"requestId":"…"}`.

Show the matching event in **Events**: `enforcementStatus = PREVENTED`,
`requestForwarded = false`, and state plainly:

> "The provider was never contacted. That assertion has a test:
> `BLOCK never contacts the upstream provider`."

**b. Header hygiene (optional, 1 minute)**

```bash
curl -s -i localhost:3001/gateway/v1/openai/v1/chat/completions \
  -H "authorization: Bearer $DVC" \
  -H 'cookie: session=super-secret' \
  -H 'x-upstream-auth: Bearer sk-demo' \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
```

Talking point: cookies and our own JWT are dropped; only the caller's
`x-upstream-auth` becomes `authorization`. (If the org default is ALLOW this
call reaches OpenAI and returns 401 without a key — set the action back to BLOCK
first to keep the demo fully offline.)

**c. SANITIZE (optional — requires accepting one outbound request)**

```bash
curl -s -X PATCH localhost:3001/api/settings/org/policy \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"defaultAction":"SANITIZE"}'
```

Repeat (a), then show the event:
`enforcementStatus = SANITIZED`, `sanitizedRedactions ≥ 2`. The forwarded
payload contained `[REDACTED:Email Address]` and `[REDACTED:AWS Access Key]`,
never the original strings. Skip this step if you want zero outbound calls.

## 5. Minute 12–15 — how we know it works

Terminal, on screen:

```bash
cd backend && npm test
# Test Suites: 5 passed, 5 total
# Tests:       90 passed, 90 total
```

Then open:

- `SECURITY_TEST_REPORT.md` — commands, counts, and the 20 findings fixed.
- `SECURITY_FEATURES.md` — control list with `[T]`/`[D]` markers; note that
  limitations are documented rather than hidden.
- `PRODUCTION_GAP_ANALYSIS.md` — P0/P1/P2 gaps with effort estimates.

Talking points:

- "We do not claim what we have not tested."
- "Response inspection reports but does not block — that is a documented gap,
  not an oversight."

## 6. Obvious questions, short answers

| Question | Answer |
|---|---|
| Where is the code for BLOCK? | `backend/src/routes/gateway.js`, `policyResult.decision === 'BLOCK'` |
| Can a user downgrade their own risk? | No — severity/decision come from server-side detection and the policy engine; tested. |
| What happens if the database is down? | `/ready` returns 503; policy evaluation fails **closed** (BLOCK). |
| Does the extension read every page? | No — host permissions are limited to the supported AI sites and the configured API origin (tested). |
| Where do secrets live? | Git-ignored `.env` files or a secret manager; history was scanned across all 16 revisions with 0 hits. |
| Can we run this behind a proxy? | Yes, with `TRUST_PROXY=true`; CSP/CORS are environment-driven. |
| What is the biggest risk today? | Listed in `PRODUCTION_GAP_ANALYSIS.md` P0 (DNS-blind SSRF guard, no token rotation, no CI). |

## 7. If something breaks

| Symptom | Fix |
|---|---|
| Backend exits with a JWT error | `JWT_SECRET` missing/short in `backend/.env` (needs 48+ bytes) |
| Dashboard can't reach the API | `VITE_API_URL` mismatch — restart `npm run dev` or rebuild with the right value |
| Extension shows "not connected" | Generate a new pairing code: dashboard → Settings → device enrollment |
| No events appear | Extension must be on a supported AI origin and not opted out |
| Rate limit 429 during the demo | Wait 60 minutes or restart the backend (limiters are per-process) |
| `/ready` returns 503 | Mongo is down — expected, and worth showing |

## 8. What not to claim

- Do not say "HIPAA/SOC 2 ready" — the control mapping does not exist yet.
- Do not say responses are blocked — they are detected and audited.
- Do not demonstrate against a real company's AI account or a real Slack
  workspace; use the local tenant and a placeholder webhook.
