# Superpowers plan — M02-safe offline 49-group exact source parity gate (17 November 2026)

**Issue:** #24; **coordination:** #456; **integration source of truth:** main@bcd2d3adbd03f35612c50c1a144a472b1683b412.
**Pinned original business source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 (`Config.gs`; `docs/baseline/schema-inventory.json`).
**Authority:** AGENTS.md, ADR-007, docs/PARALLEL_EXECUTION.md, docs/M03_PARALLEL_READINESS.md.
**Owner:** M02-only `scripts/dry-run-source-parity.mjs`, `tests/m02-source-parity-import.test.mjs`, `tests/fixtures/m02-source-parity.synthetic.json`, and this M02 plan. No shared D1 migrations, src/db, src/rpc, wrangler, shared CI files, private exports, or runtime routes.

## Scope / 12-sentence overview
1. Build a generic offline row-parity gate for every one of the 49 frozen GAS source groups without introducing D1 or Sheets access.
2. Require both explicitly provided exports to identify the exact pinned source commit, plus the frozen original column order for all 49 groups.
3. Require explicit source sheet row numbers, rather than assuming row array order or regenerating missing provenance.
4. Keep all original IDs, phone strings, money decimals, dates, Bengali text, leading zeros, blanks and deletion flags exactly as serialized strings.
5. Reject numeric coercions, missing/extra headers, unsafe row provenance and malformed or partially covered exports.
6. Check distinct source record IDs for groups with proven single-record keys, while allowing repeated parent IDs on line-item and lot-allocation tables.
7. Preserve independent Customer, Supplier, Vendor, Finance Person, and Payee records even when names and phones are identical.
8. Compare each frozen field including gross payable and receivable separately rather than calculating or permitting account netting.
9. Sort by explicit physical sheet row index and compute deterministic per-group SHA-256 evidence, insensitive only to transport array order.
10. Return group-level counts, digests and machine-readable issue codes without emitting PII, Settings values, password hashes or source cell text.
11. Test positive synthetic fixtures and deliberate tampering, including missing/duplicate IDs, moved rows, decimal/date/Unicode mutations, unauthorized source profiles, and CLI error redaction.
12. Keep this a private offline *source-to-candidate projection* parity proof, not a D1 reconciliation certificate, financial posting permit, or production-cutover authorization.

## Acceptance and RED→GREEN
- **RED:** Write Node acceptance tests first importing a not-yet-existent `scripts/dry-run-source-parity.mjs`; run source/test GitHub Actions on the test-only commit to record expected `ERR_MODULE_NOT_FOUND`.
- **GREEN:** Add the smallest read-only implementation and explicit local-file CLI; no network, D1 bindings, writes, new packages or source modifications.
- **Verification:** `node --test tests/m02-source-parity-import.test.mjs`, `npm test`, frozen-source verification and all exact-current-head PR checks.
- **Security:** Full raw source exports stay in the caller's local file; summaries contain only source-group names, counts, SHA-256 group digests and issue codes. No raw IDs, phones, names, amounts, passwords or Settings values are logged.
- **Future acceptance:** M03 must supply real reviewed D1 projection with original row provenance; M10 must verify a private authorized snapshot and gross stock/ledger balances. A matching synthetic replay alone does **not** turn any of 49 groups into a reconciled live migration.
- **No merge:** Until exact-head full GitHub CI has completed successfully and required ownership review has approved the scoped PR.
