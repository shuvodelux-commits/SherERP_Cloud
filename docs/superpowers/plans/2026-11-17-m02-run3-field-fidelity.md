# M02 Final Run — Frozen source-field preservation and handoff contract

**Issue:** #24. **Board:** #456. **M03 shared integrator:** #22. **M10 rehearsal:** #312.
**GitHub main baseline:** `7c81dca09f975fbda37586eb50c2763c7f8506df`. **Pinned original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Scope:** new M02-owned `scripts/dry-run-source-fields.mjs`, `tests/m02-source-fields-import.test.mjs`, and this plan / final handoff review. Do NOT edit any current PR #505/#515 files; no shared D1 schema/migration, M03 RPC, private source data, Cloudflare bindings or M10 orchestration.

## 12-sentence implementation overview
1. Build a complete exact-column review contract from the pinned `Config.gs` inventory for every one of the 49 source data groups.
2. Label every source column as exact original text and require a separate, explicitly reviewed target-operational-field mapping.
3. Identify security credentials, source record IDs, display identity values, financial amounts, stock quantities, chronological data, deleted-history flags and JSON/revision snapshots as distinct fidelity hazards.
4. Distinguish `SETTINGS.Value` as potentially secret-bearing configuration text, not a decimal or public log value.
5. Preserve phone text, leading-zero account identifiers, Bengali names and all other source strings without numeric or timestamp coercion at the preservation boundary.
6. Preserve Vendor payable and receivable as two independent original columns without automatic offsets.
7. Preserve Customer/Supplier signed opening balances separately from current due and stop historical opening edits from becoming current Cash/Bank activity.
8. Preserve source Product stock, purchase-lot quantities, sale-lot consumption and multi-unit/bundle conversion snapshots without rewriting FIFO or introducing a new correction kernel.
9. Preserve original SALE_PAYMENTS split tender, change and reversal operation IDs, and original return/edit/delete audit history.
10. Prevent private `USERS` passwords, `SESSIONS` tokens and `SETTINGS` values from being printed as field contents, placed in evidence reports or accidentally authorized as public RPC output.
11. Produce deterministic metadata-only review output with no database/network/file writes and explicit `productionReady:false`, `sourceReconciled:false`, `d1WriterAuthorized:false`.
12. Apply RED→GREEN TDD with Node acceptance tests and full exact-current-head GitHub CI, then hand off reviewed field obligations to M03 and M10 without falsely closing their external authorization gates.

## Acceptance
- Every frozen source group and every original column represented exactly once; wrong 49-group schema or changed source pin fails closed.
- Critical source fields have conservative, explicit human review semantics; ambiguous fields remain `review-text`, not converted, dropped, defaulted or inferred.
- No guess that a proposed operational D1 field is deployed. No historical source data are imported or read by this PR.
- Existing PR #505 has full CI green but no recorded review; PR #515's one failing expectation has a targeted M02 test fix. Do not merge any of these PRs before exact-head full CI and required owner review.
- Final report states design completion separately from real source→D1 reconciliation (0/49 certified until independently evidenced).
