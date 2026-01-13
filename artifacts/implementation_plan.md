# ZapMate Implementation Plan

## Next Phase: Core Improvements

### Goal
Implement the highest-priority missing features to make ZapMate production-ready.

---

## Proposed Changes

### 1. Slack Integration

Add Slack as an action type for Zaps.

#### [NEW] `apps/server/src/services/SlackService.ts`
- Create Slack webhook integration
- Send formatted messages to channels
- Support Block Kit for rich messages

#### [MODIFY] `apps/worker/src/index.ts`
- Add Slack action handler
- Parse message templates
- Send to Slack webhook URL

#### [MODIFY] `packages/db/prisma/schema.prisma`
- Add `Slack` to action types enum

---

### 2. Zap Execution History UI

Show users their Zap run history with success/failure status.

#### [NEW] `apps/web/app/dashboard/history/page.tsx`
- List ZapRuns with pagination
- Show trigger data and action results
- Filter by Zap, status, date

#### [NEW] `apps/server/src/controllers/ZapRunController.ts`
- `GET /api/zap-runs` - List runs with filters
- `GET /api/zap-runs/:id` - Run details

---

### 3. Email Verification

Verify user emails before allowing Zap creation.

#### [MODIFY] `packages/db/prisma/schema.prisma`
```diff
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  password  String
  name      String
+ isVerified Boolean @default(false)
+ verificationToken String?
}
```

#### [MODIFY] `apps/server/src/controllers/AuthController.ts`
- Generate verification token on signup
- Send verification email
- Add `POST /api/auth/verify/:token` endpoint

---

## Verification Plan

### Automated Tests
```bash
# Run existing tests
cd apps/server && npm test

# Test Slack integration
curl -X POST http://localhost:5000/api/test-slack \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"webhookUrl": "...", "message": "Test"}'
```

### Manual Verification
- [ ] Create Zap with Slack action
- [ ] Trigger Zap and verify Slack message
- [ ] View execution history in dashboard
- [ ] Sign up and verify email link works

---

## Priority Order

1. **Email Verification** (security)
2. **Execution History** (user experience)
3. **Slack Integration** (high user demand)
