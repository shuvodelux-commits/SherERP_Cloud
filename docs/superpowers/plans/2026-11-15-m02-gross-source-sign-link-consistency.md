# Superpowers Plan — Gross Source Party/Sign Integrity

Date 2026-11-15. Spec: docs/superpowers/specs/2026-11-15-m02-gross-source-sign-link-consistency-design.md. Original pin: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## Task 1 — RED (GitHub first)
- Add new `tests/m02-gross-source-sign-link-consistency.test.mjs`. Build explicit private checkpoints with source group, original ID, Party ID, basis, field, exact kind and safe integer amount, then recompute internally consistent kind totals and summaries.
- Positive examples: one Customer current receivable and historical advance for one Party; Supplier current advance/historical payable; Vendor simultaneously payable and receivable; Finance Person simultaneously Owner equity, Lender payable and Borrower credit; two original Customer IDs belonging to different Parties; row reordering. All satisfy existing source/field/basis tuple guard.
- Negative examples: Customer and Supplier opposite sign kinds in the **same basis/source cell**; Owner equity + advance, Lender payable + credit, Borrower receivable + credit for the **same Finance Person, basis and original source ID**; same Customer ID mapped to different Parties between current and historical; Vendor payable and receivable of one Vendor mapped to different Parties; one Finance Person's Owner versus Lender roles split across Parties. Forge matching readback and matching kind totals so these expose internal source inconsistency, not prior total/count bugs.
- Preserve behavior: exact duplicate expected row produces `PLAN_DUPLICATE_CHECKPOINT` not exception; wrong readback Party/sign yields only redacted missing/extra stages; no readback access on invalid expected source; no input mutation or raw details in public reports.
- Commit tests/spec/plan only, open draft PR, and observe GitHub Foundation failing on expected behavioral assertions **before** implementation.

## Task 2 — GREEN minimal
- Edit **only** `src/party/gross-checkpoint-parity.js` with a tiny pure map over both expected arrays: source-ID-to-Party consistency and account-channel direction consistency. Validate after existing `index(...,true)` strict source tuple checks; do not change expected checkpoint contract, global valid-kind vocabulary, readback indexing or redacted result shape.
- Do not change financial calculations, source import planner, identity decisions, endpoints, schema, Cash/Bank or settlement. Commit GREEN only after RED verified.

## Task 3 — Verify & review
- Check new test and full Foundation Node suite, original 84 GAS source files and 36 original UI includes; independent M02 gross local real Workerd/D1, M02 reviewed source proof, staging, M03 local Workerd/D1, M04 authorization, M01 Chromium and Cloudflare PR safety. Do not claim queued/running checks passed.
- Update GitHub PR with exact RED and GREEN hashes and test results. Keep draft/unmerged until owner approval. Revert PR for rollback, no data impact.
