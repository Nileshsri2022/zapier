# ZapMate Trigger Testing Plan

This document describes how to verify every trigger end-to-end without creating Zaps by hand.
It is written for the `arena/e0db599c-zapier` branch.

## 1. What I fixed first (delete issue)

`deleteZapWithId` now removes all related integration rows before deleting the Zap:

- ZapRunOutbox, ZapRun
- GmailTrigger, GmailAction
- GoogleSheetsTrigger
- WhatsAppTrigger, TelegramTrigger, GoogleCalendarTrigger, ScheduledTrigger
- Trigger, Action
- Zap (with userId ownership check)

Previously, Zaps that used WhatsApp/Telegram/Google Calendar/Schedule triggers failed to delete
because their foreign-key rows were not removed. The trigger delete is now wrapped so a missing
trigger row does not abort the whole transaction.

## 2. Testing strategy (no manual Zap creation)

I will drive everything through the REST API with a small Node/TS harness:

1. **Auth**: signup/login a test user, capture JWT cookie.
2. **Seed data**: ensure `availableTriggers`/`availableActions` exist (`npm run seed`).
3. **For each trigger type**:
   - Look up its `availableTriggerId`.
   - `POST /api/zaps` with trigger + one action (`Email` or `Webhook` action) and metadata.
   - Fire the trigger event (webhook POST, cron tick, or external event).
   - Poll `GET /api/zaps/:id/runs` until a `ZapRun` appears or timeout.
   - Assert run status `completed` (or at least created).
   - `DELETE /api/zaps/:id` to clean up.
4. **Report**: pass/fail per trigger with error messages.

The harness lives at `apps/server/tests/integration/trigger-e2e.test.ts` (to be added).
It only runs when `RUN_E2E=1` and a real database is available.

## 3. Trigger-by-trigger method

| # | Trigger | How it is fired | What success looks like |
|---|---------|-----------------|-------------------------|
| 1 | Webhook | `POST /hooks/:userId/:zapId` with JSON body | ZapRun created with payload in metadata |
| 2 | Schedule (min/hour/day/week/month) | Wait for `nextRunAt` or call processor cron | ZapRun created after schedule tick |
| 3 | Gmail New Email / Labeled / Starred / From Sender | Send test email to connected Gmail, or call `POST /api/triggers/gmail/:zapId` with email payload | ZapRun created |
| 4 | Google Sheets Updated Row | Append a row to the sheet, or run sheets poller | ZapRun created |
| 5 | Google Calendar (new/updated/start/ended/cancelled/matching) | Create/update event in calendar, or run calendar poller | ZapRun created |
| 6 | WhatsApp Message Received | Send WhatsApp message to the connected number, or POST webhook payload | ZapRun created |
| 7 | Telegram New Message | Send a message to the bot, or POST webhook payload | ZapRun created |
| 8 | GitHub Push / PR / Issue / Release | Push a commit / open PR / issue / release in test repo | ZapRun created (via hooks service) |
| 9 | Solana | On-chain event / manual trigger endpoint | ZapRun created |
| 10 | Email (generic) | Depends on implementation (likely manual) | ZapRun created |

Actions are verified by checking the action side-effect (email sent, message delivered, etc.)
or at minimum that the ZapRun completed without error.

## 4. What I need from you

Please provide the following. I will not store secrets in the repo; they go in your local `.env`.

### Core (required for any run)
- `DATABASE_URL` (PostgreSQL, reachable from where tests run)
- `JWT_SECRET`
- `CRON_SECRET`
- `FRONTEND_URL`, `HOOKS_URL` / `NEXT_PUBLIC_HOOKS_URL`
- A test user email + password (or I create one via signup)

### Per integration (only for the triggers you want tested)

**Gmail**
- Google OAuth Client ID + Secret
- A Gmail account with refresh token (or I run the OAuth flow and you approve)
- A test sender email

**Google Sheets**
- Same Google OAuth credentials
- A test spreadsheet ID + sheet name shared with that account

**Google Calendar**
- Same Google OAuth credentials
- A test calendar ID

**WhatsApp**
- Meta access token, phone number ID, business account ID
- A test recipient phone number

**Telegram**
- Bot token (from BotFather)
- A chat ID to send/receive test messages

**GitHub**
- A GitHub personal access token (repo scope)
- A test repository you control (owner/repo)

**Solana**
- RPC URL (devnet is fine)
- A funded devnet wallet keypair (or I generate one and you fund it)

**Email (generic action)**
- Resend API key + sender email (if testing email action)

### Optional but recommended
- A running Kafka broker (or I skip Kafka-dependent paths)
- SMTP/Resend credentials for email action verification

## 5. How to run once you provide the above

```bash
# 1. Install
cd apps/server && npm install

# 2. Seed triggers/actions
npm run seed

# 3. Set env (create apps/server/.env from .env.example + the secrets above)

# 4. Start server
npm run dev

# 5. Run the E2E suite (I will add this)
RUN_E2E=1 npx jest tests/integration/trigger-e2e.test.ts --verbose
```

## 6. What I will deliver

- `apps/server/tests/integration/trigger-e2e.test.ts` with per-trigger cases.
- A JSON/Markdown report of pass/fail per trigger.
- Fixes for any trigger that fails (controller, polling, or payload shape).

## 7. Immediate next step

Reply with the secrets for the integrations you want tested first (I suggest starting with **Webhook + Schedule**, which need no external accounts), and I will implement and run the harness.