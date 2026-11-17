# M09 — Offline Customer/Supplier Ledger Source-Link Integrity

**Workstream:** M09 read-only source evidence · **Issue:** #567; previous M09 tracker #431 · **Coordination:** #456 · **Base:** `main@e75cde4f49f511f3e95f7c07bd896cdd69bd9e81` · **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Twelve-sentence implementation overview

1. Preserve the already-merged eight-group M09 offline comparator and its fail-closed public-read prohibition.
2. Inspect Customer Ledger and Supplier Ledger source-account references in each separately normalized snapshot.
3. For Customer Ledger, require the referenced original account source ID to exist in that snapshot's historical CUSTOMERS master rows.
4. For Supplier Ledger, require the referenced original account source ID to exist in that snapshot's historical SUPPLIERS master rows.
5. Count soft-deleted master rows as legitimate historical identity references, because historical transactions and audit provenance must remain intact.
6. Do not merge Party roles or infer identities from names, phones, totals, or account directions.
7. Report a fixed redacted `SOURCE_ORPHAN_ACCOUNT_LINK` or `IMPORTED_ORPHAN_ACCOUNT_LINK` blocker without returning the private source ID.
8. Leave FINANCE_TRANSACTIONS identity matching to the separate reviewed FINANCE_PERSONS/M08 source contract, which this eight-group proof does not contain.
9. Write regression tests first where matching source and imported orphans currently escape the existing cross-side parity check.
10. Make the smallest pure in-memory change after documenting the expected RED failure, then verify focused GREEN and full GitHub CI.
11. Change only this M09 comparator, its tests and this M09 plan, leaving M02/M03/M04/M08, D1, SQL, RPC, financial posting, original UI and Worker bindings untouched.
12. Keep `ready:false` unconditionally and require independently reviewed M02 source-to-D1 receipts plus M03/M04/M08 authorization/reconciliation before any report activation.

## Acceptance

- RED: orphan source and imported ledger links remain indistinguishable from valid receipt equality in existing implementation, so the new test fails for the intended assertion.
- GREEN: missing Customer/Supplier historical master IDs produce respective fixed per-side blocker codes, even when all physical row counts, hashes and signed values match.
- Historical deleted masters are still referentially valid; existing eight focused tests remain green.
- No raw source IDs or monetary values leave the audit. No public RPC/DB query/privileged reader is added.
- Run focused tests, complete `TZ=UTC NODE_OPTIONS='--test-reporter=tap' npm test`, `npm run verify:source`, frontend build and exact-head mandatory GitHub Actions before review.
- **Dependencies:** M02 source identity/hashes, M03 authenticated read design, M04 actor authority, M08 gross account parity; no live release or financial activation.

**Owned paths:** `src/modules/m09-dashboard-offline-row-parity.js`, `tests/m09-dashboard-offline-row-parity.test.mjs`, and this new M09 plan. **Rollback:** revert this isolated PR only. **Merge:** after independent review and full exact-head CI; not automatically.
