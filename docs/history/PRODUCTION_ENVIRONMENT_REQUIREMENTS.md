# Production Environment Requirements

This document lists external infrastructure, configuration, secret storage, and deployment requirements for a production environment. It intentionally excludes code-level implementation details and focuses only on environment, infrastructure, and service requirements.

## 1. Required External Services

### Frontend hosting
- Required: Yes
- Purpose: host the React dashboard
- Expected configuration: HTTPS, static asset hosting or reverse-proxied web app
- Current repo support: Dockerfile + nginx config exist for local container builds
- External setup required: Yes
- Secret required: No
- Persistent storage: No
- High availability: Recommended
- Backup requirement: Minimal static asset backup or redeploy pipeline

### Backend hosting
- Required: Yes
- Purpose: Express API and WebSocket server
- Expected configuration: HTTPS, managed compute or container runtime, autoscaling if needed
- Current repo support: Dockerfile exists
- External setup required: Yes
- Secret required: Yes, for JWT and service credentials
- Persistent storage: No, except DB and logs
- High availability: Recommended
- Backup requirement: Service redeploy pipeline and config versioning

### MongoDB
- Required: Yes
- Purpose: persist users, events, org settings, audit logs
- Expected configuration: managed MongoDB cluster or equivalent with backups, TLS enabled
- Current repo support: docker-compose local instance only
- External setup required: Yes
- Secret required: Yes
- Persistent storage: Yes
- High availability: Recommended
- Backup requirement: Yes, automated backup and restore validation

### Redis
- Required: Unknown
- Purpose: future caching, job queue, or shared session/state if needed
- Expected configuration: managed cache service if used
- Current repo support: No
- External setup required: Unknown
- Secret required: Maybe
- Persistent storage: Optional
- High availability: Recommended if used
- Backup requirement: Dependent on use case

### Object storage
- Required: Unknown
- Purpose: optional event export, audit export, artifact archive, backups
- Expected configuration: managed storage bucket for exports and backups
- Current repo support: No
- External setup required: Unknown
- Secret required: Yes for access credentials if used
- Persistent storage: Yes
- High availability: Recommended
- Backup requirement: Yes if used for sensitive data

### CDN / static edge
- Required: Optional
- Purpose: improved frontend delivery and cache performance
- Expected configuration: edge caching for static assets
- Current repo support: No
- External setup required: Optional
- Secret required: No
- Persistent storage: No
- High availability: Optional
- Backup requirement: Not usually required

### Reverse proxy / TLS termination
- Required: Yes
- Purpose: HTTPS, TLS offload, ingress routing, WAF optional
- Expected configuration: NGINX, Traefik, ALB, or managed ingress
- Current repo support: Not in repo beyond local nginx config for frontend
- External setup required: Yes
- Secret required: Yes for TLS certificates
- Persistent storage: Yes for certs, if managed manually
- High availability: Recommended
- Backup requirement: Yes for certs and config

### DNS
- Required: Yes
- Purpose: map API and dashboard domains
- Expected configuration: organization-owned domains and subdomains
- Current repo support: No
- External setup required: Yes
- Secret required: No
- Persistent storage: No
- High availability: Required
- Backup requirement: DNS plan and TTL control

### Secrets manager
- Required: Yes
- Purpose: store JWT secrets, DB credentials, SMTP credentials, Slack webhooks, TLS secrets
- Expected configuration: cloud secrets manager or equivalent with rotation support
- Current repo support: No
- External setup required: Yes
- Secret required: N/A; it stores secrets
- Persistent storage: Yes
- High availability: Required
- Backup requirement: Yes

### Logging / observability stack
- Required: Yes
- Purpose: application logs, metrics, audit trails, incident detection
- Expected configuration: centralized log aggregation and alerting
- Current repo support: local winston logger only
- External setup required: Yes
- Secret required: Maybe for log shipping
- Persistent storage: Yes
- High availability: Required
- Backup requirement: Yes

### Error tracking / monitoring
- Required: Yes
- Purpose: runtime failures, alerting, issue detection
- Expected configuration: external monitor with error ingestion and notification channels
- Current repo support: No
- External setup required: Yes
- Secret required: Yes
- Persistent storage: Yes
- High availability: Required
- Backup requirement: Yes

### Email delivery
- Required: Yes for alerting feature
- Purpose: outbound high-risk event emails
- Expected configuration: SMTP relay or managed email delivery platform
- Current repo support: SMTP env vars from docker-compose
- External setup required: Yes
- Secret required: Yes
- Persistent storage: No
- High availability: Recommended
- Backup requirement: Not typically required

### Slack integration
- Required: Optional but currently implemented
- Purpose: send alerts for high-risk events
- Expected configuration: incoming webhook URL
- Current repo support: Slack webhook env var and code exists
- External setup required: Yes
- Secret required: Yes
- Persistent storage: No
- High availability: Recommended
- Backup requirement: Not typically required

### Extension distribution
- Required: Yes for real deployment
- Purpose: install the browser extension at scale
- Expected configuration: Chrome Web Store or enterprise managed distribution
- Current repo support: manifest exists only; no distribution plan in repo
- External setup required: Yes
- Secret required: Yes for signing / distribution channel if used
- Persistent storage: No
- High availability: Recommended
- Backup requirement: Versioned release artifacts

### CI/CD pipeline
- Required: Yes
- Purpose: build, test, package, and deploy code
- Expected configuration: hosted runner or equivalent with protected secrets
- Current repo support: No
- External setup required: Yes
- Secret required: Yes
- Persistent storage: No
- High availability: Recommended
- Backup requirement: Not typically required

### Backup / disaster recovery storage
- Required: Yes
- Purpose: backup DB, config, and key material
- Expected configuration: encrypted backup system with restore testing
- Current repo support: local Mongo volume only
- External setup required: Yes
- Secret required: Yes for backup credentials
- Persistent storage: Yes
- High availability: Recommended
- Backup requirement: Mandatory

### Certificate management
- Required: Yes
- Purpose: TLS for API and dashboard
- Expected configuration: managed or self-signed certificates with renewal automation
- Current repo support: No
- External setup required: Yes
- Secret required: Yes
- Persistent storage: Yes
- High availability: Required
- Backup requirement: Yes

## 2. Required Configuration Inputs

- JWT secret
- MongoDB connection string
- SMTP host, port, user, password
- Slack webhook URL
- API and dashboard domain names
- Frontend API origin
- Backup credentials
- Secret manager access configuration
- TLS certificate values or managed certificate setup

## 3. Domain / Endpoint Requirements

The app currently assumes local development endpoints, including localhost backend and dashboard URLs. For production, the deployment must define:

- API domain, e.g. api.company.example
- Dashboard domain, e.g. shadow.company.example
- WebSocket origin or secure proxy configuration
- Browser extension policy / update endpoint if used

## 4. Secret Requirements

The following secrets must be stored outside the repository and injected via environment variables or a secrets manager:

- JWT secret
- MongoDB credentials
- SMTP credentials
- Slack webhook URL
- TLS certificate/private key
- any future OAuth / SSO secrets

## 5. High-Level Production Topology

Recommended target topology:

- Frontend hosted behind HTTPS with static assets or a managed frontend platform
- Backend API behind TLS and reverse proxy
- Managed MongoDB instance with backups and access controls
- Secret manager for all operational secrets
- Monitoring and log aggregation stack
- CI/CD pipeline with protected release credentials
- Extension distribution through signed enterprise path

## 6. Production Readiness Checklist

Before production deployment the environment must provide:

- secure secrets management
- TLS everywhere
- DLP-safe backup and restore
- centralized monitoring
- RBAC and tenant boundary validation
- disaster recovery plan
- enterprise extension distribution
- explicit retention and deletion controls

## 7. Final Note

The current repository is not sufficient to define a full production environment. It supports local Docker development only. A real deployment requires external infrastructure, secret management, and operational controls that are not yet present in the codebase.
