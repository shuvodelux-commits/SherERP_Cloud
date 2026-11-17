# Superpowers TDD plan — M08 Bank Transfer historical two-leg audit

**Issue:** M08 #66, coordinator #456. **Starting main:** `59b0e2e4b7184acf2f3645aca32da1cb1c6d5cb3`. **Dependency:** PR #509 merged. **Owner:** only `tests/fixtures/m08-d1-transfer-*.mjs`, M08 local D1 integration suite, and this M08 design/plan.

1. **RED:** Add missing schema/adapter imports to existing local M08 Workerd suite, with 8–10 scenarios: source GAS emits header+paired bank legs without Cash Book leg; exact cents and same tenant; one or two missing legs; duplicate transfer/Book ID; duplicate outbound/inbound legs; wrong account or amount; non-transfer type spoofing; manually reversed/corrected leg; orphan reference or deleted header; same account, unknown account, zero amount; cross-tenant same IDs; invalid request; no D1 mutation and Worker 404.
2. Commit RED first, draft PR against main, and **observe actual expected M08 job failure before GREEN**. Do not label cancelled workflow as verified RED.
3. **GREEN:** Introduce `m08_transfer_headers` test-only STRICT table keyed by tenant and source row. Implement `auditD1BankTransfers` using three bound `D1.batch` SELECTs over M08-isolated Account, Bank Book and Transfer headers, with exact-ID validation and deterministic read-only discrepancy classification. Keep byte-size bounded and KISS; never create a financial writer.
4. Verify dedicated M08 real Workerd D1 source/GAS tests. Fix any errors using targeted test changes and minimal implementation; preserve original expectations and document actual failures.
5. Verify current-head full repository CI, source freeze, Foundational Node, frontend/build, cross-module Workerd/Chromium, diff path ownership, review and mergeability. **Merge only with all checks green and review policies satisfied**, then verify merged main contains new files.
6. Leave #66 open; hand source transfer discrepancy classifications to M03 for later SQL-atomic posting integration once M02/M04/M06 contracts are accepted.
