# M09 — D1 Day Book transaction source readiness, authenticated and fail-closed

**Date:** 2026-11-16. **Original source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/DayBook.gs::getDayBookTransactions`; owner-approved `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/architecture/ADR-007-unified-party-relationships.md`. **Main at branch start:** `d77f5c0c86c5c1e6c1bfe8046dd36fc454011087`. **Prerequisite:** merged #403 pure 12-group Day Book snapshot composer; no public D1 transaction source adapter is approved or implemented.

## Scoped 12-sentence design / why this slice

1. The original Day Book consumes twelve complete source groups, including Cash/Bank/Party sources, and cannot produce accurate balances from a subset.
2. The current target migrations define auth, Settings, catalog and selected audit tables, not a source-complete ledger/transaction import or tenant boundary.
3. Reading only existing M05/M06 synthetic posting tables as if they were full original `SALES`/`PURCHASES` history would fabricate an empty or partial business Day Book.
4. Introduce one **internal and read-only** `createM09DayBookSourceReadinessReader(env).inspect({token,nowMs})` that checks actual isolated D1 source-table presence **only after a current M04 `daybook.view` authority decision**.
5. The checked *legacy physical source-table identifiers* are fixed constants: `SALES`, `SALES_RETURN`, `PURCHASES`, `PURCHASE_RETURN`, `CUSTOMER_LEDGER`, `SUPPLIER_LEDGER`, `EXPENSES`, `FINANCE_TRANSACTIONS`, `BANK_TRANSFERS`, `BANK_BOOK`, `STOCK_MOVEMENT`, `CASH_BOOK`; their group order matches #403.
6. This is a **diagnostic inventory**, not a new requirement that final migrated D1 tables retain Sheets names; subsequent approved mappings may use audited target names and verified columns/source IDs.
7. Use a **single parameterized SELECT** whose authorization CTE checks the raw bearer hash, active modern credential, session idle/expiry, user/role version and `daybook.view` current permission *in the same SQL statement* as `sqlite_schema` inspection; no authorize-then-scan gap or client-supplied actor.
8. Unauthorized, inactive, revoked, expired, wrong-role-version, malformed input or D1-unavailable requests throw/deny and **reveal no table inventory**; no browser/public RPC route.
9. Authorized requests return only the ordered list of existing and missing **legacy names**; no row payloads, counts, secrets, payment details, roles, SQL statements or tenant/business data.
10. **`ready:false` must remain unconditional even if someone creates all twelve names**, since table existence does not prove full-row import, immutable source ID mapping, correct date/time normalization, reviewed tenant identity or gross Cash/Bank/Party reconciliation.
11. Never add public D1 preview bindings, transaction/finance/posting paths, cash-session changes, cross-role netting, migrations, import jobs, or cached authorization; only isolated local Workerd D1 is used by tests.
12. Future implementation can consume this diagnostic only after independently reviewed source-provenance and completeness attestations with real D1 tests; the whole Day Book continues unavailable until explicitly safe.

## Exact API and result
- `createM09DayBookSourceReadinessReader({DB}).inspect({token,nowMs})`, where `token` is 64 lowercase hex characters and `nowMs` is server-owned safe integer milliseconds.
- `{ready:false,status:'MISSING_SOURCE_GROUPS'|'SOURCE_PROVENANCE_UNVERIFIED',presentLegacyGroups:string[],missingLegacyGroups:string[]}`. Status is `MISSING_SOURCE_GROUPS` until all fixed legacy table names exist; after that it is `SOURCE_PROVENANCE_UNVERIFIED`, never `ready:true`. Groups are **ordered** by frozen original source.
- Inspect uses exact fixed names from `sqlite_schema`, not user-defined SQL identifiers; no fallback empty arrays, no implicit source mappings, no fabricated `getDayBookTransactions` response.
- Any missing auth row or malformed D1 result throws a generic deny/unavailable error; caller must not return partial diagnostics to browser.

## TDD and rollback
Five additive files only: this spec, `docs/superpowers/plans/2026-11-16-m09-daybook-source-readiness-d1.md`, `tests/integration/m09-daybook-source-readiness-workerd.spec.mjs`, `.github/workflows/m09-daybook-source-readiness-workerd.yml`, `src/modules/m09-daybook-source-readiness-d1.js`. First commit tests and isolated CI workflow **without** implementation; observe expected RED on real Workerd before coding. Then add the minimal reader and inspect GREEN full Node/Foundation, isolated Workerd, browser, preview safety and PR checks. Draft PR, no auto-merge. Rollback remove five paths; D1/production data unaffected.
