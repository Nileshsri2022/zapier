# Specification: GitHub Trigger (`GitHub Push`, `GitHub Pull Request`, `GitHub Issue`, `GitHub Release`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: GitHub Trigger (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0002 (Unified Run Intake and Transactional Outbox) and ADR-0003 (Hybrid Push and Stateful Polling Trigger Ingress)  

---

## Problem Statement

Engineering teams want to automate workflows (team alerts, release announcements, issue triage, deployment hooks) when code is pushed or pull requests, issues, or releases occur in a GitHub repository.

---

## Solution

Provide four GitHub Trigger types (`GitHub Push`, `GitHub Pull Request`, `GitHub Issue`, `GitHub Release`) with an inbound webhook endpoint (`POST /api/github/webhook/:zapId`), constant-time HMAC-SHA256 signature verification (`X-Hub-Signature-256`), event-type matching, structured payload extraction, and `GitHubMetaData` setup UI in the web editor.

---

## User Stories

1. As a Zap creator, I want to select `GitHub Push`, `GitHub Pull Request`, `GitHub Issue`, or `GitHub Release` from the trigger catalog and see setup instructions and secret generation in `GitHubMetaData`.
2. As a Zap creator, I want `Modal.tsx` to advance to Step 3 (`GitHubMetaData`) when I select a GitHub trigger event, so that I can generate or enter a webhook secret and review repository webhook instructions before saving.
3. As a security-conscious developer, I want `POST /api/github/webhook/:zapId` to verify `X-Hub-Signature-256` using constant-time `crypto.timingSafeEqual` whenever `GITHUB_WEBHOOK_SECRET` is configured, rejecting missing or forged signatures with HTTP 401.
4. As a Zap creator, I want the GitHub webhook handler to verify that the incoming `X-GitHub-Event` (`push`, `pull_request`, `issues`, `release`) matches my Zap's configured `AvailableTriggers.type`, ignoring mismatched events safely.
5. As a downstream action author, I want normalized metadata (`repository.name`, `repository.full_name`, `sender.login`, plus `branch`/`head_commit` for `push`, `pull_request` details for `pull_request`, `issue` details for `issues`, and `release` details for `release`) passed into `enqueueRun`.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `GitHub Trigger`, `Trigger ingress`, and `Run intake` per `GLOSSARY.md`, `ADR-0002`, and `ADR-0003`.
- **Constant-Time HMAC-SHA256 Verification**: `verifyGitHubSignature` computes `sha256=<hmac>` over the raw request body and compares via `crypto.timingSafeEqual`.
- **Normalized Event Payload Schema**: `extractPayloadData` extracts a clean, predictable JSON object per GitHub event type so templates like `{repository.full_name}`, `{head_commit.message}`, `{pull_request.title}`, `{issue.title}`, and `{release.tag_name}` work out of the box.
- **Modal Step 3 Routing**: `Modal.tsx` includes `selectedItem.type.startsWith("GitHub")` in `needsMetadata` so selecting any GitHub trigger displays `GitHubMetaData`.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **GitHub Webhook Ingress Seam (`POST /api/github/webhook/:zapId`)**: Tests HMAC-SHA256 signature verification (missing, invalid, valid), unsupported event filtering, trigger-type mismatch handling, payload normalization across `push`/`pull_request`/`issues`/`release`, and `enqueueRun` invocation.
2. **Web Metadata Form Seam (`GitHubMetaData` & `Modal.tsx`)**: Tests event label mapping, secret generation, and Step 3 modal routing.

### Prior Art in Codebase
- `apps/server/tests/security/github-webhook.test.ts`
- `apps/server/src/routes/GitHubRoutes.ts`
- `apps/web/components/metadata/GitHubMetaData.tsx`

---

## Out of Scope

- GitHub OAuth App automatic webhook installation (users paste the generated webhook URL into GitHub repo settings).
- Outbound GitHub actions (creating issues or comments).

---

## Further Notes

- Per-Zap URLs follow `/api/github/webhook/:zapId` on the server service.
