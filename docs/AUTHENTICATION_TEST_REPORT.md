# Authentication Test Report

Evidence for the login fix in `docs/AUTHENTICATION_LOGIN_FIX.md`.

No real credentials, JWT secrets, connection strings, or invitation tokens are
reproduced here.

---

## 0. Verification audit

Results are labelled by **how** they were obtained:

- **Executed in audit** — commands run during the final review.
- **Earlier run** — obtained earlier in the same session, not re-run.
- **Reconstructed** — derived from direct measurements.

| Check | Status | Source |
|---|---|---|
| Auth + provisioning + security regression suites | **72 passed** (3 suites) | Executed in audit |
| Frontend ESLint | **0 errors**, 9 pre-existing warnings | Executed in audit |
| Frontend production build | **Passed** (1742 modules) | Executed in audit |
| Graceful-shutdown integration suite | **1 failed** (environment) | Executed in audit |
| Child import cost measurement | **47.1 s** (`app.js`) | Reconstructed from measurement |
| Full backend suite (all 9 suites) | 119 passed / 1 failed | Earlier run |
| Local end-to-end onboarding flow | Passed | Earlier run |
| Committed-secret scan | **No secrets found** | Executed in audit |

## 1. Environment

- Backend: Node 22 (ESM, Jest via `--experimental-vm-modules`), in-memory model
  doubles via `backend/tests/helpers/mock-app.js`; `fetch` is a spy. No Atlas
  access.
- Frontend: Vite + ESLint.
- The repository lives on a WSL `/mnt/d` (9p) mount; module imports there are
  ~10–100× slower than a native filesystem. This is the root cause of the single
  failing suite (§5).
- The end-to-end check uses a **local, throwaway** MongoDB database
  (`shadow-ai-authflow-verify`), created and dropped by the script; Atlas is never
  contacted.

## 2. Automated backend tests

### Executed in audit

```
cd backend
npm test -- tests/auth-login.test.js tests/provision-platform-admin.test.js tests/security-regression.test.js
# Test Suites: 3 passed, 3 total
# Tests:       72 passed, 72 total
# Time:        60.003 s
```

Breakdown: `auth-login` 13, `provision-platform-admin` 6, `security-regression` 53.

#### `tests/auth-login.test.js` — 13 passed

| # | Case | Asserts |
|---|---|---|
| 1 | Authenticates a provisioned platform administrator via the platform-admin endpoint | `200`, token `tokenType: platform_admin` |
| 2 | Rejects platform-admin credentials on the tenant login endpoint | `401 { error: 'Invalid credentials' }` |
| 3 | Authenticates a valid tenant administrator via the tenant endpoint | `200`, token `tokenType: user`, correct `orgId` |
| 4 | Rejects tenant-user tokens on platform-admin endpoints | `401` |
| 5 | Requires a platform credential to list tenants | `401` |
| 6 | Compares against a bcrypt hash rather than plaintext | hash starts `$2`, ≠ plaintext, login `200` |
| 7 | Rejects incorrect passwords for both account types | `401` / `401` |
| 8 | Rejects inactive accounts and non-active tenants | `401` (inactive platform admin, inactive user, `pending_admin` org) |
| 9 | Rejects missing, malformed, wrong-type, and context-less tokens | four × `401` |
| 10 | Enforces tenant isolation on tenant-scoped routes | own org `200`; `?orgId=<other>` `403` |
| 11 | Accepts an invitation and produces a usable tenant administrator | `201`, stored `tokenHash ≠ token`, tenant login `200`, dashboard `200`, org `active`, user `admin`/`isActive` |
| 12 | Rejects reused and expired invitations | first `201`, reuse `401`; expired `401`, org stays `pending_admin`, no user created |
| 13 | Lists tenants without leaking tokens | `200`; response contains no raw token and no `tokenHash` |

#### `tests/provision-platform-admin.test.js` — 6 passed

| # | Case | Asserts |
|---|---|---|
| 1 | Rejects missing/malformed configuration before any connection | throws on email, password (<16), `MONGODB_URI` |
| 2 | Normalises the email and accepts valid config | trims + lowercases |
| 3 | Creates an administrator with a bcrypt hash, no plaintext | `passwordHash` `$2…`, `bcrypt.compare` true |
| 4 | Never resets an existing administrator / never duplicates | rejects `already assigned`; `create` not called |
| 5 | Refuses an email already used by a tenant user | rejects `already assigned`; `create` not called |
| 6 | CLI fails safely with non-zero exit, no stack trace | exit `1`, prints `Provisioning failed:`, no `at Object.` |

### Full backend suite — earlier run

```
# Test Suites: 1 failed, 8 passed, 9 total
# Tests:       1 failed, 119 passed, 120 total
```

The single failure is `tests/graceful-shutdown.integration.test.js` — see §5.

## 3. Frontend checks — executed in audit

```
cd frontend
npm run lint
# ✖ 9 problems (0 errors, 9 warnings)   # all pre-existing in other pages

npm run build
# ✓ 1742 modules transformed.  ✓ built in 52.78s
```

The 9 warnings are `react-hooks/exhaustive-deps` in `Analytics`, `AuditLog`,
`Events`, `Justifications`, `Overview`, `Settings`, `Users` — none in the new
auth pages.

## 4. Real end-to-end verification (local MongoDB) — earlier run

Executed via a script that provisions the platform admin, starts the API on
`:3999` against a throwaway local database, runs the flow, then drops the
database. Observed output:

```
### provision platform admin (1st run, expect success)
Platform administrator provisioned.
### provision platform admin (2nd run, expect refusal, no reset)
RESULT: refused -> Provisioning failed: This email is already assigned to an administrator or tenant user; no changes were made.
### start API
health: {"status":"ok",...}
### platform admin login via platform endpoint
status=200 token_len=248
### create tenant + invitation
status=201 invite_token_len=32
### accept invitation (onboard tenant admin)
status=201 body={"activated":true,"tenantId":"...","email":"verify-tenant@example.test"}
### reuse same invitation (expect 401)
status=401
### tenant admin login via tenant endpoint
status=200 token_len=269
### tenant dashboard resource
settings: status=200
### wrong password (expect 401)
status=401
### platform-admin credentials on tenant endpoint (expect 401)
status=401
### tenant token on platform endpoint (expect 401)
status=401
### platform tenant listing
status=200
### server log (db name, no secrets)
MongoDB connected (database: shadow-ai-authflow-verify)
DONE
```

This confirms the definition of done: provision → platform login → create tenant
→ onboard tenant admin → tenant login → dashboard, with authorization boundaries
intact, and single-use invitations.

## 5. Limitations

### 5.1 `graceful-shutdown.integration.test.js` fails in this environment

Re-run in audit:

```
FAIL tests/graceful-shutdown.integration.test.js (20.589 s)
  ✕ terminates cleanly on SIGTERM with exit code 0 and disconnects database (10024 ms)
    Server shutdown timed out after 10000ms. stdout: , stderr:
```

`stdout`/`stderr` are **empty**, i.e. the child never reached
`SERVER_STARTED_PORT` within the 10 s window. Measured:

```
$ time (node --input-type=module -e 'await import("./src/app.js")')   # JWT_SECRET set
real  0m47.119s

$ time (node --input-type=module -e 'await import("./src/models/index.js")')
real  0m30.896s
```

**Determination on a portable timeout adjustment:** the test conflates process
cold-start/import time with actual shutdown time in one 10 s timer. A portable,
non-weakening fix is to decouple them: (a) a generous, env-overridable startup
budget that only waits for `SERVER_STARTED_PORT:`; then (b) a separate, short
shutdown budget asserting exit code 0 and `SHUTDOWN_CLEANUP_DONE:dbClosed=true`.
Simply raising the single timer would be weaker (it would hide real hangs) and is
not recommended. **Not applied** — outstanding, requires approval.

### 5.2 Provisioning is unit-tested, not DB-integrated, in Jest

The provision helper is tested with injected fakes (no MongoDB), and the CLI guard
is tested by spawning with missing config. The real provisioning path is instead
covered by the end-to-end script in §4.

### 5.3 No browser automation

The frontend platform-console pages were validated by ESLint + production build,
source review, and by exercising the same APIs they call. They were not driven by
a headless browser.

## 6. Requirement → evidence map

| Requirement | Evidence |
|---|---|
| Provisioned platform admin authenticates via platform endpoint | §2 test 1 |
| Platform admin cannot use tenant endpoint | §2 test 2; §4 `status=401` |
| Valid tenant admin authenticates | §2 test 3 |
| Incorrect passwords rejected | §2 tests 7, 8; §4 `status=401` |
| Password hashing correct | §2 tests 3, 6 (backend) |
| Inactive accounts / inactive orgs rejected | §2 test 8 |
| Missing/malformed tokens rejected | §2 test 9 |
| Cross-tenant access rejected | §2 test 10 |
| Platform endpoints reject tenant users | §2 tests 4, 5; §4 `status=401` |
| Invitation acceptance creates usable admin | §2 test 11; §4 `status=201`, tenant login `200` |
| Expired/reused invitations rejected | §2 test 12; §4 reuse `401` |
| Provisioning does not reset existing admin | §2 provision tests 4, 5; §4 refusal on 2nd run |
| Tenant listing does not leak tokens | §2 test 13 |

## 7. Security & repository audit

### 7.1 Route and identity wiring (source review)

- `backend/src/app.js:138` mounts platform routes at `/api/platform-admin`;
  `:139` mounts tenant auth at `/api/auth`. Tenant resources are behind
  `authMiddleware` (`app.js:141-147`).
- `platform-admin.js` defines the public `POST /auth/login` and
  `POST /invitations/accept` **before** `router.use(platformAdminAuthMiddleware)`,
  so only those two are unauthenticated.
- Identity separation is enforced in the middleware: `authMiddleware` requires
  `tokenType === 'user'` (`middleware/auth.js:45`); `platformAdminAuthMiddleware`
  requires `tokenType === 'platform_admin'` (`middleware/auth.js:119`). Separate
  collections (`User` vs `PlatformAdmin`).

### 7.2 Frontend review (new pages)

- `PlatformLogin.jsx` → `platformLogin()` → `POST /api/platform-admin/auth/login`.
- `Signup.jsx` at `/login` (via `initialLogin`) → `login()` → `POST /api/auth/login`.
- `PlatformAdmin.jsx` API paths and request/response shapes match the backend.
- Invitation link is built from `window.location.origin` + `/accept-invitation`.
- `AcceptInvitation.jsx` posts `{token,password}`, enforces ≥12 chars + confirmation.

### 7.3 Observations (not failures)

- **Token storage:** both tokens persist to `localStorage` (zustand `persist`, key
  `shadow-ai-auth`). Matches the pre-existing tenant design; the platform token is
  the higher-value XSS target. Hardening advisable, out of scope.
- **Auto-logout timer restarts on reload:** `App.jsx:61-69` restarts the 15-minute
  timer on reload; the server still rejects an expired token (401).
- **`PlatformAdmin.handleReissue` sends the org name as the invitee name**
  (`body.name = tenant.name`) — cosmetic.

### 7.4 Committed-secret scan (no secrets printed)

- `.env.example` across **all** revisions contains **0** occurrences of
  `mongodb+srv`, `sudhakar`, or any non-empty `PLATFORM_ADMIN_PASSWORD`.
- Across tracked `HEAD`, no occurrence of the account email, the Atlas host, or
  `mongodb.net`. `mongodb+srv` appears once each in `backend/.env.example` and
  `SECURITY_TEST_REPORT.md` as a generic example; `sudhakar` appears once in
  `frontend/src/pages/Hero.jsx` as a LinkedIn author credit.
- No tracked `.env` files (only `*.env.example`); `.env` is git-ignored and
  `backend/.env` is not tracked.

**Outstanding:** no history rewrite required. Credential rotation is still
recommended because the live Atlas URI/credentials existed in the working
environment and were displayed in plaintext earlier; treat them as exposed.
