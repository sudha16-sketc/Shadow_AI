# Secret Rotation Plan for Shadow AI

## Purpose

This document defines the secret remediation work required before the product can be treated as a production-ready multi-tenant system. It is based on the assessment findings and is intentionally focused on secrets, credential cleanup, and operational controls.

## Current assessment findings

The assessment documents identified several classes of secrets and credentials that are present or strongly suspected in the repository or deployment environment:

- JWT secret
- MongoDB credentials
- SMTP credentials
- Slack webhook URL
- alerting or application email address
- frontend/backend environment values and connection configuration

These are not a complete list if additional deployment or CI secrets are present outside the reviewed repo state.

## Secret inventory and status

### 1. JWT secret
- Current location: backend/.env and backend runtime environment path
- Risk: high if retained in repository or shared across environments
- Exposure status: likely exposed in the source tree as a committed file
- Rotation required: yes
- Revocation required: yes, for all issued tokens
- Production requirement: secret manager-backed, environment-specific, rotated regularly

### 2. MongoDB connection string and credentials
- Current location: backend/.env
- Risk: high; database access can be used for tenant data exposure
- Exposure status: likely exposed in repository state
- Rotation required: yes
- Revocation required: yes; rotate credentials and regenerate database access permissions
- Production requirement: managed secret store; service account with least privilege

### 3. SMTP credentials
- Current location: backend/.env
- Risk: medium to high; can allow email interception or spoofed alerting
- Exposure status: likely exposed in repository state
- Rotation required: yes
- Revocation required: yes
- Production requirement: environment-scoped credentials with restricted access

### 4. Slack webhook URL
- Current location: backend/.env and app configuration
- Risk: high; webhook can be abused to send spoofed alerts or leak internal system information
- Exposure status: likely exposed in repository state
- Rotation required: yes
- Revocation required: yes; regenerate and rotate the Slack incoming webhook
- Production requirement: secret manager + team ownership

### 5. Alerting email / operational contact address
- Current location: backend/.env and app settings
- Risk: medium; can be abused for social engineering or sensitive message routing
- Exposure status: likely exposed in repository state
- Rotation required: likely not a secret, but the address should be reviewed for exposure scope
- Revocation required: evaluate owner and access controls
- Production requirement: determine whether this should be customer-scoped or internal only

### 6. Other environment variables and deployment secrets
- Current location: docker-compose.yml and environment variables
- Risk: medium to high depending on actual values
- Exposure status: requires verification against repository and runtime environment
- Rotation required: yes if any live value is identified
- Production requirement: all environment-specific secrets must be injected by secret manager or secure runtime config

## Secrets that must be treated as compromised

The following must be treated as compromised until proven otherwise:

- JWT secret
- MongoDB connection credentials
- SMTP credentials
- Slack webhook URL
- any app-level secret stored in a committed environment file

The reason is that committed source files and environment files are not safe storage for production secrets.

## Required remediation actions

### Immediate actions

1. Remove committed environment files from repository state and replace with safe templates.
2. Rotate all application secrets and credentials.
3. Revoke all old database credentials and issue new ones with least privilege.
4. Regenerate Slack webhook tokens.
5. Change SMTP credentials and revalidate outbound email flows.
6. Reissue JWT signing secret and invalidate all existing dashboard sessions.

### Environment variable requirements

Production values must be provided via:

- secret manager or secure vault
- environment injection at runtime
- environment-specific access controls
- no committed `.env` files

Production variables must include:

- JWT secret
- database credentials
- SMTP credentials
- outbound webhook URLs
- TLS certificate material
- any enterprise SSO or OAuth secrets in future releases

### Production secret-management requirements

The production system should enforce:

- separate secrets per environment
- no secrets in source control
- no secrets in Dockerfiles or build args unless absolutely necessary and approved
- rotation and lifecycle tracking
- least-privilege service accounts
- secure retrieval from a secret manager or native platform vault

### Git history cleanup requirements

If the secret file was committed and then removed, the repository may still contain the value in git history. If so, the secret should be considered exposed until the repository history is sanitized.

Requirements:

- review all commits for secret exposures
- purge or rewrite history only if the repository policy and team governance allow it
- invalidate impacted credentials even if the repository is cleaned afterward
- ensure no public branch retains leaked values

### Verification steps after rotation

After rotation and cleanup, verify:

- old JWTs no longer authenticate
- database access works only with the new credentials
- SMTP sends succeed with the new credentials
- Slack alerts work with the replacement webhook
- the new cleaned environment has no secret material in source or shared artifact outputs
- application logs do not contain secret values
- a fresh smoke test confirms the app is functioning with rotated secrets

## Required decisions before production

The following must be decided by product and operations owners:

- which secret manager is required for production
- whether an environment key rotation schedule is mandatory
- whether Git history rewrite is acceptable and required
- whether incident response includes public disclosure and credential revocation steps
- whether tenant-level secrets should be stored in a separate customer-specific vault or managed at the application layer only

`UNKNOWN — requires decision`

## Final note

This plan is intentionally focused on remediation and operational safety. It does not assume the repository is safe because a secret was merely moved to an environment variable. Production trust must come from secure storage, rotation, validation, and long-term governance.
