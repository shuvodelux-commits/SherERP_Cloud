# Superpowers TDD plan — Sale Update Mode payment-detail version guard

**Target:** `src/modules/sale-update-read-model.js::projectSaleForUpdate`.

**Frozen references:** `legacy/source/SalesManagement.gs`, `legacy/source/SalePayments.gs`, `AGENTS.md`, `docs/WORKSTREAMS.md` M06. **Spec:** `docs/superpowers/specs/2026-11-17-m06-update-unknown-payment-version.md`.

## RED
1. Extend `tests/m06-sale-update-read-model.test.mjs` with a deterministic regression changing only `Payment Detail Version` of the valid, paid, split-tender sale to unknown `2` and `01`; require explicit `NEEDS_REVIEW`.
2. Confirm in the current GitHub source that version `2` previously returns empty `payments` while Paid Amount remains 70, a real bug rather than a bad fixture. Commit **test-only** SHA first.
3. Observe the intended missing exception from an actual GitHub Actions Node run; capture run/job evidence. If runners remain queued, record that limitation and do not falsely claim the CI gate.

## GREEN
4. After proven RED, introduce the smallest conditional following `detailVersion` normalization and before reading payment children; reject unsupported nonblank version.
5. Retain existing frozen-source parity for legacy blank version and supported version `1`. No new payment data, Party identity, Cash Session bypass or financial ledger writes.
6. Commit implementation separately. Run exact-head Foundation, Node, Workerd/D1, Chromium and Cloudflare PR safety. Check failures, fix scoped regressions and wait until all applicable CI passes before owner merge review.

**Files:** `tests/m06-sale-update-read-model.test.mjs`, `src/modules/sale-update-read-model.js`, this plan, and spec. The frozen GAS, original frontend and production D1 remain untouched. **Rollback:** revert the scoped PR if source evidence proves another saved version is actually supported, not reinterpret values without an explicit review.
