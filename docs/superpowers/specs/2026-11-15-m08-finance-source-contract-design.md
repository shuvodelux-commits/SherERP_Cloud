# M08 Finance Source Contract & Safety Inventory — Design

**Status:** Focused M08 preparation slice; does not authorize financial posting or an M08 release.
**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` frozen byte-for-byte in `legacy/source`.
**Workstream:** M08, depends on M06 for live finance transactions; read-only source audit may run before M06.

## Intent and safety boundaries

Preserve the source finance transaction types, cash/bank sign convention, session gating, historical openings, separate Party role accounts, and selected customer/supplier ledger identities before SQL or RPC implementation. Cash sessions count only current money movement; an historical-opening Cash Book baseline entry is not today's turnover. Bank transfer must retain one header plus balanced two-account debit/credit legs. Financial reversals are an M07/M08 shared-kernel concern, not part of this slice.

### Considered approaches

1. **Enable ported finance endpoints now:** rejected; M03/M04 shared posting/auth and M06 are not ready.
2. **Write a generic fake finance store:** rejected; would misrepresent monetary atomicity and bypass D1 verification.
3. **Pinned, AST-based source contract inventory and regression assertions (selected):** read-only, deterministic and independently mergeable. Produces concrete tests and a source/RPC/table inventory while keeping posting disabled.

## Deliverable

New `scripts/audit-m08-finance.mjs`, snapshot under `docs/baseline`, tests, and this design/plan. Inspect frozen GAS with Acorn (never execute it). Record explicit selected public endpoints, declared direct staff permissions, direct sheet reads/writes, direct function calls and session gates. Snapshot the original nine finance types, including Owner equity vs lender debt vs borrower receivable and three historical types. Assert key source safety invariants via tokenized, comment-independent source. Reject source drift.

## Out of scope and acceptance

No `src/**`, migration SQL, posting/transaction service, public RPC activation, frontend edits, Cloudflare binding, live data, bank or cash movement, new identity linking, or cross-role settlement. M08-S stays disabled. Tests prove source-contract preservation only, not correctness of legacy behavior nor real D1 atomicity. Future M08 work requires reviewed M02 account contracts, M03/M04 posting gate, M06 interfaces, and real D1 retry/rollback/concurrency and per-role gross reconciliation tests.
