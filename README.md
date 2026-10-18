<div align="center">
  <h1>⚡ ZapMate</h1>
  <p><strong>A powerful Zapier clone built with microservices architecture</strong></p>
  
  <img src="https://github.com/user-attachments/assets/c3b72029-5857-416c-83d0-74b067dd427f" alt="ZapMate Demo" width="600" />
  
  <p>
    <em>Automate workflows and integrate multiple services seamlessly with ZapMate - a production-ready workflow automation platform</em>
  </p>
</div>

---

## 🌟 Features

- **🔄 Workflow Automation**: Create complex automations between different applications
- **🏗️ Microservices Architecture**: Modular, scalable, and maintainable service design
- **📨 Event-Driven Processing**: Kafka-powered message queue for reliable event handling
- **🎯 Real-time Execution**: Instant trigger processing with webhook support
- **📧 Multi-Channel Actions**: Email notifications, blockchain transactions, and more
- **🎨 Modern UI/UX**: Beautiful, responsive interface built with Next.js
- **🔒 Secure Authentication**: JWT-based user authentication and authorization
- **📊 Visual Workflow Builder**: Drag-and-drop interface for creating Zaps
- **⚡ High Performance**: Optimized for speed and reliability
- **🐳 Container Ready**: Easy deployment with Docker support

---

## 🛠️ Tech Stack

<div align="center">

### Backend Services

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

### Frontend

![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)

### Database & Messaging

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)
![Apache Kafka](https://img.shields.io/badge/Apache%20Kafka-000?style=for-the-badge&logo=apachekafka)

### DevOps & Tools

![TurboRepo](https://img.shields.io/badge/TurboRepo-EF4444?style=for-the-badge&logo=turborepo&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2CA5E0?style=for-the-badge&logo=docker&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white)

</div>

---

## 🏗️ Architecture

### System Overview

```mermaid
graph TB
    A[Web Frontend] --> B[Main Server API]
    C[External Services] --> D[Hooks Service]
    D --> E[Database]
    B --> E
    D --> F[Kafka Message Queue]
    G[GitHub Actions Cron] --> H[Processor Service]
    H --> E
    H --> F
    G --> I[Worker Service]
    I --> J[Email Service]
    I --> K[Blockchain Service]
    I --> E
    F --> I
```

### Service Architecture

| Service           | Port | Purpose                          | Deployment           |
| ----------------- | ---- | -------------------------------- | -------------------- |
| **Main Server**   | 5000 | User management & Zap operations | Render (Free)        |
| **Web Frontend**  | 3000 | User interface                   | Vercel (Free)        |
| **Hooks Service** | 8000 | Webhook handling                 | Render (Free)        |
| **Processor**     | 3001 | Outbox → Kafka publishing        | Render (Free + Cron) |
| **Worker**        | 3002 | Action execution                 | Render (Free + Cron) |

### Data Flow

1. **Trigger**: External service sends webhook to Hooks Service
2. **Queue**: Hooks creates ZapRunOutbox entry in database
3. **Processing**: GitHub Actions triggers Processor every 5 min → publishes to Kafka
4. **Execution**: GitHub Actions triggers Worker → consumes Kafka → executes actions
5. **Completion**: Results stored in database and notifications sent

### CI/CD Pipeline

```mermaid
graph LR
    A[Push to main] --> B[GitHub Actions]
    B --> C[Test & Lint]
    C --> D[Deploy Web to Vercel]
    C --> E[Deploy Server to Render]
    C --> F[Deploy Hooks to Render]
    C --> G[Deploy Processor to Render]
    C --> H[Deploy Worker to Render]
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ or Bun 1.1+
- PostgreSQL
- Apache Kafka (or Upstash Kafka for cloud)
- Bun (recommended) or npm

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd zapmate
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Set up environment variables**

   ```bash
   cp apps/server/.env.example apps/server/.env
   cp apps/web/.env.example apps/web/.env
   ```

4. **Configure database**

   ```bash
   # Update DATABASE_URL in apps/server/.env
   DATABASE_URL="postgresql://username:password@localhost:5432/zapmate"
   ```

5. **Start services**

   ```bash
   # Start all services
   bun run dev

   # Or start individual services
   cd apps/server && bun run dev  # API Server
   cd apps/web && bun run dev     # Frontend
   cd apps/hooks && bun run dev   # Webhook Handler
   ```

6. **Access the application**
   - Frontend: http://localhost:3000
   - API Server: http://localhost:5000
   - Webhooks: http://localhost:8000

---

## 📖 Usage Examples

### Creating a Zap

1. **Sign up/Login** to your ZapMate account
2. **Navigate to Dashboard** and click "Create"
3. **Choose a Trigger** (e.g., "New Email Received")
4. **Configure Trigger** with your email settings
5. **Add Actions** (e.g., "Send Slack Notification", "Save to Database")
6. **Configure Actions** with templates and settings
7. **Test the Zap** with sample data
8. **Enable the Zap** to start automation

### API Usage

```bash
# Get all available triggers
curl -X GET http://localhost:5000/api/triggers \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create a new Zap
curl -X POST http://localhost:5000/api/zaps \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Email to Slack",
    "availableTriggerId": "email-trigger-id",
    "actions": [
      {
        "availableActionId": "slack-action-id",
        "actionMetaData": {
          "channel": "#general",
          "message": "New email: {subject}"
        }
      }
    ]
  }'

# Get user's Zaps
curl -X GET http://localhost:5000/api/zaps \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Webhook Integration

```bash
# Trigger a Zap via webhook
curl -X POST http://localhost:8000/hooks/{userId}/{zapId} \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "subject": "New order received",
    "body": "Order #123 has been placed"
  }'
```

---

## 📁 Project Structure

```
zapmate/
├── apps/                          # Application services
│   ├── server/                    # Main API server (Port 5000)
│   │   ├── src/
│   │   │   ├── controllers/       # Request handlers
│   │   │   ├── routes/            # API endpoints
│   │   │   └── middlewares/       # Authentication & validation
│   ├── web/                       # Next.js frontend (Port 3000)
│   │   ├── app/                   # App router pages
│   │   ├── components/            # Reusable UI components
│   │   └── context/               # React context providers
│   ├── hooks/                     # Webhook handler (Port 8000)
│   ├── processor/                 # Event processing service
│   └── worker/                    # Action execution service
├── packages/                      # Shared packages
│   ├── db/                        # Database client & schema
│   ├── email/                     # Email service utilities
│   ├── kafka/                     # Kafka client configuration
│   ├── types/                     # TypeScript type definitions
│   └── ui/                        # Shared UI components
└── turbo.json                     # TurboRepo configuration
```

### Key Directories Explained

- **`apps/server/`**: Core business logic, user management, Zap operations
- **`apps/web/`**: User interface, dashboard, Zap editor
- **`apps/hooks/`**: Webhook endpoints for external integrations
- **`apps/processor/`**: Transactional outbox pattern implementation
- **`apps/worker/`**: Action execution engine with Kafka integration
- **`packages/db/`**: Shared Prisma client and database utilities
- **`packages/email/`**: Email sending capabilities
- **`packages/kafka/`**: Kafka producer/consumer configurations

---

## 🔧 Development

### Available Scripts

```bash
# Development
npm run dev              # Start all services
npm run build           # Build all services
npm run lint            # Lint all code
npm run format          # Format code with Prettier

# Individual services
cd apps/server && npm run dev
cd apps/web && npm run dev
cd apps/hooks && npm run dev
```

### Code Style

- **TypeScript**: Strict type checking enabled
- **ESLint**: Configured with Next.js and React rules
- **Prettier**: Code formatting on save
- **Husky**: Pre-commit hooks for quality checks

### Adding New Actions

1. **Create action type** in database schema
2. **Add controller** in `apps/server/src/controllers/`
3. **Implement logic** in `apps/worker/src/index.ts`
4. **Add UI components** in `apps/web/components/`
5. **Update types** in `packages/types/`

---

## 🚀 Deployment

### CI/CD Pipeline (GitHub Actions)

All deploys run from [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). A push to `main` that passes **Lint & Test** fans out to five parallel deploy jobs — one per runtime, because ZapMate is five separate services:

| Job                | Target                    |
| ------------------ | ------------------------- |
| `Deploy Web`       | Vercel (`apps/web`)       |
| `Deploy Server`    | Render (`apps/server`)    |
| `Deploy Hooks`     | Render (`apps/hooks`)     |
| `Deploy Processor` | Render (`apps/processor`) |
| `Deploy Worker`    | Render (`apps/worker`)    |

On pull requests the deploy jobs report as `skipping` — only **Lint & Test** runs, since every deploy job is gated on `github.ref == 'refs/heads/main' && github.event_name == 'push'`.

GitHub Actions is the **only** path to Vercel production. Vercel's own Git integration is disabled with `"git": { "deploymentEnabled": false }` in `vercel.json`; without it each push triggers a second, ungated Vercel build that races this pipeline for the production slot.

### Docker Deployment

```dockerfile
# Multi-stage build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine AS production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
EXPOSE 3000 5000 8000
CMD ["npm", "run", "dev"]
```

### Environment Configuration

```bash
# Production environment variables
NODE_ENV=production
DATABASE_URL=postgresql://prod:password@db:5432/zapmate
KAFKA_BROKERS=kafka:9092
JWT_SECRET=your-super-secret-key
EMAIL_SERVICE_API_KEY=your-email-service-key
```

### Troubleshooting signup/signin CORS errors

The production alias and Vercel's generated deployment URL are **different origins**.
The API allows `https://zapier-web-seven.vercel.app`, the `zapier` project alias,
and HTTPS deployment/branch URLs for `zapier` in the `nilesh-srivastavas-projects`
team. Other trusted frontends must be listed in the **Render server's**
`CORS_ORIGIN` (comma-separated exact origins); `FRONTEND_URL` is also allowed.
Do not allow all `*.vercel.app` sites: authentication uses credentialed cookies.

For a configuration-only fix on an older server deployment, append the exact
origin from the browser error to `CORS_ORIGIN`, preserving any existing entries:

```dotenv
CORS_ORIGIN=https://zapier-web-seven.vercel.app,https://zapier-qwltqdtk3-nilesh-srivastavas-projects.vercel.app
```

Save and redeploy the **API server**, not just the frontend. For the code fix,
deploy both `apps/server` and `apps/web`. In Vercel, `NEXT_PUBLIC_API_URL` must be
`https://zapier-fd68.onrender.com` (no `/api` suffix); changing a `NEXT_PUBLIC_`
variable requires a new frontend build. Prefer the stable production alias to
an old immutable deployment URL when checking a new frontend release.

Verify the actual preflight from a terminal (this does not create an account):

```bash
curl -i --max-time 90 -X OPTIONS 'https://zapier-fd68.onrender.com/api/auth/signup' \
  -H 'Origin: https://zapier-qwltqdtk3-nilesh-srivastavas-projects.vercel.app' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

Expect **204**, `Access-Control-Allow-Origin` equal to that exact origin,
`Access-Control-Allow-Credentials: true`, and `POST`/`Content-Type` in the allowed
methods/headers. A non-2xx response (especially a Render 502/503) can indicate an
unavailable or failed deployment rather than an allowlist problem. Inspect the
OPTIONS response in DevTools and Render's live deploy/runtime logs; also check
`https://zapier-fd68.onrender.com/health`. Express CORS middleware cannot fix a
response generated by the hosting proxy before the request reaches the app.
A successful deployment-trigger job alone does not verify the live preflight.

The updated service worker caches only public static assets, bypasses API and
page requests, and removes the old `zapmate-v1` page cache. If DevTools still
shows the old `sw.js:20` fetch handler after deploying, open **Application →
Service Workers → Unregister**, remove the `zapmate-*` entries under **Cache
Storage**, then reload the latest frontend. Clearing storage alone does not fix
a rejected API origin or an unavailable backend.

### Scaling Considerations

- **Horizontal Scaling**: Use load balancer for multiple server instances
- **Database**: Connection pooling and read replicas
- **Kafka**: Partitioning and replication for high throughput
- **Caching**: Redis for session storage and API response caching

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Code Standards

- Write clear, concise commit messages
- Add tests for new features
- Update documentation as needed
- Follow the existing code style
- Ensure all tests pass

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Inspired by [Zapier](https://zapier.com)
- Built with modern web technologies
- Thanks to all contributors and the open-source community

---

<div align="center">
  <p><strong>Built with ❤️ by the ZapMate team</strong></p>
  <p>
    <a href="#features">Features</a> •
    <a href="#tech-stack">Tech Stack</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#contributing">Contributing</a>
  </p>
</div>
