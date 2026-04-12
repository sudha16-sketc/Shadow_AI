# ⚔ Shadow AI Auditor

> **Lightweight AI Data Leak Prevention Platform for B2B SaaS**

Shadow AI Auditor prevents employees from accidentally leaking sensitive data — API keys, credentials, PII, proprietary content — into public AI tools like ChatGPT, Claude, and Gemini.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  EMPLOYEE BROWSER                                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  AI Website (ChatGPT / Claude / Gemini …)               │  │
│  │                                                          │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │  Content Script (content.js)                      │   │  │
│  │  │  • Monitors paste + typing events                 │   │  │
│  │  │  • Runs Detection Engine locally (no round-trip)  │   │  │
│  │  │  • Shows Warning Modal on HIGH risk               │   │  │
│  │  └──────────────────────┬───────────────────────────┘   │  │
│  └─────────────────────────│───────────────────────────────┘  │
│                             │ masked events only               │
│  ┌──────────────────────────▼───────────────────────────────┐  │
│  │  Background Service Worker (background.js)               │  │
│  │  • Queues + batches events                               │  │
│  │  • Manages user session                                  │  │
│  │  • Tab badge on AI sites                                 │  │
│  └──────────────────────────┬───────────────────────────────┘  │
└────────────────────────────  │  ──────────────────────────────-┘
                               │ HTTPS POST (masked data only)
┌──────────────────────────────▼───────────────────────────────┐
│  BACKEND API  (Node.js + Express)                            │
│                                                              │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │  /api/events   │  │ /api/analytics  │  │  /api/users  │ │
│  └────────┬───────┘  └────────┬────────┘  └──────────────┘ │
│           │                   │                             │
│  ┌────────▼───────────────────▼──────────────────────────┐ │
│  │  MongoDB                                              │ │
│  │  • events collection  • users  • orgs  • teams        │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────┐  ┌──────────────────────────────┐  │
│  │  Alerting Service  │  │  WebSocket (real-time)       │  │
│  │  • Slack webhook   │  │  • Broadcasts HIGH events    │  │
│  │  • Email (SMTP)    │  │    to open dashboard tabs    │  │
│  └────────────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────────┐
│  DASHBOARD  (React + Vite + Tailwind)                        │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Overview │ │  Events  │ │  Users   │ │  Analytics   │  │
│  │ • Score  │ │ • Table  │ │ • List   │ │ • Charts     │  │
│  │ • Charts │ │ • Filter │ │ • Manage │ │ • Top users  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
shadow-ai-auditor/
├── extension/                   # Chrome Extension (MV3)
│   ├── manifest.json
│   ├── src/
│   │   ├── content.js           ← Main detection & modal logic
│   │   ├── detectionEngine.js   ← Regex + keyword engine
│   │   ├── background.js        ← Service worker
│   │   └── modal.css
│   └── icons/
│
├── backend/                     # Node.js API
│   ├── src/
│   │   ├── server.js            ← Express app + WebSocket
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── events.js        ← Core event ingestion
│   │   │   ├── analytics.js
│   │   │   ├── users.js
│   │   │   └── settings.js
│   │   ├── models/
│   │   │   └── index.js         ← Mongoose schemas
│   │   ├── middleware/
│   │   │   └── auth.js          ← JWT middleware
│   │   ├── services/
│   │   │   ├── alerting.js      ← Slack + email
│   │   │   └── scoring.js       ← Security score calc
│   │   └── utils/
│   │       └── logger.js
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                    # React Dashboard
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Overview.jsx     ← Main dashboard
│   │   │   ├── Events.jsx       ← Event log + filters
│   │   │   ├── Analytics.jsx    ← Charts + top users
│   │   │   └── Users.jsx
│   │   ├── components/
│   │   │   └── Layout.jsx       ← Sidebar layout
│   │   └── hooks/
│   │       └── useAuth.js       ← Zustand auth store
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Quick Start (Development)

### Prerequisites
- Node.js 20+
- MongoDB 7+ (or Docker)
- Git

### 1. Clone & Configure

```bash
git clone https://github.com/your-org/shadow-ai-auditor
cd shadow-ai-auditor
cp .env.example .env
# Edit .env — set JWT_SECRET at minimum
```

### 2. Start MongoDB

```bash
docker run -d -p 27017:27017 --name mongo mongo:7
```

### 3. Backend

```bash
cd backend
npm install
npm run dev
# → http://localhost:3001
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

### 5. Create First Admin User

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@company.com","password":"your-password","name":"Admin","role":"admin"}'
```

### 6. Load Extension in Chrome

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/` folder

---

## Docker (Production)

```bash
cp .env.example .env
# Fill in all values

docker-compose up -d
# Backend: http://localhost:3001
# Dashboard: http://localhost:5173
```

---

## Configure Alerting

### Slack

1. Create an Incoming Webhook at https://api.slack.com/messaging/webhooks
2. Update your org in MongoDB (or via API):

```bash
curl -X PATCH http://localhost:3001/api/settings/org \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"slackWebhookUrl":"https://hooks.slack.com/services/...","alertEmail":"security@company.com"}'
```

### Email (SMTP)

Set in `.env`:
```
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@mg.yourdomain.com
SMTP_PASS=your-password
```

---

## Detection Patterns

The engine detects:

| Pattern | Severity | Examples |
|---------|----------|---------|
| AWS Access Key | HIGH (90) | `AKIAIOSFODNN7EXAMPLE` |
| Stripe Secret Key | HIGH (95) | `sk_live_...` |
| GitHub Token | HIGH (90) | `ghp_...` |
| RSA/SSH Private Key | CRITICAL (99) | `-----BEGIN PRIVATE KEY-----` |
| Credit Card Number | CRITICAL (98) | Luhn-valid card patterns |
| SSN | HIGH (95) | `123-45-6789` |
| JWT Token | MEDIUM (70) | `eyJ...` |
| DB Connection String | HIGH (85) | `mongodb://user:pass@...` |
| Email Address | LOW (40) | `user@company.com` |
| Confidentiality keywords | LOW–HIGH | "confidential", "do not share" |

---

## Privacy & Security

- **No raw data stored.** Only masked previews (e.g., `sk-l****xyzw`) are sent to the backend.
- **Local detection.** The detection engine runs entirely in the browser extension — sensitive content never leaves the device.
- **User opt-out.** Any user can opt out via extension settings.
- **JWT auth.** Dashboard access requires valid JWT tokens.
- **Rate limiting.** API endpoints are rate-limited to prevent abuse.

---

## Roadmap / Enterprise Evolution

### Phase 2 — AI Proxy Gateway
Instead of detecting at the browser, route all AI requests through a secure proxy:
- Enforce policies server-side
- Support enterprise SSO (SAML/OIDC)
- DLP rules per department/role
- Audit log with compliance export (SOC 2, ISO 27001)

### Phase 3 — Enterprise Platform
- Multi-tenant with org isolation
- Custom detection rules UI
- Integration with DLP tools (Nightfall, Symantec)
- Real-time coaching ("try rephrasing without the API key")
- SIEM integration (Splunk, Datadog)

---

## License

MIT — build something great.