# Backlog sweep — 27 open issues, verified against `main`

Second pass over the issue tracker after `docs/backlog-triage.md` (PR #65) closed
nine issues. Every verdict below comes from reading the code on `main` and, where
a test exists, running it. Issue bodies are **not** trusted: most were written
against `arenas/113111c6-zapier` and several have been fixed since.

Totals: **15 fixed**, **9 still broken**, **3 test-junk issues**.

## Verified fixed (closable)

| Issue | Proof | Evidence |
|---|---|---|
| #23 signup leaks password hash | `tests/auth/signup-response.test.ts` 1/1 | `AuthController.ts` returns `{ id, name, email }` |
| #24 Gmail endpoints leak secrets | `tests/gmail/server-api.test.ts` 3/3 | `toPublicGmailServer()` whitelist, used at `:219` and `:263` |
| #25 Gmail delete touches other users' rows | `tests/gmail/server-api.test.ts` 3/3 | `ownedServer = findFirst({ where: { id, userId } })` at `:320` |
| #26 IM trigger accepts foreign `zapId` | `tests/integrations/trigger-zap-ownership.test.ts` 2/2 | `zap.findFirst({ where: { id: zapId, userId } })` at `WhatsAppRoutes.ts:338` |
| #27 GitHub webhook accepts unsigned deliveries | `tests/security/github-webhook.test.ts` 3/3 | `verifyGithub` verdict gates at `GitHubRoutes.ts:221/248` |
| #29 OAuth state is unsigned | `tests/security/oauth-state.test.ts` | `signState` / `stateSecret` HMAC at `GoogleOAuthService.ts:67-114` |
| #30 Solana bs58 ESM interop | `tests/solanaRead.test.ts` 15/15 | `sendSolana.ts` gone; `solanaRead.ts` uses `PublicKey`, zero `bs58` refs |
| #31 Schedule timezone math | `tests/schedules/next-run.test.ts` | `resolveTimezone` / `computeNextRun` in `services/schedule.ts` |
| #32 Gmail reconnect duplicates servers | `tests/gmail/callback-reconnect.test.ts` | find-by-`{userId,email}` then update at `GmailController.ts:115/126` |
| #33 IM triggers never create trigger rows | `tests/zaps/im-trigger-creation.test.ts` 4/4 | `zapComposition.ts:359` (WhatsApp) and `:385` (Telegram) |
| #34 failed offsets never committed | code | explicit `commitOffsets` in both the success and catch paths, `apps/worker/src/index.ts:281/306` |
| #35 unquoted A1 range | `tests/GoogleSheetsPoller.test.ts` 14/14 | `quoteSheetName` at `:25`, used at `:148` |
| #40 Gmail trigger step is a dead end | code | `GmailMetaData` branch in step 3 + Save buttons (`GmailMetaData.tsx:89/104/119`) |
| #48 schedule cron double-fire | `tests/schedules/schedule-sweep.test.ts` | `occurrenceKey` dedupe + atomic claim in `CronRoutes.ts` |
| #52 email `to` not templated | `tests/sendEmail.test.ts -t "templates recipients"` | `parseList(meta.to).map((v) => template(v, run))` at `sendEmail.ts:129-131` |

Test-junk, safe to close: **#1** ("test"), **#2** ("test2"), **#3** ("test3").

## Still broken

| Issue | Root cause on `main` | Size |
|---|---|---|
| #38 token refresh overwrites every mailbox | `GmailService.ts:95` — `updateMany({ where: { clientId } })`; `clientId` is platform-wide, so one refresh rewrites every user's token | S |
| #39 editor never lists Gmail accounts | `Modal.tsx:135` reads `data.servers \|\| data.bots`; the server sends `{ message, gmailServers }`. `GmailMetaData` already has the `gmailServers` fallback — the gate in `Modal` does not | **1 line** |
| #41 empty `phoneNumberId` blocks every later connect | `ConnectWhatsAppSchema.phoneNumberId = z.string().optional()` (`packages/types/src/index.ts:130`) and `Modal.tsx:314` posts `phoneNumberId: ''` | S |
| #42 IM/Webhook actions have no config form | `needsMetadata` (`Modal.tsx:216-228`) lists neither `WhatsApp` nor `Webhook`, so step 3 never opens; the action branch has WhatsApp/Telegram/Discord but **no Webhook** | S |
| #43 Webhook/GitHub trigger forms unreachable | same `needsMetadata` gate omits `Webhook` and `GitHub`; both branches exist in step 3 but are dead | **2 lines** |
| #44 JWTs never expire, returned in body | `jwt.sign({ id }, secret)` with no `expiresIn`; token in the response body; logout cannot revoke | M — needs a product decision |
| #46 Sheets first poll fires every pre-existing row | `!oldHash` is treated as "new row" (`GoogleSheetsPoller.ts:187`); no baseline seed for the `POST /api/zaps` path; hashes expire after 30 days and re-fire the sheet | M |
| #47 hashes written before enqueue | `redis.hset` inside the row loop (`:215`) runs **before** `createZapRun` (`:262`) — a failed intake loses the row permanently | S–M |
| #57 one platform-wide email rate limit | `packages/email/src/index.ts:15-17` — single `email:rate_limit` key, 10/hour for all tenants | S |

## Suggested order

1. #39, #43 (one/two-line gates) + #42 (adds the Webhook action branch) — one PR.
2. #38, #47, #57 — data-integrity, each with a focused test.
3. #41 — schema change ripples into the editor form; needs a Phone Number ID field.
4. #46 — needs a baseline marker plus a seed on the editor creation path.
5. #44 — needs decisions on token lifetime, storage, and logout revocation.
