# T4 — GitHub (Trigger Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §T4 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Start a Zap when activity happens in a GitHub repository.

> **As a** Zap builder, **I want** my Zap to fire on repo activity (issues, PRs, pushes),
> **so that** GitHub events can drive chat alerts, tickets, or deployments.

## 2. Trigger events — ✅ grilled (Q-GH-01)

| # | Event | v1 verdict |
|---|---|---|
| E1 | New Issue | ✅ **IN SCOPE** (opened) |
| E2 | New Pull Request | ✅ **IN SCOPE** (opened) |
| E3 | Push | ✅ **IN SCOPE** (one run per push) |
| E4 | New Release | ❌ backlog |
| E5 | New Comment | ❌ backlog |
| E6 | Starred / Forked | ❌ backlog |
| E7 | Closed / Merged / Labeled transitions | ❌ backlog |

## 3. Configuration & auth (✅ grilled)

- **Connection:** GitHub OAuth **or** fine-grained PAT (choose at connection UX — repo
  read scope for private repos, `public_repo` otherwise). Stored once per provider (Q-X-03).
- **Per-Zap config:** **single repository** picked at setup (✅ Q-GH-04), event type,
  **optional branch/tag filter** for pushes with **no default restriction**
  (✅ Q-GH-05 — all branches fire until the builder filters).
- **Delivery (✅ Q-GH-02):** **webhook path preferred** — repo (or user-level) webhook →
  our endpoint, `X-Hub-Signature-256` validated, dedupe via `X-GitHub-Delivery`;
  **polling fallback** (REST since-cursor) where webhooks can't be registered (e.g. no
  permission to configure repo hooks).
- House rule applies: test mode returns instant sample data (Q-X-05); failures
  retry-with-backoff-then-stop (Q-X-06).

## 4. Data contract (✅ Q-GH-03: trimmed + `raw`)

```json
{
  "event": "pull_request.opened",
  "repository": { "fullName": "acme/zapmate", "htmlUrl": "…", "private": false, "defaultBranch": "main" },
  "sender": { "login": "ada", "id": 42, "avatarUrl": "…" },
  "issue": { "number": 7, "title": "…", "body": "…", "state": "open", "labels": ["bug"], "htmlUrl": "…" },
  "pull_request": { "number": 8, "title": "…", "state": "open", "draft": false, "base": "main", "head": "feat/x", "merged": false, "htmlUrl": "…" },
  "push": { "ref": "refs/heads/main", "before": "…", "after": "…", "commits": [{ "id": "…", "message": "…", "author": { "name": "…", "email": "…" }, "url": "…" }], "commitCount": 3, "headCommitMessage": "…" },
  "deliveryId": "72f1…",
  "raw": { }
}
```

- Slices relevant to `event` populated (issue ⊂ issue-only events, pull_request ⊂ PR
  events, push ⊂ push); others absent from mapper.
- **`raw`** = untouched original payload (webhook body or polled JSON) — always present.
- `deliveryId` exposed for idempotent downstream use (webhook delivery id or poll cursor id).

## 5. Behavior & edge cases

- **Dedupe:** webhook → `X-GitHub-Delivery` unique; poll → cursor + `(repo, event, number)`.
- **Push granularity (✅ Q-GH-05):** one run per push with `commits[]` bundled (cap list
  at 20 with `commitCount` reflecting true total); branch/tag filter evaluated on `ref`.
- Signature validation mandatory on webhook path; unsigned → rejected (no run).
- Polling fallback: REST 5k/hr authenticated rate limits → backoff; GraphQL not required v1.
- Private repos & insufficient scope → auth-class error naming missing scope.
- Renamed/transferred repo → cursor invalidation handled (rebind by repo id, not name).
- Concurrent Zaps on same repo each keep own dedupe state (delivery-id set is shared store,
  run fan-out internal).

## 6. Acceptance criteria (v1)

- Given an issue opened on the configured repo, one `issue.opened` run with trimmed +
  raw payload.
- Given the same webhook redelivered (same delivery id), zero extra runs.
- Given unsigned webhook payload, rejected with security error.
- Given a push of 3 commits with no filter, **one** run, `commits[]` length 3.
- Given a push to a non-matching branch (filter set), no run.
- Given private repo + missing scope, actionable auth error.
- Given REST rate-limit during polling fallback, backoff honored.

## 7. Open questions — ✅ all answered (round 6)

| ID | Question | Answer |
|---|---|---|
| Q-GH-01 | Which events? | ✅ **Core E1–E3** (issues, PRs, pushes) |
| Q-GH-02 | Delivery mode? | ✅ **Webhook preferred, polling fallback** |
| Q-GH-03 | Payload shape? | ✅ **Trimmed + `raw` passthrough** |
| Q-GH-04 | Repo scope? | ✅ **Single repo per Zap** |
| Q-GH-05 | Push granularity / filters? | ✅ **Per push, commits bundled, optional filter, no default restriction** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-GH-01** `/implement` + `/tdd` — webhook endpoint + signature, polling fallback cursor,
  three event routings, dedupe, contract.
- **T-GH-02** fixtures: duplicate delivery, unsigned payload, filtered push, private-repo
  auth failure, rate-limit backoff.
- **T-GH-03** `/code-review` against acceptance criteria.
- **T-GH-04** `/pr` referencing this file.
