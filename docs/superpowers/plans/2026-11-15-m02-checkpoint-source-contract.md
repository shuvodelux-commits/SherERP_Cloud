# Superpowers Implementation Plan — M02-P Gross Source/Account Contract

**Date:** 2026-11-15
**Spec:** docs/superpowers/specs/2026-11-15-m02-checkpoint-source-contract-design.md
**Scope:** one existing comparator, three new spec/plan/test paths; no migration, no deployed-worker changes.

## Task 1 — Reproduce RED on GitHub
1. Inspect frozen original gross `prepareGrossPartyBalances` and full `reconcileGrossPartyCheckpoints` contract. Write synthetic baseline preflight with 1 exact original source/account checkpoint and a matching private readback, internally consistent pinned version, currency, summary and kind totals.
2. Add negative tests for **forged preflight** with Customer/Vendor, Supplier/Customer, swapped Vendor directions, Finance/Customer, invalid Finance source field, Customer source-current opening, Supplier historical due and Vendor/Finance historical openings. Recompute preflight kind totals so these are not merely failing the existing totals check. Assert a sanitized failure without accessing any external database. Include a positive matrix covering every legitimate current/historical kind, preserving non-netted behavior. Existing readback-only mismatches must continue to produce redacted counts.
3. Commit **tests first**, open a dedicated draft GitHub PR. Verify actual Foundation failure on an impossible tuple currently accepted; confirm the failing assertion is behavioral, not an import/syntax error.

## Task 2 — GREEN minimal source guard
4. Add one small frozen-source contract mapping to `src/party/gross-checkpoint-parity.js`. Apply strict combination check only when indexing expected preflight rows. Continue indexing readback rows using the existing global vocabulary so role-swaps return mismatch issues. Never mutate inputs or return values.
5. Commit GREEN. Inspect exact-head Node suite, 84 frozen GAS, 36 preserved UI includes, M02 synthetic and real Workerd/D1 including PR #213's 14 synthetic gross tests, M03 local Workerd, M04 auth, M01 Chromium, Cloudflare PR safety.

## Task 3 — Completion
6. Update PR with RED/GREEN hashes, exact test/run evidence, remaining limitations. Keep draft/unmerged for owner. `PARALLEL-MODULE-READY=false`. Revert the PR if necessary; no data migration or account posting.
