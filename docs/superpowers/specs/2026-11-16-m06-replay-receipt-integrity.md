# M06 — Sale replay requires complete posted receipt evidence (local D1 proof)

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original `Sales.gs::completeSale` replay/stranded-invoice behavior, target `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007 and M03 readiness.

## Risk
The merged synthetic M06 sale contract returns `REPLAY` when the invoice's operation ID, actor and hash match, without checking its associated posted child rows. The test-only fixture protects existing child UPDATE/DELETE, but direct extraneous INSERTs or corrupt imports can still create inconsistent tender/Cash/Bank evidence. A matching invoice header is not a committed-posting receipt when child evidence is inconsistent.

## Design
For a matching prior operation, independently read its exact tenant+invoice scoped sale items, movement, payment children, Cash Book, Bank Book and Customer Ledger. Also verify draft consumption audit for posted drafts. Require each row set to equal what the current source-based split-payment planner and canonical payload fingerprint expects; any unexpected/missing/duplicated row rejects the replay as `NEEDS_REVIEW`. Keep original `COMMITTED`, `DECLINED`, and `CONFLICT` outcomes, stable operation IDs and normal source payment calculation unchanged. A fresh post still commits inside its existing SQL trigger boundary; verification is not a second writer or authority to change accounting.

**Scope:** `tests/fixtures/m06-sale-posting-contract.mjs`, `tests/integration/m06-sale-posting-workerd.spec.mjs`, this spec and companion plan. The source repo, original frontend, `src/`, production migrations, RPC, Worker config, Party/account logic, cash-session policy and deployment remain untouched.

## Acceptance
- A clean repeated submit replays its immutable invoice and does not write stock/money a second time.
- An extra Cash Book row or extra payment child or Bank Book row, inserted directly after a previous commit, causes `NEEDS_REVIEW`, never a false `REPLAY`.
- A valid consumed draft's audit is required to acknowledge replay.
- All regular source-pinned and local Workerd/D1 accounting, stock concurrency, duplicate-operation and rollback tests still pass.
- Exact-head GitHub CI is authoritative; the isolated proof is not a production ledger audit or M03/M04/M05/M07/M08 release approval.
