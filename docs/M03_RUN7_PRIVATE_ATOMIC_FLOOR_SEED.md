# M03 Run 7 — local synthetic D1 original source-ID floor initialization

**Workstream:** M03 exclusive source-ID/D1 owner (#22) and coordination #456.
**Source baseline:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Safety:** PRIVATE, LOCAL, SYNTHETIC, NONDEPLOYABLE. This does not authorize any live migration, staff actor, public RPC, ID issuance, money/stock posting, or Cloudflare D1 binding.

## Contract and atomicity boundary

`createM03PrivateSourceFloorInstaller({DB},trustedTenantId).installFreshSynthetic_({idEvidence,freezeManifest})` only accepts fixed offline M02 evidence, and first runs the existing M03 Run 5 private verification of **all 49 sealed D1 source groups**, exact historical/deleted ID rows for **38 original ID families**, and the M02 salted original ID/counter freeze. It calculates `max(original historical sequence, separately frozen original DocumentProperties counter)` for each of the 38 Config-pinned families without logging those values.

The private **synthetic** table `synthetic_m03_id_counters` is seeded by exactly one parameterized SQLite `WITH floors(...) INSERT INTO ... SELECT ...` statement containing all 38 bound entries. The statement commits **all 38 rows or zero rows**. It refuses to insert anything for the given tenant if **any existing counter or issued receipt** exists; a complete exact prior seed is treated as a stable replay and is verified (not rewritten). An existing partial, wrong, extra, missing, bad-prefix, wrong-floor or prior-receipt state is rejected by the Run 6 audit. A trigger/SQL error aborts the entire single statement, with no partial seeded family rows. Other tenants are unchanged.

Only after D1 confirms statement success does Run 6's existing read-only audit re-read all 38 counters, enforce the frozen floors and zero receipts, and return a fixed nonauthorizing result. An ambiguous/failed SQL result is **not** treated as success; retrying with the same evidence is safe if the previous statement committed. **This post-commit readback is not a transaction with the prior source read, and it does not prevent a later staff/migration write or establish lasting authority.** Trusted caller is offline; there is no public route or secret path.

## Test-first and QA

- **RED:** test-only PR #614 head `11e03554a0b3d9cc3cdeeab476ed6d563ba6c263` imports deliberately absent `src/db/m03-private-source-floor-install.js`; missing-module error observed in [dependent workflow #44138666122](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44138666122), job `134235087459`, with 3,450 unrelated Node tests passing.
- **GREEN:** `tests/m03-frozen-source-readback.test.mjs` covers full first-seed, stable replay, partial/poisoned preexisting seed, prior receipt, SQL-trigger rollback, cross-tenant absence, forged evidence/extra authority flags and no private data in SQL text. Workerd/D1 regression extends the **existing** source-readback spec's final case without changing M11's six-shard test membership, exercising real atomic statement rollback and replay.
- **Merge gate:** exact-head full GitHub CI and secret-free preview checks, independent Super QA → Super Review (separate reviewer), zero unresolved threads, explicit user-approved merge. Governance issue #594 remains open.

## Remaining blockers

This uses **synthetic tables only**, not a reviewed source-to-operational D1 importer or production migration. Genuine owner-authorized Sheets/DocumentProperties custody, independent 49-group accounting/Party/FIFO source reconciliation, approved per-tenant D1 floor installation schema and M04 current actor authority **inside SQL-atomic mutation**, followed by M05–M08 unified stock/ledger/Cash Session replay and reversal, M10 staging restore and M11 owner cutover signoff remain required. `sourceToD1Reconciled:false`, `independentSourceCaptureVerified:false`, `idIssuanceAuthorized:false`, `publicRpcEnabled:false`, and `productionReady:false` are immutable NO-GO result flags. The public Worker remains D1-unbound and `src/rpc/registry.js` remains empty.
