# M02 Run 6 — Cross-evidence consistency of the 49-group source snapshot and 38-family ID freeze

**Issue:** #590; parent #24; coordination #456; main base `892115db23b9dead40dce9ed1c69b536d11c0b6c`. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Owner:** M02 only.

## Twelve-sentence overview
1. The original ERP source has 49 source groups, of which exactly 38 define sequential generated ID families.
2. Run 3 validated the exact source-shaped 49-group snapshot but did not compare that snapshot to a separately captured DocumentProperties counter export.
3. Run 4 validated 38 separate original ID-column records and counters but did not assert that their row identities matched Run 3's source snapshot.
4. Run 5 added a privately stored salted commitment manifest for Run 4's ID and counter evidence without validating that a separately supplied 49-group export describes the same rows.
5. Run 6 will join those existing offline checks using the original physical Sheet row and exact generated ID text, not normalized names, phone numbers, amount values or SQLite rowids.
6. We will reuse the existing full-source parity check, ID-floor review and private ID freeze verification instead of duplicating their validation rules.
7. Every historical original sequential ID-row must appear on both sides at the same physical Sheet position with the exact source ID string, including soft-deleted history.
8. Missing rows, extra ID evidence, and mismatched ID text will be reported using only public source-group names and fixed issue codes without exposing original data.
9. A freshly rewritten ID evidence file with a freshly matching Run 5 freeze must still fail if it disagrees with the independently supplied Run 3 source export.
10. A changed stored original counter must fail against the privately retained Run 5 freeze even when original ID rows remain unchanged.
11. A small GitHub-first test-first branch will add one M02-only script, its synthetic acceptance tests and one M02 handoff document, with no D1 schema, RPC, Worker, source, user-data or posting changes.
12. Passing this offline consistency test does not establish independent capture authenticity or real D1 readback and can never authorize source import, ID issuance or production cutover.

## Exact scope and test gates
- **New files:** `scripts/dry-run-source-id-crosscheck.mjs`, `tests/m02-source-id-crosscheck.test.mjs`, this plan, `docs/reviews/2026-11-17-m02-run6-source-id-crosscheck-handoff.md`.
- **Existing read-only dependencies:** `scripts/dry-run-source-parity.mjs` (49-group exact headers, cells and physical row validation), `scripts/dry-run-id-floor.mjs` (38 original ID families and counters), `scripts/dry-run-id-evidence-freeze.mjs` (private salted commitment verification), and `scripts/dry-run-safe-input.mjs` (bounded no-follow file reader).
- **Output:** no source IDs, ID sequences, counters, phone numbers, amounts, Settings, raw rows, salts, hashes, input paths or physical row numbers.
- **RED:** commit tests alone, confirm intended missing implementation failure in GitHub Actions; **GREEN:** smallest script + full exact-head GitHub CI, genuine QA/reviewer before merge.
- **Blocked external acceptance:** independent authorized source export, actual 49-group D1 readback, source-to-D1 import and gross Party/FIFO/accounting reconciliation. M03 alone owns SQL/transaction integration; M10 alone owns actual authorized private D1 rehearsal.
- **No changes:** `src/db/**`, SQL migrations, `src/rpc/**`, `src/index.js`, Worker bindings, `legacy/source/**`, source Sheets, cloud DB, personal data or existing cash/ledger posting.
