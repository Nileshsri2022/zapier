# Comprehensive Test Suite Implementation Plan

## Current State
- **Existing tests**: `tests/auth/` with signup, signin, error-handling, integration tests
- **Test framework**: Jest with SuperTest for HTTP testing
- **Mocking**: Database, bcrypt, JWT, email all mocked in `setup.ts`

## Controllers to Test

### 1. ZapController (Priority: High)
| Function | Test Coverage Needed |
|----------|---------------------|
| `createZap` | Valid creation, invalid data, auth, duplicate handling |
| `fetchZapList` | Pagination, empty list, filtering by user |
| `fetchZapWithId` | Valid ID, invalid ID, auth |
| `deleteZapWithId` | Valid delete, not found, auth |
| `renameZapWithId` | Valid rename, empty name, not found |
| `enableZapExecution` | Toggle on/off, auth |
| `updateZapWithId` | Full update, partial update, validation |
| `processWebhookTrigger` | Valid processing, error handling |
| `processGmailTrigger` | Valid processing, error handling |

---

### 2. TriggerController (Priority: High)
| Function | Test Coverage Needed |
|----------|---------------------|
| `fetchAvailableTriggers` | Valid fetch, empty state, auth |
| `handleWebhook` | Valid webhook, invalid signature, missing zapId |
| `handleGmailTrigger` | Valid trigger, missing data, processing errors |
| `verifyWebhookSignature` | Valid/invalid signatures |

---

### 3. ActionsController (Priority: High)
| Function | Test Coverage Needed |
|----------|---------------------|
| `fetchAvailableActions` | Valid fetch, empty state, auth |
| `executeAction` | Email, Solana, Gmail actions |
| `executeEmailAction` | Valid send, SMTP errors, placeholder replacement |
| `executeSolanaAction` | Valid transaction (mocked) |
| `replacePlaceholders` | Various template patterns |

---

### 4. GmailController (Priority: Medium)
- OAuth flow tests
- Token management
- Server CRUD operations

### 5. GmailTriggersController (Priority: Medium)
- Trigger CRUD operations
- Watch management

### 6. GmailActionsController (Priority: Medium)
- Send, Reply, Label operations

---

## Test Files to Create

```
tests/
├── auth/              (existing)
├── zaps/
│   ├── create.test.ts
│   ├── list.test.ts
│   ├── update.test.ts
│   └── delete.test.ts
├── triggers/
│   ├── triggers.test.ts
│   └── webhook.test.ts
├── actions/
│   └── actions.test.ts
└── utils/
    └── helpers.test.ts
```

## Mocks to Add
- Full Prisma client mock (zap, trigger, action models)
- Gmail API mock
- Nodemailer mock
- Axios mock for external API calls

## Implementation Order
1. Update `setup.ts` with complete Prisma mocks
2. Create `tests/zaps/` tests (CRUD operations)
3. Create `tests/triggers/` tests (webhook handling)
4. Create `tests/actions/` tests (action execution)
5. Create `tests/utils/` tests (helper functions)
