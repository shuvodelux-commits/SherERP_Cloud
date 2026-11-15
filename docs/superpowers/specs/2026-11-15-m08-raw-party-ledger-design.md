# M08 Customer and Supplier raw ledger projection — Design

**Status:** A deliberately narrow, read-only M08 preparation/implementation slice, following merged PRs #67, #77, #80 and #81. No financial migration or live RPC is authorized.
**Source of truth:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` in immutable `legacy/source/PartyLedger.gs` and `DeleteEngine.gs`.
**Architecture:** Owner-approved ADR-007: one Party can hold seven roles; each legacy account/financial bucket remains distinct; no auto-net or identity inferred from phone/name.

## Problem

The legacy Party Ledger exposes separate Customer and Supplier indexed audit balances. Their debit/credit signs use `Debit - Credit` for both source kinds, but the economic buckets are different (Customer receivable/advance vs Supplier payable/advance). The full business-facing ledger also performs invoice display, correction chain collapsing, paging and date selection, backed by old Sheets functions. None is yet an authorized D1 read API. A safe first port must preserve raw indexed amounts and provenance, not invent one combined due.

## Considered approaches

1. Port the entire Party workspace/public RPC and SQL ledger now — **rejected**; M02-P imported account design, M03 posting kernel, M04 permissions and M06 freeze are required.
2. A generic seven-role single due/net projection — **rejected**; violates separate account buckets and may net owner equity against debt.
3. **Selected:** a pure internal raw Customer/Supplier ledger index with frozen source VM parity. The source function `partyLedgerBuildAscendingIndex_` is the behavior oracle. Finance Owner/Lender/Borrower and Vendor remain separate future work, not erroneously treated as Customer/Supplier balances.

## Contract

`projectRawLegacyPartyLedger(kind, legacyId, rawRows)` supports only `kind === 'customer'` or `kind === 'supplier'`, each with the matching source ID column (`Customer ID` or `Supplier ID`). It consumes already-loaded synthetic/source-shaped index rows with `_rowIndex`, `Ledger ID`, `Date`, `Debit`, `Credit`, `Is Deleted`; no D1 access.

- Filter by the exact legacy **ID**, never display name, phone, Party ID or another role's ID. If two roles later map to one reviewed Party, they remain separate account calls and separate results.
- Respect source `isDeleted_`: boolean `true` or case-insensitive string `TRUE` is excluded; the underlying original source remains immutable.
- Stable ascending business date `String(Date).slice(0,10)`, then padded sheet row index, then Ledger ID, not Created At. Keep all genuine audit rows, including Sale Update/Purchase Update; **do not run clean/business-facing correction collapse in this raw view**.
- Recompute each row's running `_displayBalance` from `roundMoney_(previous + Debit - Credit)` and attach `_stableKey` exactly as the original index. Return `{kind,legacyId,rows,closingBalance}`, with a signed closing amount **for that role only**. Negative balances are not silently normalized or combined.
- Fail closed for unknown kinds/Owner/Lender/Borrower/Payee, missing legacy ID, Promise-instead-of-loaded array and malformed input. Preserve input row objects and order (no mutation). A later permission-checked repository must enforce authority, link review, deletion and D1 ordering before any public endpoint.
- Original source is executed by the existing M08 test-only Acorn/VM runner, with a synthetic `PARTY_LEDGER_CONFIG_` reflecting the original two source ID columns; test only source-stored function declarations. **Not** a migrated source file or a new accounting writer.

## File/RPC/table impact and acceptance

Add one pure ESM file under `src/modules/m08-party-raw-ledger.js`, one `node:test` suite, M08-only test oracle runner allowlist update for `PartyLedger.gs` and `DeleteEngine.gs`, and this spec/plan. Do not change `src/db/**`, SQL, M02 identity links, M04 auth, `src/rpc/**`, `src/index.js`, frontend, Cloudflare config or `legacy/source/**`. No database reads or writes and no public functionality. RED must show missing module in PR GitHub CI, GREEN must pass original GAS parity and full repository tests. Test active/deleted rows, independent role IDs, negative advance, same-day ordering, backdated dates, signed cent rounding, unknown role, Promise leakage and input immutability.

This is **raw index parity only**, not business-facing Party ledger display or imported reconciliation. The later module will separately tackle correction projections, finance role buckets, gross account reconciliation and authenticated D1 reads; cash/bank posting and M08-S settlement stay disabled until all gates are approved.
