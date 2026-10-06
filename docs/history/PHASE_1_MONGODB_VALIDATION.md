# Phase 1 MongoDB Validation Procedure

## Scope and Safety

This procedure validates the `Event` idempotency index, `EventReplay` fingerprint uniqueness/TTL indexes, server startup migration, and concurrent duplicate behavior. It must run only against an isolated staging clone or database named `staging` / `phase1-validation`. The validation script rejects other database names and requires an explicit backup confirmation.

**No production collection is to be dropped, rewritten, or deduplicated by this procedure.** The application startup only drops the legacy `orgId_1_idempotencyKey_1` index after connecting, then builds current indexes; it does not delete event documents. A unique-index build will fail closed if conflicts remain.

## 1. Backup

Use a secure operations host with `mongodump`/`mongorestore` installed. Supply connection strings through protected environment injection; do not paste real URIs into tickets, shell history, terminal logs, or this document.

PowerShell example:

```powershell
$env:SOURCE_MONGODB_URI = '<secret-manager-injected-source-uri>'
mongodump --uri="$env:SOURCE_MONGODB_URI" --archive="phase1-before-migration.archive.gz" --gzip
```

Confirm the dump exists, record its checksum and timestamp in the change record, and verify it can be listed/restored into a disposable database before continuing.

## 2. Clone To An Isolated Staging Copy

Restore to a dedicated database whose name ends in `staging` or `phase1-validation`. Do not point the application at the source URI.

```powershell
$env:STAGING_MONGODB_URI = '<secret-manager-injected-staging-copy-uri>'
mongorestore --uri="$env:STAGING_MONGODB_URI" --archive="phase1-before-migration.archive.gz" --gzip --nsFrom="source_db.*" --nsTo="shadow_ai_phase1_staging.*"
```

Use a staging credential with access only to the staging database. Validate the target database name before running the application or scripts.

## 3. Inspect Existing Indexes

In `mongosh`, connected only to the staging clone:

```javascript
db.events.getIndexes()
db.eventreplays.getIndexes()
db.orgs.find({ lifecycleStatus: { $exists: false } }, { _id: 1, name: 1 }).limit(100)
```

Expected current indexes include:

- `events`: unique partial `{ orgId: 1, deviceId: 1, idempotencyKey: 1 }` where `idempotencyKey` is a string; existing TTL/tenant query indexes may also remain.
- `eventreplays`: unique `{ orgId: 1, deviceId: 1, fingerprint: 1 }` and TTL `{ expiresAt: 1 }` with `expireAfterSeconds: 0`.
- `orgs`: lifecycle status index.

Record index names, key patterns, options, and any drift before proceeding.

## 4. Find Idempotency Duplicates Before Index Migration

Run on the staging clone only:

```javascript
db.events.aggregate([
  { $match: { idempotencyKey: { $type: 'string' }, orgId: { $exists: true } } },
  { $group: {
      _id: { orgId: '$orgId', deviceId: '$deviceId', idempotencyKey: '$idempotencyKey' },
      count: { $sum: 1 },
      ids: { $push: '$_id' }
  } },
  { $match: { count: { $gt: 1 } } }
])
```

Also inspect replay records:

```javascript
db.eventreplays.aggregate([
  { $group: {
      _id: { orgId: '$orgId', deviceId: '$deviceId', fingerprint: '$fingerprint' },
      count: { $sum: 1 },
      ids: { $push: '$_id' }
  } },
  { $match: { count: { $gt: 1 } } }
])
```

The staging validator aborts if duplicate event key groups exist. Resolve conflicts only on the clone after data-owner review. Preserve a copy of every affected record and document which canonical record remains. Do not automatically delete duplicate events: they may represent distinct real user actions that were previously accepted under a global key scope.

## 5. Remediate Legacy Data And Migrate Indexes

For existing organizations missing `lifecycleStatus`, confirm ownership and intended access with the tenant/data owner first. Only verified existing tenants should be marked `active`; do not activate orphan, test, or unverified organizations. Keep organizations with an outstanding admin invitation in `pending_admin` and disabled tenants in `suspended`.

The service startup migration drops only the old sparse `orgId_1_idempotencyKey_1` index, then calls `createIndexes()` for events, replay records, devices, organizations, platform admins, invitations, and platform audit logs before opening its listener. If the new unique index detects duplicates or index construction fails, startup must remain down and the staging issue must be resolved before retrying.

## 6. Run Index And Concurrent Replay Validation

From `backend/`, point only at the staging clone and explicitly confirm its use:

```powershell
$env:PHASE1_STAGING_MONGODB_URI = '<secret-manager-injected-staging-copy-uri>'
$env:PHASE1_STAGING_BACKUP_CONFIRMED = 'YES_BACKED_UP_STAGING_COPY'
npm run validate:mongodb-replay
```

The script verifies duplicate groups, removes the obsolete index if present, builds current indexes, asserts their definitions, races 12 inserts with the same tenant/device/idempotency key, races 12 replay reservations with the same fingerprint, checks other tenant/device scopes remain independent, and deletes only the uniquely tagged test documents it created. Review cleanup counts and final indexes afterward.

Then verify organization lifecycle indexes and tenant behavior using the actual backend against staging. Use a distinct, short-lived staging `JWT_SECRET` and staging-only users/devices. Never use production tokens or production user identities.

## 7. Startup Verification

Start the backend against the staging clone with `JWT_SECRET` injected from the staging secret store and with no production credentials present:

```powershell
npm start
```

Confirm logs show MongoDB connected and that the HTTP listener starts only after index creation succeeds. Confirm a deliberate duplicate/index conflict causes startup to fail before listening. Do not turn on debug logging that reveals secrets.

## 8. Rollback

If validation fails:

1. Stop the staging backend and confirm it is not connected to any production URI.
2. Preserve migration logs and the staging clone for diagnosis.
3. Restore the original staging clone from the verified pre-migration archive into a fresh staging database.
4. Repoint only the staging deployment to that restored clone and verify it is healthy.
5. Do not restore the obsolete index manually as a production workaround; fix the data/index conflict, rerun validation, and repeat the reviewed migration.
6. Production rollback requires a separate approved change, verified production backup, and data-owner/operations sign-off. No production rollback or production data mutation is authorized by this procedure.

## Current Validation Status

No real MongoDB validation has been claimed. The local Docker daemon/MongoDB service was unavailable during implementation. The code-level mounted tests use in-memory model fakes; execute this procedure against a backed-up staging MongoDB instance before onboarding production tenants.
