# M08 — Cash Reconciliation Session Overview (read-only) Design

**Owner and source:** M08, frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `legacy/source/CashReconciliation.gs:cashReconciliationBuildRows_` and `Utils.gs:safeDateOnly_`. Builds on merged PR #308's isolated `evaluateCashExplanation`.

## Intent and scope

Return source-shaped overview rows for every Cash Session to let an eventual authorized Cash Reconciliation screen accurately audit differences. No new Cash Book entry or change to actual cash, no mutation of Cash Session state, no backfill, no public RPC or D1 data. Keep original SherERP UI unchanged.

## Approaches

- Mutating live session/Cash Book code before the shared posting kernel: rejected; unauthorized to deploy financial writes.
- Build a separate duplicate reconciliation engine: rejected; risk of competing financial truth.
- **Selected:** source-faithful, pure overview projection that consumes the merged M08 explanation evaluator and M03 safeSourceDateOnly, cross-tested against selected pinned GAS functions in synthetic test VM.

## Source contract

1. Sessions sort chronologically using source `Opened At || Date`; caller supplies already-loaded source-shaped arrays, no leaked Promises. Compute on copies without mutating inputs.
2. First session has `Baseline` opening. Each subsequent opening compares counted opening cash to the last *completed Closed* session's counted cash; a `Closing` or `Open` session does not advance the baseline, and a Closed session missing counted cash must not advance it either.
3. Session opening, closing expected/count and explicit Variance apply original blank-versus-zero behavior. An explicit Variance wins over inferred counted minus expected.
4. Reuse `evaluateCashExplanation` from merged #308 for nonbaseline phases. No automatic explanation or synthetic cash movement. Return all original `cashReconciliationBuildRows_` keys including six value/status fields per phase and `needsReview`.
5. `Open`, `Closing`, `Closed` statuses have source-specific state classification. Missing closed-session close evidence is `Needs Review`, not a fabricated balance.
6. Use explicit trusted business timezone (`Asia/Dhaka` in parity fixtures) for source date normalization; invalid date values use source's string fallback. Do not depend on Worker ambient timezone.
7. Deleted/invalid/synthetic linked Cash Book entries are marked for review by the existing explanation calculator. Raw rows are input-only, not accepted as current authoritative balances.
8. Distinct finance, supplier, customer, vendor, owner and loan accounts are unaffected. Cross-role settlements remain disabled.

## Acceptance and safety

TDD RED commit must show expected missing module failure; GREEN must pass direct frozen-function parity for mixed sessions, date/time sort, explicit variance, explained/underlinked entries, missing closing values, and immutable/malformed inputs; `npm test`, source verification, frontend build plus applicable GitHub checks. There is no DB write and no real D1 concurrency/rollback claim. The PR must report that full M08 finance migration, auth/posting integration and financial reconciliation remain blocked by separate gates; no production D1 binding, schema, legacy source, or frontend changes.
