# Superpowers TDD Plan — M02-P Real Local D1 Gross Checkpoint Rehearsal

**Date:** 2026-11-15. **Spec:** docs/superpowers/specs/2026-11-15-m02-gross-parity-ephemeral-d1-design.md.
**Base:** M02-P merged #202 gross checkpoint comparator. Original frozen GAS SHA 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## RED
1. Add this design, plan, `tests/integration/m02-gross-parity-workerd.spec.mjs`, and a **PR-only** `.github/workflows/m02-gross-parity-d1.yml`. Intentionally do NOT create the imported `tests/fixtures/m02-gross-checkpoint-d1-reader.mjs` until RED observed.
2. Workerd test harness uses existing nondeployable `wrangler.m02-plan-test.jsonc`; apply unmodified two migrations then use test code to create **test-only** `m02_test_checkpoints` with the original private checkpoint fields. Insert only synthetic rows.
3. Assert: exact same-Party Customer/Supplier/Vendor/Owner/Lender/Borrower positions and separate historical openings; one-cent drift, missing/extra/duplicate records, source-ID and Party-ID drift, moving historical opening to current, soft-deleted finance history; source-blocked DB access skipped, D1 envelope and driver faults sanitized, no extra migration, no public Worker endpoint, inputs immutable, output IDs/money redacted.
4. Open draft PR, capture actual GitHub RED failure because test-only helper import does not exist.

## GREEN
5. Add only **one** new test-only helper `tests/fixtures/m02-gross-checkpoint-d1-reader.mjs`. Initial pure comparator call with empty readback validates that source plan is sound without touching D1. On ready source, one batch of two static SELECTs from test-only table, strict envelopes, pass rows back to existing comparator. No new production code, no write SQL in helper, no raw errors.
6. Commit GREEN. Verify new Workerd integration 0 failed/skipped, complete Node suite and all pinned source/UI checks, M02 identity/review/local staging, M03 Workerd/D1, M04 auth, M01 Chromium, Cloudflare PR safety at exact new commit. Document outcomes (including any pending, timeout or failure) in PR; leave open draft for owner review.

**Rollback:** revert new files only. No production runtime or schema effects.
