# M03 — Private frozen-source D1 readback contract (single-run integrator slice)

**Issue:** #22. **Board:** #456. **Main base:** `5ac51572cc3220480cd00841230f07df1c56d924`. **Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Single-writer reservation:** this branch exclusively adds `src/db/m03-frozen-source-headers.js`, `src/db/m03-frozen-source-readback.js`, `tests/m03-frozen-source-readback.test.mjs`, `tests/integration/m03-frozen-source-readback-workerd.spec.mjs` and M03 docs. **Never modify active PR #519** Party adapter/core Workerd test. M11 owns shared workflow edits, so test-only Workerd spec is not auto-added to existing shared CI shards without its review.

## Twelve-sentence implementation overview
1. Define the exact original 49 group headers as a generated, frozen M03 source mapping, from the pinned 659-column `Config.gs` inventory.
2. Add a private, read-only D1 adapter for a future source-row archive that stores historical raw source cells with physical sheet row numbers.
3. Treat the storage schema as a **test-only proposal**, not as an existing migration or public production D1 table.
4. Require an exact sealed group manifest for all 49 groups and reject any missing, extra, duplicate, stale or unsealed group.
5. Reject group headers that are not identical to the frozen source strings, including order and Unicode codepoints.
6. Require every row cell to be a string and every physical row to be a safe integer at least two, with strictly increasing source row positions.
7. Require candidate source row counts to match the independently stored group seal, including zero-length groups.
8. Reject any D1 malformed response, unexpected column, corrupted JSON, oversized group or failed query with a fixed redacted error.
9. Keep all original phone, currency, date, JSON, split-payment, deleted-history and credential strings unconverted and private.
10. Return the source-shaped object required for future M02 exact-text parity only through an internal local API and never expose it by Worker RPC.
11. Add Node SQLite and a separate isolated real Workerd/D1 test harness, preserving every other M03 integration file and all 14 versioned migrations.
12. Run tests RED first, implement the smallest correct awaited reader, then full current-head CI and a scoped M03 PR before attempting any safe merge.

## Acceptance and negative gates
- Input: no unreviewed user-supplied SQL identifiers; fixed D1 SQL with bound values; only server-owned frozen source group names.
- Output: `{formatVersion:1,sourceCommit,groups:{KEY:{headers:[...],rows:[{sheetRow,cells:[...]},...]}}}`, intended solely for an authorized private M10 comparison. No implicit seal **approval** or real D1 import claim.
- A private synthetic D1 seal/row fixture is not production historical data. A complete migration cannot be pronounced while the source 49-group readback, M04 authenticated authority, 394 impacted GAS functions, M03 operational table designs, and M10 private reconciliation remain unverified.
- Original GAS/Sheets preserved, no staging/production DB writes, no cash or bank mutations, and no editing other M03 chat's reserved paths.
