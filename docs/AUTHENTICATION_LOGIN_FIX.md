# Authentication & Login Fix

Status: implemented and verified against a real (local) MongoDB.
Scope: platform-administrator vs. tenant-user authentication, provisioning, and
tenant onboarding.

No credentials, JWT secrets, connection strings, or invitation tokens appear in
this document; all examples use placeholders.

---

## 1. Reported symptom

Running `cd backend && npm run provision:platform-admin` reported
`Platform administrator provisioned.` and MongoDB connected, but signing in
through the dashboard returned:

```
POST /api/auth/login 401 Invalid credentials
```

## 2. Confirmed root cause

The application has **two separate account types**, stored in two collections and
served by two different endpoints:

| Account type | Collection | Login endpoint |
|---|---|---|
| Platform administrator | `platformadmins` | `POST /api/platform-admin/auth/login` |
| Tenant user (incl. tenant admin) | `users` | `POST /api/auth/login` |

The dashboard's only login form (`frontend/src/hooks/useAuth.js`, used by
`frontend/src/pages/Signup.jsx`) posts to `POST /api/auth/login`, which looks up
a **`User`** and additionally requires:

- the user to exist and be `isActive`,
- a matching bcrypt password hash (`backend/src/routes/auth.js:36-47`), and
- the user's `Org` to have `lifecycleStatus: 'active'`
  (`backend/src/routes/auth.js:49-50`).

`backend/scripts/provision-platform-admin.mjs` creates a **`PlatformAdmin`**, so
those credentials can never satisfy the tenant login route. **The frontend had no
platform-administrator login page at all**, so the platform administrator could
not sign in anywhere, and the tenant login page could not accept platform-admin
credentials without weakening the security model.

Additionally, the committed `./.env.example` had been edited in place with a real
MongoDB Atlas connection string and real bootstrap credentials. That file is
tracked by git, so it was reset to placeholders (see §6).

### What was checked and found **not** to be the cause

- Provisioning script and running backend both read `MONGODB_URI` via
  `dotenv/config` from `backend/.env`; both target the same database.
- Password hashing/verification both use `bcryptjs` (cost 12) — consistent.
- Email normalization (lowercase/trim) is consistent across both paths.
- `JWT_SECRET` is validated at startup (`backend/src/config/security.js`); it was
  present and valid.
- The provisioned account existed and was `isActive`.

Traced end to end, the failure was purely an **account-type / endpoint /
frontend-routing** mismatch, not a hashing or database bug.

## 3. Architectural decision

Keep the two identities strictly separate (this is the existing, correct design):

- **Platform Administrator** authenticates only at
  `/api/platform-admin/auth/login` and receives a short-lived (15 min) token with
  `tokenType: 'platform_admin'`. It manages tenants and invitations and gains
  **no** tenant-level access merely by logging in.
- **Tenant Administrator** authenticates only at `/api/auth/login`, must belong to
  an active org, and can access only its own tenant's resources.

No authentication checks were weakened, no account types were merged, and no
client-supplied `orgId`/role/user is trusted.

## 4. Changes

### Backend

| File | Change |
|---|---|
| `backend/scripts/provision-platform-admin.mjs` | Added `readProvisionConfig()` (validates email format, ≥16-char password and `MONGODB_URI` **before** connecting) and `provisionPlatformAdmin()` (testable, hashes with the same bcrypt scheme, refuses — without resetting — an email already used by a platform admin or tenant user). CLI prints a clear non-sensitive failure and exits non-zero. |
| `backend/src/routes/platform-admin.js` | Added `GET /api/platform-admin/tenants` (behind `platformAdminAuthMiddleware`) for the console: tenant lifecycle status + outstanding-invitation email, bounded `limit`, and **no token/hash leakage**. |
| `backend/src/server.js` | Connection log now includes the **database name** (`MongoDB connected (database: …)`) so operators can confirm the API and the provisioning script target the same DB. No credentials or host are logged. |
| `backend/tests/helpers/mock-app.js` | Mock specifiers are now resolved relative to the helper file (absolute), so the shared harness works when a test file is run on its own. |

### Frontend

| File | Change |
|---|---|
| `frontend/src/hooks/useAuth.js` | Added a **separate** platform-admin session (`platformToken`, `platformAdmin`, `platformLogin`, `platformLogout`) plus `usePlatformApi()`. Tenant `login`/`logout`/`useApi` are unchanged. Hooks are memoized with `useCallback`. |
| `frontend/src/pages/PlatformLogin.jsx` | New platform-console sign-in page. |
| `frontend/src/pages/PlatformAdmin.jsx` | New console: provision a tenant, view tenants and status, re-issue invitations, suspend/reactivate tenants, and copy the one-time onboarding link. |
| `frontend/src/pages/AcceptInvitation.jsx` | New public page to accept an invitation and set the tenant-admin password. |
| `frontend/src/pages/Signup.jsx` | Accepts `initialLogin`; added a link to the platform console. |
| `frontend/src/App.jsx` | Routes: `/login` (tenant), `/platform/login`, `/platform` (guarded), `/accept-invitation`; platform token auto-logout on expiry. |

### Repository hygiene

| File | Change |
|---|---|
| `./.env.example` | Restored placeholder values (removed the real Atlas URI and real bootstrap credentials). |

## 5. Correct workflow (reproduction)

```bash
# 0. Configure backend/.env (git-ignored): JWT_SECRET (48+ random bytes) and
#    MONGODB_URI pointing at the intended database. Generate a secret:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 1. Provision the platform administrator (env vars are required, 16+ char password)
cd backend
PLATFORM_ADMIN_EMAIL='admin@example.test' \
PLATFORM_ADMIN_PASSWORD='a-strong-passphrase-0001' \
npm run provision:platform-admin

# 2. Run the API and dashboard
npm run dev                                   # API :3001
cd ../frontend && npm run dev                 # dashboard :5173
```

Then, in the browser:

1. Open `http://localhost:5173/platform/login` and sign in as the platform
   administrator.
2. Provision a tenant (name, admin name, admin email). The console shows a
   one-time onboarding link.
3. Send that link to the tenant administrator.
4. The invitee opens
   `http://localhost:5173/accept-invitation?token=<invitation-token>` and sets a
   password (min 12 chars). This activates the org and the tenant admin.
5. The tenant administrator signs in at `http://localhost:5173/login` and reaches
   the dashboard.

**Login URLs by account type**

| Account type | URL |
|---|---|
| Platform administrator | `/platform/login` → console at `/platform` |
| Tenant administrator / user | `/login` (or `/signup` → Login tab) |

## 6. Security notes

- Platform and tenant credentials are accepted only on their own endpoints;
  cross-use returns `401` (covered by tests).
- Invitation tokens are 32-char random values, stored only as SHA-256 hashes, are
  single-use, expire after 24 h, and cannot be reused (covered by tests).
- Provisioning never overwrites an existing identity or resets its password.
- `JWT_SECRET` has no fallback default; invalid secrets fail startup.
- The committed `.env.example` no longer contains secrets. Because a real Atlas
  URI and credentials were previously present in the working environment, rotate
  that Atlas database user's credentials.

## 7. Known limitation discovered during verification

The `backend/tests/graceful-shutdown.integration.test.js` suite spawns a child
process and requires `SERVER_STARTED_PORT:` within 10 s. On this WSL developer
machine the repository lives on a `/mnt/d` (9p) mount where importing `app.js`
alone takes ~30–47 s, so the child misses the deadline and the suite fails here.
The failure is an I/O-speed artifact of the mount, not a code defect; it
reproduces independently of these changes. See
`docs/AUTHENTICATION_TEST_REPORT.md` for the exact evidence.
