# M06 — Consumed draft must stay consumed on operation replay

**Authority:** SherERP Cloud AGENTS.md, M06 workstream, frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (DraftSales.gs), and the existing approved synthetic replay receipt contract.

## Behavior

Source DraftSales.gs explicitly scans both active drafts and immutable audit when generating draft numbers so a posted/deleted draft is never silently reused. In the isolated M06 Workerd/D1 sale proof, a draft that was consumed during successful sale posting should remain absent. The existing same-operation replay proof already checks its POSTED audit, but would acknowledge a sale with `REPLAY` if the consumed draft somehow reappears with the original ID. This could mask an unsafe import/recreation and leave an orphan active draft visible to staff.

For a matching operation and sourceDraftId, the read-only replay proof must also verify **no active row exists for the original tenant+draft ID**. If the draft unexpectedly exists again, report `NEEDS_REVIEW` while preserving the already-posted sale and all current ledger/stock state; do not delete, consume or overwrite the reappeared draft. No-draft sales keep their existing replay behavior. Only the original tenant+draft ID matters.

## Non-goals and boundaries

Local synthetic **test-only** proof. No production migration, live sales writer, new RPC, D1 schema, Party settlement, invoice UI, Cash Session policy or source GAS change. No runtime side effects on replay.

## Acceptance

- RED: post an authorized split-payment draft; reinsert the exact consumed draft ID into isolated local D1 while its posted audit remains; replay same stable operation ID now incorrectly yields `REPLAY`.
- GREEN: the same retry raises `NEEDS_REVIEW`; ledger, owned stock, invoice, audit and recreated draft remain unchanged.
- Existing clean replay, non-draft replay, duplicate-operation conflict, atomic rollback and sibling M07 tests remain green; exact-head CI supplies verification.
