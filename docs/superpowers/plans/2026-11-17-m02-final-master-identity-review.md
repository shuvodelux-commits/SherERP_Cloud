# M02 final source-master review — nonmutating category/unit/Party collision signals

**Issue:** #598, parent #24, board #456.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Starting main:** `1dd09e6d8d2902cc5a4fdd0ee4159e81a0b85bdd`.
**Write scope:** new `scripts/dry-run-master-identity-review.mjs`, `tests/m02-master-identity-review-import.test.mjs`, this plan and M02-only handoff. M03 retains `src/db/**`, migrations, `src/rpc/**`, all shared posting and Cloudflare Worker bindings.

## Objective
M02 already rejects duplicate **original record IDs** and checks exact 49-group header/row fidelity, but it does not explicitly signal identical category/unit **display names under different legacy record IDs** or exact cross-role Party name+phone collisions. Add a **human-review advisory** pass on one **private locally supplied source-shaped export**, using existing Run 3 source validation. A Party candidate is not verified legal identity; same text/phone may represent different people; no automatic joins or financial effects are permitted.

## Constraints
- Source text/phone/name never normalized, rewritten or emitted. Exact nonempty values are used solely for advisory candidate grouping inside the process.
- Category and unit duplicate display names yield separate public-safe issue codes; do not remove or merge rows, even when statuses differ or one original row was soft deleted.
- Exactly five legacy Party master groups: `CUSTOMERS`, `SUPPLIERS`, `VENDORS`, `FINANCE_PERSONS`, `EXPENSE_PAYEES`. Exact nonempty name+phone equality between different source groups produces human-review **candidates**, never automatic linkage.
- All 49 groups and original text/physical row semantics are validated by reusing `reviewOfflineSourceParity({sourceExport, candidateExport:sourceExport})`. This is a shape validator, **not** independent D1 readback.
- Output only fixed issue codes, public group names and counts; no rows, raw original values/IDs, phone, source path, salts/hashes. CLI safe reader is `readLocalJsonFile`, which rejects symlinks and nonregular input. No private snapshots are placed in GitHub.
- Exit 0 only on a locally supplied synthetic/source-shaped input with no review candidates; exit 2 on advisory review findings or invalid private input; neither is a cutover approval.
- All of `d1Verified`, `sourceToD1Reconciled`, `identityConsolidationAuthorized`, `productionReady` are always false.
- Test-first RED → smallest GREEN → check exact-head full CI → independent Super QA/Review. Do not merge without required review even if CI green.

## Tests
Baseline original 49-group shape; Category/Unit same-name distinct-ID flags; exact source-string semantics and no implied canonical aliases; Party cross-role exact match creates review only; no phone-only/name-only auto joins; empty input no fabricated candidates; row-array permutation stable; original record duplicate ID and invalid frozen schema fail closed; CLI redacts private values/paths and never signals D1 source parity.

## Explicit external dependencies
- M02/owner: separately written authorization for private original 49-group + 38 DocumentProperties counters after appropriate backup.
- M03 #22: actual SQL schema, original-text archive/import/readback and SQL-atomic ID writer, under its exclusive ownership.
- M10 #312: independently acquired real source↔D1 data, exact 49/49 reconciliation, gross Party/lot/return historical evidence and restore.
- M11 #306: enforced reviewer/branch gate and independently authorized production cutover.
This PR can finish an M02-owned review **engineering obligation**; it cannot close the entire historical migration/production acceptance.
