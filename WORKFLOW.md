# Workflow

How this repository is developed, tested, and released. Read alongside
`PROJECT_OVERVIEW.md` (scope) and `SECURITY_TEST_PLAN.md` (what must be proven
before a change is considered done).

---

## 1. One-time setup

```bash
git clone https://github.com/sudha16-sketc/Shadow_AI.git
cd Shadow_AI

cp .env.example .env
cp backend/.env.example backend/.env
# generate and paste a JWT secret into backend/.env:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker run -d -p 27017:27017 --name mongo mongo:7   # or use docker compose

cd backend && npm install && npm run dev            # API  :3001
cd frontend && npm install && npm run dev           # UI   :5173
```

`.env` files are git-ignored; `.env.example` files are committed on purpose and
must never contain real values.

## 2. Daily loop

| Step | Command | Expect |
|---|---|---|
| Backend tests | `cd backend && npm test` | 90 passed |
| Extension tests | `cd shadow-extension && npm run test:config` | 10 passed |
| Extension lint | `cd shadow-extension && npm run lint` | clean |
| Frontend lint | `cd frontend && npm run lint` | 0 errors |
| Frontend build | `cd frontend && npm run build` | success |
| Extension build | `cd shadow-extension && npm run build:development` | success |

All of these run offline: tests use in-memory model doubles and a spy for
`fetch`, so no database or AI provider account is needed.

## 3. Where to change what

| You want to… | Touch | Then also |
|---|---|---|
| Add/alter a detection pattern | `shadow-extension/src/content.js`, `backend/src/routes/gateway.js` | `docs/SECURITY_TEST_PLAN.md` detection cases; keep both copies in sync |
| Change enforcement behaviour | `backend/src/routes/gateway.js` | add a case under `backend/tests/security-regression.test.js` |
| Change decision logic | `backend/src/services/policy-engine.js` | `backend/tests/policy-engine.test.js` |
| Add an API route | `backend/src/routes/*.js` + mount in `backend/src/app.js` | tenant scoping test, pagination bounds if it lists |
| Change dashboard pages | `frontend/src/pages/*.jsx` | `npm run lint` |
| Change extension packaging | `shadow-extension/public/manifest.json`, `vite.config.js` | `npm run test:config` (packaging assertions) |

## 4. Test conventions

- New backend tests go in a **new file** under `backend/tests/`; existing suites
  are treated as frozen regression baselines.
- Reuse `backend/tests/helpers/mock-app.js` — it registers the in-memory model
  doubles, mocks alerting/scoring/side effects, starts a real HTTP server on an
  ephemeral port, and exposes `httpRequest`, `mockFetch`, `seedOrg`, `seedUser`,
  `userToken`.
- Never write a test that requires MongoDB or makes a network call.
- Never claim a test passed without running it; `docs/SECURITY_TEST_REPORT.md`
  records the exact commands and counts.

Run a single suite:

```bash
cd backend
npm test -- tests/security-regression.test.js
npm test -- -t "SANITIZE"          # by test name
```

## 5. Tenant and user onboarding (there is no self-service)

```
operator  → npm run provision:platform-admin   (PLATFORM_ADMIN_EMAIL/PASSWORD)
platform  → POST /api/platform-admin/auth/login
          → POST /api/platform-admin/tenants                    → tenant created
          → POST /api/platform-admin/tenants/:id/invitations    → 24h single-use token
invitee   → POST /api/platform-admin/invitations/accept         → tenant active + first admin
admin     → dashboard: create users, pair devices, set policy
user      → POST /api/auth/login → POST /api/auth/device/enrollment-code
extension → POST /api/auth/device/register  (one-time pairing code)
```

`POST /api/auth/signup` is intentionally disabled (403): accounts only exist
through an invitation.

## 6. Extension release modes

```bash
npm run build:development   # http://localhost:3001 default, no env file needed
npm run build:staging       # requires shadow-extension/.env.staging
npm run build:production    # requires shadow-extension/.env.production, HTTPS + non-local
```

`vite.config.js` refuses to build staging/production against a localhost or
non-HTTPS `VITE_API_URL`, and rewrites the packaged manifest so `host_permissions`
contains only the configured API origin plus the supported AI sites.
Load the result with *Load unpacked* → `shadow-extension/dist`.

## 7. Dashboard release modes

The API origin is baked in at build time (`VITE_API_URL`). `frontend/nginx.conf`
is an envsubst template: the container receives `API_ORIGIN` at runtime and the
CSP `connect-src` list is rendered from it.

```bash
VITE_API_URL=https://api.example.com docker compose build frontend
```

## 8. Deployment

```bash
cp .env.example .env          # fill JWT_SECRET, VITE_API_URL, CORS_ORIGINS
docker compose up -d --build
# dashboard :5173, API :3001, mongo :27017 (not meant to be public)
```

Set `TRUST_PROXY=true` only when a reverse proxy in front of the backend
supplies `X-Forwarded-For`.

## 9. Security review workflow (for every non-trivial change)

1. **Scan** — identify the boundary you touched (input, auth, upstream, output).
2. **Understand** — read `SECURITY_FEATURES.md` for the existing control.
3. **Lock scope** — decide what is a fix versus a new feature; record new gaps
   in `PRODUCTION_GAP_ANALYSIS.md` instead of half-building them.
4. **Implement** smallest change that closes the gap.
5. **Prove** — add/extend a test, run the full suites, paste real output into
   `SECURITY_TEST_REPORT.md`.
6. **Document** — update the control description and the known limitations.

Evidence beats assertion: if a control is not tested, it is treated as absent.

## 10. Git hygiene

- Secrets live only in git-ignored `.env` files or a secret manager. Never
  commit them; `backend/tests/security-regression.test.js` scans application
  source for known credential shapes.
- Keep `docs/history/` as-is — it is the audit trail of decisions already made.
- Do not commit `dist/`, `node_modules/`, or the packaged extension zip.
