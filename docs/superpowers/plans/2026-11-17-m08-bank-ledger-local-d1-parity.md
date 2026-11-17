# Superpowers TDD — local D1 Bank Ledger source parity

**Design:** `docs/superpowers/specs/2026-11-17-m08-bank-ledger-local-d1-parity-design.md`. **Issue:** #66, coordination #456. **Base main:** `bcd2d3adbd03f35612c50c1a144a472b1683b412`. File owner M08 tests/docs only.

## RED

1. Extend the existing `tests/integration/m08-d1-positional-cash-workerd.spec.mjs` with imports of two missing M08 bank fixtures and source GAS ledger VM oracle.
2. Add real local D1 tests for account/Book row order, stored current, opening baseline single, same-account reversal vs deletion, cross-account rejection, same-day tie break, date range/empty, drift audit, metadata, active/mobile total, two tenants with matching original IDs, malformed canonical source date, duplicate imported IDs and non-routing request. Preserve SQL snapshots before/after reads.
3. Commit RED independently, open draft PR, confirm dedicated [M08 local Workerd/D1 workflow] failure is the intentionally absent M08 fixture module rather than an unrelated infrastructure failure.

## GREEN

4. Add `tests/fixtures/m08-d1-bank-ledger-schema.mjs` defining **disposable STRICT tables** `m08_bank_accounts` and `m08_bank_book`, with physical `legacy_row`, per-tenant duplicate-identity review support and integer cent columns. These are **not production migrations**.
5. Add `tests/fixtures/m08-d1-bank-ledger-preview.mjs` with strict identity/request shape, tenant parameterized local D1.batch, duplicate identity rejection, source-shaped mapping and pure existing M08 Bank Ledger calculator. No writes or public RPC.
6. Correct failing RED cases via minimal KISS changes without weakening source parity. Document Workerd GREEN run, frozen source verification, Foundation/Node tests, frontend build and required cross-module full CI.

## Merge / subsequent scope

Keep one M08-owned branch and PR; do not introduce shared M03 D1 posting. After all current-head workflows succeed and reviewer/files gates pass, mark ready and merge only with owner authorization and verify the fixtures are present in `main`. Add bank transfer atomic settlement and finance-person cross-account flows only when M02-P/M03/M04/M06 shared posting contract is approved, not as speculative production writers. Issue #66 remains open.
