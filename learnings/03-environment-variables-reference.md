# Environment Variables Reference

Complete reference for all environment variables used in ZapMate deployment.

---

## Server Service (Render)

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `JWT_SECRET` | Secret for JWT signing (32+ chars) | `abc123xyz...` (random string) |
| `PORT` | Server port (Render default: 10000) | `10000` |

### Email (Resend)

| Variable | Description | Example |
|----------|-------------|---------|
| `RESEND_API_KEY` | Resend API key | `re_xxxxx...` |
| `SENDER_EMAIL` | From email address | `onboarding@resend.dev` |

### Gmail OAuth (Optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `GMAIL_CLIENT_ID` | Google OAuth client ID | `xxx.apps.googleusercontent.com` |
| `GMAIL_CLIENT_SECRET` | Google OAuth secret | `GOCSPX-xxx` |
| `FRONTEND_URL` | Frontend URL for redirects | `https://your-app.vercel.app` |

### GitHub Webhooks (Optional)

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook secret | `your-secret` |

---

## Hooks Service (Render)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Same as server | - |
| `JWT_SECRET` | **Must match server** | - |
| `PORT` | Hooks port | `8000` |

---

## Frontend (Vercel)

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Server API URL | `https://your-server.onrender.com` |
| `NEXT_PUBLIC_HOOKS_URL` | Hooks service URL | `https://your-hooks.onrender.com` |

---

## Local Development

### Root `.env`
```env
# Gmail MCP Configuration
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-secret
FRONTEND_URL=http://localhost:3000

# Kafka (if using)
KAFKA_BROKER=your-kafka-broker
KAFKA_USERNAME=username
KAFKA_PASSWORD=password
```

### `apps/server/.env`
```env
JWT_SECRET=my-super-secret-jwt-key
DATABASE_URL=postgresql://postgres:password@localhost:5432/zapier
PORT=5000
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-secret
FRONTEND_URL=http://localhost:3000
```

### `apps/web/.env`
```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_HOOKS_URL=http://localhost:8000
```

---

## Migration from Nodemailer to Resend

### Removed Variables (No Longer Needed)
- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASSWORD`

### Added Variables
- `RESEND_API_KEY`

---

## Security Notes

1. **JWT_SECRET** - Must be same across all services (server, hooks, processor)
2. **Never commit** `.env` files to Git
3. **Use different secrets** for dev vs production
4. **Rotate secrets** if compromised

---

## Quick Copy for Render

```
DATABASE_URL=postgresql://...
JWT_SECRET=your-long-random-secret-32-chars-minimum
PORT=10000
RESEND_API_KEY=re_xxxxx
SENDER_EMAIL=onboarding@resend.dev
```

---

*Created: 2026-01-14*
