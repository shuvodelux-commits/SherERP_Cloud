# M06 — Posted receipt survives Bank/Mobile catalog removal or reclassification

**Status:** scoped continuation after merged M06 PR #319; only the synthetic local Workerd/D1 proof is in scope.

## Source and invariant
Read target AGENTS.md, M06 section of docs/WORKSTREAMS.md, frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, and existing M06 sale posting/replay tests. Posted invoice/tender/Bank Book rows must be reconstructible from the original immutable historical source values. A loss-of-response retry with an unchanged operation ID, tenant, actor and payload must neither post twice nor fail solely because the original payment account was archived, removed or assigned a new type later.

**Problem:** merged PR #319 allows prior same-actor replay against *inactive* accounts, but still calls `normalizeSalePayments_` using present-day `m06_bank_accounts` metadata. The same original retry throws `Choose an active payment account` when the historical account is removed, or `Payment account type does not match` when reclassified.

## Design decision and alternatives
- **Chosen:** on prior same-actor operation, reconstruct the non-cash account ID/type lookup exclusively from the posted invoice's immutable `payments_json` (same tenant+operation query). Normalize the supplied payment rows, compare their canonical operation hash to persisted hash, and still execute the complete existing read-only original sale receipt integrity checks. Missing, invalid or structurally inconsistent historical evidence must fail closed as `NEEDS_REVIEW`, not become permission to transact.
- A current-catalog fallback: simplest but leaves legitimate historical retry broken after catalog edits.
- Override current catalog metadata globally: unsafe, could authorize *new* sales against retired accounts.

**New operations:** continue to require existing active Bank/Mobile catalog rows and the **unchanged** SQL-level Bank active guard, Cash Session, owned stock and reviewed Customer link. A caller cannot create their own historical status, actor or operation ID. Any different actor on a claimed operation is `CONFLICT`; changed tender values and canonical payload cannot become `REPLAY`.

## Acceptance and boundaries
1. Post two distinct Bank and Mobile sales; remove both payment account rows; exact-operation retries acknowledge their historical invoices, no new stock/cash/bank/customer due writes.
2. Post a Bank sale, change catalog method to Mobile Banking; original Bank retry still replays, while a *fresh* Bank sale fails.
3. Same operation with altered payment amount/method or different actor is not acknowledged as the original transaction.
4. Existing child-table mismatch must remain `NEEDS_REVIEW`, never `REPLAY`.
5. Real local Workerd/D1 RED proof, minimal GREEN, unchanged M07/M08 tests, exact-head CI and draft owner-review PR. Do not claim production M06 parity or deploy.

**File ownership:** only `tests/fixtures/m06-sale-posting-contract.mjs`, `tests/integration/m06-sale-posting-workerd.spec.mjs`, and the spec/plan. No production `src/`, schema migration, Worker RPC, original UI/GAS, Cloudflare production data or backend financial activation. Keep separate from open PR #313 multi-unit integration.
