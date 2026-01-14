# Gmail Cloud Setup Guide for ZapMate

This guide walks you through setting up Gmail integration with Google Cloud for ZapMate's email triggers.

## Prerequisites

- Google Cloud account
- ZapMate server deployed (e.g., on Render)
- Access to Google Cloud Console

---

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown → **New Project**
3. Name it (e.g., `zapier-484307`)
4. Click **Create**

---

## Step 2: Enable Required APIs

Navigate to **APIs & Services → Library** and enable:

1. **Gmail API** - For reading/sending emails
2. **Cloud Pub/Sub API** - For push notifications

Search for each API and click **Enable**.

---

## Step 3: Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - User Type: **External**
   - App name: `ZapMate`
   - Support email: Your email
   - Add scopes: `gmail.readonly`, `gmail.send`
   - Add test users (your email)
4. Create OAuth Client ID:
   - Application type: **Web application**
   - Name: `ZapMate Gmail`
   - Authorized redirect URIs: 
     - `http://localhost:5000/api/gmail/callback` (local)
     - `https://zapier-server-3alt.onrender.com/api/gmail/callback` (production)
5. Click **Create**
6. Copy **Client ID** and **Client Secret**

```env
GMAIL_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GMAIL_CLIENT_SECRET="GOCSPX-your-client-secret"
```

---

## Step 4: Create Pub/Sub Topic

1. Go to **Pub/Sub → Topics**
2. Click **Create Topic**
3. Topic ID: `gmail-notifications`
4. Click **Create**

Your topic name will be: `projects/YOUR-PROJECT-ID/topics/gmail-notifications`

```env
GMAIL_PUBSUB_TOPIC="projects/zapier-484307/topics/gmail-notifications"
```

---

## Step 5: Grant Gmail Permission to Publish

Gmail needs permission to send notifications to your topic.

1. Go to your topic → **Permissions** tab
2. Click **Grant Access**
3. Add principal: `gmail-api-push@system.gserviceaccount.com`
4. Role: **Pub/Sub Publisher**
5. Click **Save**

---

## Step 6: Create a Service Account (Optional but Recommended)

1. Go to **IAM & Admin → Service Accounts**
2. Click **Create Service Account**
3. Name: `pubsub-push-service`
4. Grant role: **Pub/Sub Publisher**
5. Click **Done**

---

## Step 7: Create Push Subscription

1. Go to **Pub/Sub → Subscriptions**
2. Click **Create Subscription**
3. Configure:

| Field | Value |
|-------|-------|
| Subscription ID | `gmail-webhook-handler` |
| Topic | `projects/YOUR-PROJECT/topics/gmail-notifications` |
| Delivery type | **Push** |
| Endpoint URL | `https://your-server.onrender.com/api/gmail/webhook` |
| Enable authentication | ✅ (optional) |
| Service account | `pubsub-push-service@YOUR-PROJECT.iam.gserviceaccount.com` |
| Audience | `https://your-server.onrender.com/api/gmail/webhook` |

4. Click **Create**

---

## Step 8: Generate Webhook Secret

Generate a random secret for webhook verification:

**PowerShell:**
```powershell
[System.Guid]::NewGuid().ToString() + [System.Guid]::NewGuid().ToString()
```

**Bash:**
```bash
openssl rand -hex 32
```

```env
GMAIL_WEBHOOK_SECRET="your-generated-secret-here"
```

---

## Step 9: Update Environment Variables

### Root `.env` (ZapMate root directory)

```env
# Gmail MCP Configuration
GMAIL_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GMAIL_CLIENT_SECRET="GOCSPX-your-secret"
GMAIL_PUBSUB_TOPIC="projects/zapier-484307/topics/gmail-notifications"
GMAIL_WEBHOOK_SECRET="your-webhook-secret"

# Frontend Configuration
FRONTEND_URL="http://localhost:3000"
```

### Production (Render Dashboard)

Add the same variables to your Render service environment.

---

## Step 10: Test the Integration

1. Start your server
2. Navigate to Gmail OAuth flow
3. Authorize the application
4. Send a test email to trigger the webhook

---

## Architecture Flow

```
┌─────────────┐
│   Gmail     │
│  (New Email)│
└──────┬──────┘
       │ Push notification
       ▼
┌─────────────────────────────┐
│   Google Cloud Pub/Sub      │
│   Topic: gmail-notifications│
└──────────────┬──────────────┘
               │ Push to subscription
               ▼
┌─────────────────────────────┐
│   Push Subscription         │
│   → POST to webhook URL     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│   ZapMate Server            │
│   /api/gmail/webhook        │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│   Trigger Zap Actions       │
│   (Send email, etc.)        │
└─────────────────────────────┘
```

---

## Troubleshooting

### "Permission denied" when setting up watch
- Ensure `gmail-api-push@system.gserviceaccount.com` has **Pub/Sub Publisher** role on your topic

### Webhook not receiving messages
- Verify the endpoint URL is correct and accessible (HTTPS required)
- Check Pub/Sub subscription status in Cloud Console

### OAuth errors
- Verify redirect URIs match exactly
- Ensure Gmail API is enabled
- Check if app is in "Testing" mode and you're a test user

---

## Useful Links

- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [Cloud Pub/Sub Documentation](https://cloud.google.com/pubsub/docs)
- [Gmail Push Notifications Guide](https://developers.google.com/gmail/api/guides/push)
