# Superpowers TDD plan — M02-P Gross Checkpoint Parity

**Date:** 2026-11-15. **Spec:** `docs/superpowers/specs/2026-11-15-m02-gross-checkpoint-parity-design.md`. **Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Task 1 — RED first in GitHub

- Add this plan/spec and `tests/m02-gross-checkpoint-parity.test.mjs` on an isolated feature branch; **do not create production module until actual RED**.
- Use `prepareGrossPartyBalances` and the source-shaped existing fixture to create a real private expected checkpoint plan: one reviewed Party with Customer receivable and opening advance, Supplier payable/advance, both independent Vendor directions, separate Owner/Lender/Borrower signed accounts, original source IDs. Copy its rows to a supplied synthetic readback. No SQL, no D1, no asset deployment.
- Cases: exact match; reorder permitted; same Party distinct account kinds; one missing/extra/duplicate current or historical row; amount changed by one cent; zero/negative/unsafe minor units; Party ID/source ID/source group/account kind/source field swapped; current vs historical basis swapped; soft-deleted historical Finance transaction contribution ignored; forged plan summary, source pin, currency, gross totals or money effect; pending reviewed identities; malformed data fixed generic errors; no input mutation or private contents in output; no D1/prod certification.
- Commit RED, open draft PR, observe GitHub Foundation failing on expected missing `src/party/gross-checkpoint-parity.js` while prior tests pass.

## Task 2 — Minimal GREEN

- Add only new pure module `src/party/gross-checkpoint-parity.js`. Validate preflight is ready/consistent, otherwise skip without dereferencing readback; separately index current and historical source link/account checkpoint identity; compare exact minor-unit values, count missing/extra/duplicate/mismatch. Aggregate fixed-code redacted issue counts only. No alternative account calculations, SQL, imports or new dependencies.
- Commit GREEN, verify focused and full Foundation suite.

## Task 3 — CI, review, and rollback

- Verify exact-HEAD GitHub Foundation all Node tests, 84 frozen GAS source files and 36 original frontend includes; M02 real local Party D1, M02 reviewed local D1, synthetic rehearsal, local staging, M03 full local Workerd/D1, M04 auth, M01 Chromium and Cloudflare no-secret PR safety workflows. Cite real runs including queued/in-progress.
- Document genuine GitHub RED/GREEN hashes, evidence and four new files; ensure no conflict with active Party finance-ID, source-row and auth PRs. Leave draft unmerged for owner approval.

Rollback: revert PR; no migration/data impact.
