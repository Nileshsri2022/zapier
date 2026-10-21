# Specification: Solana Action (`AvailableActions.type = "Solana"`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Solana Action (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0004 (Single Worker Action Engine for Provider-Backed and Stateless Actions)  

---

## Problem Statement

Web3 developers and businesses automating bounties, payouts, or treasury transfers need a native action to send SOL on the Solana network using dynamic recipient addresses and amounts from trigger events.

---

## Solution

Provide the `Solana` action configured via `SolanaMetaData` (`address`, `amount`) and executed in `apps/worker` (`sendSol` in `apps/worker/src/sendSolana.ts`), supporting `{placeholder}` interpolation, `SOLANA_PRIVATE_KEY` / `SOL_PRIVATE_KEY` keypair resolution, integer lamport rounding (`Math.round(amount * LAMPORTS_PER_SOL)`), and loud failure on missing keys or RPC errors.

---

## User Stories

1. As a Zap creator, I want to select `Solana` from the action catalog and configure the recipient wallet `address` and SOL `amount` (supporting dynamic placeholders like `{wallet}` or `{amount}`) in `SolanaMetaData`.
2. As a developer running `apps/worker`, I want `executeActionWithRetry` to interpolate placeholders in `address` and `amount` and verify that ` getSolanaPrivateKey()` (`SOLANA_PRIVATE_KEY` or legacy `SOL_PRIVATE_KEY`) is set before attempting a transfer.
3. As a developer running `apps/worker`, I want `sendSol` to reject non-positive or non-finite SOL amounts immediately and convert fractional SOL amounts to integer lamports via `Math.round(parsedAmount * LAMPORTS_PER_SOL)`.
4. As a platform operator, I want on-chain RPC errors from `sendAndConfirmTransaction` to propagate so `withRetry` retries transient RPC failures and marks the `ZapRun` as `failed` rather than faking success.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Solana Action` and `ZapRun` per `GLOSSARY.md` and `ADR-0004`.
- **Dual Environment Key Resolution (`getSolanaPrivateKey`)**: Checks `process.env.SOLANA_PRIVATE_KEY` first and falls back to `process.env.SOL_PRIVATE_KEY` for backward compatibility.
- **Loud Failure Invariant**: Missing private keys, invalid amounts, or failed transactions always throw an `Error` so the worker never silently skips a financial transfer.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Worker Solana Execution Seam (`sendSol`, `getSolanaPrivateKey`, `executeActionWithRetry`)**: Tests env variable resolution, invalid amount rejection, fractional SOL to integer lamport rounding, placeholder interpolation, and RPC failure propagation.
2. **Web Metadata Form Seam (`SolanaMetaData`)**: Tests address and amount inputs, initialData rehydration, and `handleClick` emission.

### Prior Art in Codebase
- `apps/worker/tests/solana.test.ts`
- `apps/worker/src/sendSolana.ts`
- `apps/web/components/metadata/SolanaMetaData.tsx`

---

## Out of Scope

- SPL token transfers (only native SOL transfers via `SystemProgram.transfer` are supported).
- Inbound Solana blockchain listeners.

---

## Further Notes

- Connects to Solana Devnet (`https://api.devnet.solana.com`) with `finalized` commitment.
