# A3 — Solana (Action Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §A3 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

> ✅ Grill verdict radically narrows this spec: **read-only, keyless v1.** Value-moving
> operations are backlog and gated on a future security review.

## 1. Summary & user story

Read Solana chain state from a Zap step.

> **As a** Zap builder, **I want** to query balances, token accounts, and account data
> using mapped addresses, **so that** on-chain state can drive workflow decisions — with
> **zero key custody** on our side.

## 2. Operations — ✅ grilled (Q-SOL-01)

| # | Operation | v1 verdict |
|---|---|---|
| O1 | Get Balance (SOL) | ✅ **IN SCOPE** |
| O2 | Get Token Accounts (SPL, by mint or all) | ✅ **IN SCOPE** |
| O3 | Get Account / raw data | ✅ **IN SCOPE** (base64 + decoded basics) |
| O8 | Latest blockhash / slot / version | ✅ **IN SCOPE** |
| O4 | Send SOL | ❌ backlog — **security-review + external-signer gate** |
| O5 | Send SPL Token | ❌ backlog — same gate |
| O6 | Send raw transaction | ❌ backlog — same gate |
| O7 | Program instruction | ❌ backlog — same gate |
| O9 | Stake / NFT ops | ❌ backlog |

**Custody (✅ Q-SOL-03):** **no secret keys are ever stored.** v1 holds only RPC
configuration. The future send backlog requires an **external signer** model + explicit
security review before `/implement`.

## 3. Configuration & auth (✅ grilled)

- **Connection:** RPC settings only — no wallet credentials:
  - **Network (✅ Q-SOL-02):** selectable `mainnet-beta / devnet / testnet`
    **per connection** (connection-scoped; not per-run, prevents cross-network surprises).
  - **RPC (✅ Q-SOL-04):** default public endpoint out of the box; **user-provided RPC URL
    override** (header/key passed through, stored as connection secret, never logged).
- **Per-run config:** operation + inputs (`address`, `mint?`, `encoding?`).
- Reads may target mainnet safely (no keys involved) — no extra guardrail needed.

## 4. Data contract

Read op outputs (one shape family, op-tagged):

```json
{ "operation": "getBalance", "network": "devnet", "address": "9xQe…", "lamports": 123456789, "sol": "0.123456789", "slot": 250123456, "commitment": "confirmed" }
```

```json
{ "operation": "getTokenAccounts", "network": "mainnet-beta", "owner": "9xQe…", "accounts": [{ "mint": "EPj…", "amount": "12500000", "decimals": 6, "uiAmount": "12.5", "tokenAccount": "7bSP…" }], "slot": 250123456 }
```

```json
{ "operation": "getAccount", "address": "9xQe…", "lamports": 1000000, "owner": "111…", "executable": false, "dataEncoding": "base64", "data": "AQID…", "slot": 250123456 }
```

- **No floats:** lamports/UI amounts as decimal **strings** (precision rule).
- `commitment: "confirmed"` echoed (✅ Q-SOL-05 default, applies to reads' `slot` context).

## 5. Behavior & edge cases

- RPC errors classified: `rpc_rate_limited` (429 → bounded backoff Q-X-06),
  `rpc_unavailable`, `invalid_address` (pre-call validation), `account_not_found`
  (returns as data-complete run vs error — decide: **error**, lean, consistent with
  other actions), `network_mismatch` (connection network vs requested — impossible by
  design since network is connection-scoped).
- Precision: string decimal math only — never IEEE floats for balances.
- Public default RPC rate limits → friendly nudge to add an override on 429 storms.
- Custom RPC credential redacted from logs (secret-class).
- Future send ops (backlog): guardrails defined here for later — external signer required,
  `confirmed` commitment default, mainnet send requires explicit per-connection
  acknowledgment; **not buildable without security review.**

## 6. Acceptance criteria (v1)

- Given address + connection, each of O1–O3/O8 returns within timeout with contract fields.
- Given invalid address, pre-call validation error.
- Given big balance, values arrive as exact decimal strings (no float drift).
- Given account missing, classified `account_not_found` error.
- Given public RPC 429, bounded backoff then classified failure with override hint.
- **Given the whole action: zero code paths handle private keys** (reviewed in
  `/code-review` explicitly).

## 7. Open questions — ✅ all answered (round 13)

| ID | Question | Answer |
|---|---|---|
| Q-SOL-01 | Operations? | ✅ **Read-only** (O1–O3, O8) |
| Q-SOL-02 | Networks? | ✅ **Selectable per connection** |
| Q-SOL-03 | Key custody? | ✅ **No keys stored, ever** |
| Q-SOL-04 | RPC? | ✅ **Public default + user override** |
| Q-SOL-05 | Commitment? | ✅ **`confirmed`** (for future sends; reads echo it) |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-SOL-01** `/implement` + `/tdd` — four read ops, network-scoped connections, RPC
  override secret handling, decimal-string math, error classes.
- **T-SOL-02** fixtures: happy paths, invalid address, account-not-found, 429 backoff,
  override-secret redaction, precision cases.
- **T-SOL-03** `/code-review` with explicit **"no key-handling code"** checklist item →
  `/pr` referencing this file.
- ⛔ **Future:** send-ops backlog requires security review + external-signer design (not
  this run).
