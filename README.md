<div align="center">
  <h1>⚡ ZapMate</h1>
  <p><strong>A production-ready workflow automation platform and Zapier alternative built on an event-driven microservices architecture.</strong></p>
  
  <img src="https://github.com/user-attachments/assets/c3b72029-5857-416c-83d0-74b067dd427f" alt="ZapMate Demo" width="680" />
  
  <p>
    <em>Connect your apps, automate repetitive workflows, and chain multi-step triggers and actions with guaranteed transactional delivery.</em>
  </p>

  <p>
    <a href="https://zapier-web-seven.vercel.app"><strong>🌐 Live Web App</strong></a> •
    <a href="#-architecture">System Architecture</a> •
    <a href="#-supported-triggers--actions">Triggers & Actions</a> •
    <a href="#-roadmap-next-triggers--actions">Next Integrations Roadmap</a> •
    <a href="#-quick-start">Quick Start</a>
  </p>
</div>

---

## 🌟 Highlights & Current Capabilities

- **🔄 Multi-Step Pipeline Automation**: Chain triggers to multiple actions with step ordering and visual node connector lines.
- **🏗️ 5-Tier Microservices Architecture**: Decoupled Web, API Server, Hooks, Processor, and Worker services.
- **📨 Event-Driven Messaging**: Apache Kafka message streaming backed by a Transactional Outbox pattern for zero lost events.
- **🔍 Conditional Logic & Filter Builder**: Set rule conditions (equals, contains, greater than, regex/empty) between triggers and actions.
- **📜 Detailed Run History & Auditing**: Inspect payloads, trigger metadata, execution status, and timestamps for every run.
- **🎨 Modern Design System & Decoupled CSS**: Strict separation of concerns — `.tsx` logic files are decoupled from token-backed CSS (`tokens.css`, `base.css`, `components/*.css`) using container queries, fluid `clamp()` typography/spacing, and WCAG $\ge 44\text{px}$ touch targets.
- **📱 PWA & Mobile-First Responsive**: Zero horizontal overflow across mobile (360px+), tablet, and desktop viewports with dynamic viewport units (`100dvh`).
- **🔒 Enterprise Security**: Secure cookie-based JWT authentication, CORS preflight isolation, and OAuth 2.0 account delegation.

---

## AI Transform

The workflow editor includes **AI → AI Transform** with OpenAI, Anthropic/Claude, experimental Puter, and approved OpenAI-compatible BYOK connections. Summarize, classify, extract typed fields, or use custom instructions; chain results into later actions and add per-action conditions (for example, notify only when `previousOutput.fields.category` equals `negative`).

API keys stay out of action metadata. Compatible credentials are encrypted, owned and revocable; endpoint egress is restricted. Preview/probe calls are **billable** and share worker quotas. Providers require operator configuration; **Puter is disabled by default**. Implementation is complete, but live-service/production verification is not claimed.

- [Setup, limits, privacy/billing, migration, gated tests and rollback](reports/ai-connection-operations.md)
- [Phase completion and verification evidence](reports/ai-implementation-completion.md)
- [Detailed design and external acceptance checklist](reports/ai-reasoning-step-spec.md#13-completion-checklist)
- [Separate Gmail routing and production prerequisites](reports/gmail-worker-routing-spec.md)

Offline tests: `npm test -w @repo/ai-connections`, `npm test -w @repo/ai`, and the server/worker/web test suites. Gated real-service tests: `npm run test:ai:e2e -w server` (skipped until explicitly enabled; see operations). No production migration is run automatically.

---

## 🛠️ Tech Stack

<div align="center">

### Frontend (`apps/web`)
![Next.js 14](https://img.shields.io/badge/Next.js_14-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React 18](https://img.shields.io/badge/React_18-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v3.4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Design Tokens](https://img.shields.io/badge/Design_Tokens-CSS_Variables-orange?style=for-the-badge)
![PWA](https://img.shields.io/badge/PWA-Ready-purple?style=for-the-badge&logo=pwa)

### Backend Services (`apps/server`, `apps/hooks`, `apps/processor`, `apps/worker`)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white)

### Database, Queue & Infrastructure
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma ORM](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)
![Apache Kafka](https://img.shields.io/badge/Apache%20Kafka-000000?style=for-the-badge&logo=apachekafka&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?style=for-the-badge&logo=turborepo&logoColor=white)

</div>

---

## ⚡ Supported Triggers & Actions

| App / Integration | Type | Supported Events | Connection / Protocol |
|:---|:---:|:---|:---|
| **Webhook** | Trigger | Custom HTTP POST Payload (JSON) | Direct Webhook URL (`/hooks/:userId/:zapId`) |
| **Schedule / Cron** | Trigger | Every Hour, Day, Week, Month, or Custom Cron | Database Scheduled Outbox Worker |
| **Gmail** | Trigger & Action | New Email Received / Send Email | Google OAuth 2.0 Token Exchange |
| **Google Sheets** | Trigger & Action | New Row Added / Append Row | Google OAuth 2.0 Spreadsheets API |
| **Google Calendar** | Trigger & Action | New Event Created / Schedule Event | Google OAuth 2.0 Calendar API |
| **Email (SMTP)** | Action | Send Outbound Notification Email | Nodemailer / Resend SMTP |
| **Solana** | Action | Send SOL Cryptocurrency Transfer | Solana Web3 RPC Keypair Signing |
| **Telegram** | Action | Send Bot Notification Message | Telegram Bot API (@BotFather Token) |
| **WhatsApp** | Action | Send WhatsApp Business Message | Meta Graph Cloud API |
| **GitHub** | Action | Issue / Repository Event Tracker | GitHub Personal Access Token / REST API |

---

## 🏗️ Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Client ["Client Layer"]
        UI["Web App (Next.js 14)<br/>port 3000"]
        ExtClient["External Apps / Webhook Send"]
    end

    subgraph Ingestion ["Ingestion & Control Plane"]
        API["API Server (Express)<br/>port 5000"]
        Hooks["Hooks Ingestion Service<br/>port 8000"]
    end

    subgraph Storage ["Persistence Layer"]
        DB[("PostgreSQL (Prisma)")]
        Outbox[("ZapRunOutbox Table")]
    end

    subgraph Messaging ["Event Streaming Layer"]
        Proc["Processor Service (Outbox Worker)"]
        Kafka["Apache Kafka Topic: zap-events"]
    end

    subgraph Execution ["Execution Layer"]
        Worker["Worker Service (Consumer)"]
        Filter["Filter Rule Evaluator"]
        ActionExec["Action Executors"]
    end

    subgraph Integrations ["External APIs"]
        Gmail["Gmail / Google Sheets / Calendar"]
        TG["Telegram / WhatsApp"]
        Sol["Solana Blockchain"]
        Mail["SMTP Email"]
    end

    UI -->|Create / Manage Zaps| API
    ExtClient -->|HTTP POST Payload| Hooks
    API -->|Save Zap & Filter Rules| DB
    Hooks -->|Atomic Write| Outbox
    Hooks -->|Record Initial Run| DB
    Proc -->|Poll pending rows| Outbox
    Proc -->|Produce event message| Kafka
    Kafka -->|Consume event| Worker
    Worker -->|Fetch metadata & rules| DB
    Worker -->|Evaluate conditions| Filter
    Filter -->|If passed| ActionExec
    ActionExec --> Gmail
    ActionExec --> TG
    ActionExec --> Sol
    ActionExec --> Mail
```

### Microservices Breakdown

| Service | Port | Path | Purpose | Deployment |
|:---|:---:|:---|:---|:---|
| **Web Frontend** | `3000` | `apps/web` | Next.js 14 user interface, dashboard, visual pipeline editor | Vercel |
| **API Server** | `5000` | `apps/server` | User auth, Zap CRUD, trigger/action catalog, OAuth tokens | Render |
| **Hooks Service** | `8000` | `apps/hooks` | Fast webhook receiver writing to Transactional Outbox | Render |
| **Processor** | `3001` | `apps/processor` | Polls `ZapRunOutbox`, dispatches to Kafka topics | Render |
| **Worker** | `3002` | `apps/worker` | Kafka consumer, evaluates filters, executes step actions | Render |

---

## 🔮 Roadmap: Next Triggers & Actions to Implement

Based on industry automation telemetry (Zapier, Make, n8n), the following integrations are prioritized for the next release cycle:

### 1. 💬 Discord & Slack (Priority 1 — Most Commonly Used Action)
* **Why:** Real-time team notifications and community ops are the most frequent automation destination. Users want alerts for new leads, error logs, and customer signups posted into Discord channels and Slack feeds without sending an email.
* **Events to Implement:**
  - `Discord`: Action → **"Send Channel Message"** / **"Send Webhook Embed"** (via Bot Token or Webhook URL).
  - `Slack`: Action → **"Send Channel Message"** / **"Send Direct Message"** (via Slack Web API / OAuth).

### 2. 🤖 AI Reasoning & Transformation Step (Priority 1 — High Value)
* **Why:** The modern automation paradigm relies on language models to process unstructured data before passing it along.
* **Events to Implement:**
  - Action → **"AI Prompt & Extraction"** (OpenAI / Claude API):
    - Input: raw text or trigger payload (e.g., email body, webhook JSON).
    - Capabilities: Summarize, categorize sentiment, extract key fields into structured JSON for subsequent action steps.

### 3. 💳 Stripe (Priority 2 — Monetization & CRM Triggers)
* **Why:** Payment-triggered automations are the highest-converting workflows.
* **Events to Implement:**
  - Trigger → **"Payment Succeeded"** (`charge.succeeded` / `checkout.session.completed`).
  - Trigger → **"New Customer Created"** (`customer.created`).
  - Trigger → **"Subscription Cancelled"** (`customer.subscription.deleted`).

### 4. 📝 Notion (Priority 2 — Team Knowledge Base & CRM)
* **Why:** Notion databases serve as default CRMs and issue trackers for startups and indie developers.
* **Events to Implement:**
  - Trigger → **"New Database Item"** (polling or webhook).
  - Action → **"Create Page in Database"** (mapping trigger fields into Notion properties).

### 5. 📊 Airtable (Priority 3 — Relational Spreadsheets)
* **Why:** Provides relational database power with spreadsheet ease of use.
* **Events to Implement:**
  - Trigger → **"New or Updated Record"**.
  - Action → **"Create Record"** / **"Update Record"**.

---

## 🚀 Quick Start (Local Development)

### Prerequisites

- **Bun** (v1.1+) or Node.js (v18+)
- **PostgreSQL** database running locally or hosted (e.g. Neon, Supabase)
- **Apache Kafka** running locally or via cloud (e.g. Upstash Kafka)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Nileshsri2022/zapier.git
cd zapier
bun install
```

### 2. Configure Environment Variables

```bash
# Server configuration
cp apps/server/.env.example apps/server/.env

# Web configuration
cp apps/web/.env.example apps/web/.env.local
```

Key environment variables:
```env
# apps/server/.env
DATABASE_URL="postgresql://user:password@localhost:5432/zapmate"
JWT_SECRET="your-jwt-secret-key"
KAFKA_BROKERS="localhost:9092"
FRONTEND_URL="http://localhost:3000"

# apps/web/.env.local
NEXT_PUBLIC_API_URL="http://localhost:5000"
NEXT_PUBLIC_HOOKS_URL="http://localhost:8000"
```

### 3. Run Database Migrations & Seeds

```bash
cd packages/db
bunx prisma migrate dev
bunx prisma db seed
cd ../..
```

### 4. Start Development Services

```bash
# Start all microservices concurrently
bun run dev

# Or start specific microservices:
cd apps/web && bun run dev     # Frontend on http://localhost:3000
cd apps/server && bun run dev  # API Server on http://localhost:5000
cd apps/hooks && bun run dev   # Webhook Receiver on http://localhost:8000
cd apps/processor && bun run dev # Outbox Processor
cd apps/worker && bun run dev  # Action Execution Worker
```

---

## 📁 Repository Monorepo Structure

```
zapmate/
├── apps/
│   ├── web/                     # Next.js 14 App Router Frontend
│   │   ├── app/                 # Routing: /, /dashboard, /editor, /login, /sign-up
│   │   ├── components/          # Logic-only UI components (Modal, ZapCell, Navbar)
│   │   └── styles/              # Decoupled design tokens and component stylesheets
│   │       ├── tokens.css       # Single source of truth for colors, typography, radii
│   │       ├── base.css         # Reset, 100dvh viewport, 44px touch targets
│   │       ├── components/      # Component-level stylesheets (modal, navbar, zap-cell)
│   │       └── pages/           # Page-level stylesheets (app.css, landing.css)
│   ├── server/                  # Core API microservice (Express + TypeScript)
│   ├── hooks/                   # Ingestion microservice writing to ZapRunOutbox
│   ├── processor/               # Transactional Outbox Kafka producer
│   └── worker/                  # Kafka consumer executing step actions
├── packages/
│   ├── db/                      # Shared Prisma schema, clients, and seeds
│   ├── kafka/                   # Kafka client and topic configuration
│   ├── types/                   # Shared TypeScript models and payload definitions
│   └── ui/                      # Shared design tokens and base UI primitives
├── reports/                     # Architecture, audit, and design system specs
│   └── skills-redesign-report.md # Detailed breakdown of responsive & design system skills
└── turbo.json                   # Turborepo task pipeline configuration
```

---

## 🤝 Contributing a New Trigger or Action

To add a new integration to ZapMate:

1. **Database Schema & Catalog:**
   - Add the trigger or action type to `packages/db/prisma/schema.prisma` and seed script.
   - Run `bunx prisma migrate dev`.
2. **Execution Worker:**
   - Implement the action execution logic in `apps/worker/src/index.ts` (or create a dedicated executor under `apps/worker/src/executors/`).
3. **Frontend UI Catalog:**
   - Register the app icon and definition in `apps/web/components/modal/constants.ts`.
   - If metadata or OAuth is required, add a config form in `apps/web/components/metadata/`.
4. **Test & Verify:**
   - Run `bun x tsc --noEmit` across all workspaces.
   - Trigger a test run via Webhooks or the Editor canvas.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
