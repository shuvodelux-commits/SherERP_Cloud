# M08 — Cash Reconciliation explanation submission validation (read-only)

**Frozen source:** Mohim_ERP at `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `CashReconciliation.gs:saveCashReconciliationExplanation`, before the first `cashReconciliationRetireLegacyAdjustment_` or `updateRowFields_` call.

## Goal and boundaries

When an operator selects existing Cash Book entries to explain a Cash Session opening/closing variance, a deterministic validation step must distinguish correct explanation links from stale/incorrect ones *without* applying the legacy writer's effects. Build `validateCashReconciliationExplanation(sessionRows,cashRows,{sessionId,phase,entryIds,timeZone})` as an **internal read-only projection** over fully loaded source-shaped rows. Do not register RPC or import into any public Worker handler. It must not modify Cash Book, session expected/variance fields, reconciliation links or Party/account balances.

## Approaches considered

1. Port the complete old `saveCashReconciliationExplanation` with LockService and Sheet mutations: **rejected**. LockService is not D1 concurrency safety, and cash movements require M03/M04 authenticated atomic/idempotent posting gates.
2. Build a second accounting/explanation engine: **rejected**. Risk of competing truth and divergence from the frozen source.
3. **Selected:** reuse merged #308/#320/#326 M08 read-only projections to obtain phase meta and parse IDs; validate ordered failure conditions against frozen source `saveCashReconciliationExplanation` using a Node VM test-only source oracle. Stop just before write effects. Exact invalid-source messages are retained, valid result is a source-shaped `{sessionId,phase,state:'Explained',entryIds,requiredDirection,requiredAmount}` **validation result only**, not confirmation of a persisted explanation.

## Required behavior and failure ordering

- Validate original phase normalization (lowercase, not implicit trim), then parse comma/newline/JSON/array IDs with trim and de-duplication. Empty selection fails before any session lookup.
- Session must exist, selected phase must have a *nonzero* difference. First opening baseline and missing/zero close difference cannot be explained.
- Each candidate entry is checked **in selection order**: if any other session or phase already links it, reject first; then reject absent/soft-deleted Cash Book row; then reject synthetic `Session Open`/`Day Close Adjustment`; then zero/wrong-signed cash movement. A link already stored for the **same** phase is eligible on revalidation.
- Accumulate signed `Credit - Debit`, rounded to two decimals at every step. Accept only a signed total that equals the phase difference exactly. Over/under explanations fail; never silently partial-settle or modify the ledger.
- Output and error messages match the original source on well-formed synthetic fixtures. A valid result is **not** a token, permission grant, commit authorization or persisted posting evidence.
- **Intentional fail-closed strengthening for malformed migration data:** reject Promise/unloaded rows, missing trusted business timezone, duplicate nonempty Session IDs or Cash Book Entry IDs. Use `Map`/`Set` to avoid prototype-shaped ID collisions.
- Do not consider only 250 visible candidate rows; validation must find entries by ID in the entire loaded Cash Book. Never infer accounting eligibility from search filtering or UI selection.
- Leave previous finance source readers and original frontend untouched. No customer/supplier/vendor/owner/lender/borrower/payee netting, no M08-S, no imported business data.
- Authorization and DB-enforced concurrency, idempotency, per-tenant isolation, atomic synthetic retirement + reconciliation update, expected cash recalculation, recovery and D1 failures **are excluded** and must be solved in separately reviewed writer work before production.

## Acceptance

Superpowers RED: add frozen-source oracle tests and commit before new module; inspect GitHub Actions for expected `ERR_MODULE_NOT_FOUND`. GREEN: minimal module; verify full `npm test` and source/build checks in GitHub Actions, document code/file diff and remaining release blockers. No financial writes or D1/schema changes. PR remains unmerged for owner review.
