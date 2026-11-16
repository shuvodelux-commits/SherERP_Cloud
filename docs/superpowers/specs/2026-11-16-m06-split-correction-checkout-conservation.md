# M06 — Split payment correction must validate original checkout conservation

## Goal and source
The owner-approved M06 workstream requires original sale, payment, Cash/Bank and Customer effects to conserve exact money before any correction workflow is considered. This branch is based on frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/SalePayments.gs`, and the existing isolated `src/modules/sale-payment-correction-plan.js`. The pure `planSaleSplitPaymentCorrection` currently validates original Paid/Due individually and verifies that later settlement equals the original values. It also verifies the historical split payment children and Cash/Bank book evidence. However, it does **not** prove `original paid + original due = original grand total` before calculating new tender differences. A corrupted imported invoice with Grand=100, Paid=70, Due=30.01, and otherwise internally consistent payment/book evidence can thus be presented as a candidate for historical payment correction.

## Reviewed behavior
1. Before constructing any replacement payment correction intent, parse the saved `Grand Total` with the existing exact, nonnegative integer-paisa parser `salePaymentPaisa_`.
2. Require the already-parsed saved Paid + Due to equal that grand exactly with safe-integer arithmetic.
3. On mismatch or invalid original amount, fail closed with deterministic `NEEDS_REVIEW: original split-payment checkout totals mismatch`; do not infer due, repair imported data or silently normalize.
4. Continue to reject later Customer settlement differences separately; a legitimate collection does not rewrite original checkout fields.
5. Preserve the exact source-shaped allocation, signed Cash/Bank account deltas, active/reversed payment children, next revision and immutability for every valid invoice.
6. Do not change or add a source GAS function, public Worker RPC, D1 SQL schema/transaction engine, cash-session policy, Party ledger, frontend or print format.

## Alternatives considered
A future M02 importer-only constraint would not protect snapshots edited/altered after import. A visual warning with a correction proposal would still produce a misleading financial intent. Repairing Due in-place would invent financial history and violate the frozen-source migration. This narrow pure preflight is defense in depth; the eventual financial writer still needs a separately reviewed atomic D1 guard and authorization. It must not be presented as production-ready sale editing.

## Superpowers evidence required
First commit one regression with an exact 1-paisa mismatch that currently succeeds and hand-check its expected failure; include a valid test proving later settlement remains separate. Observe RED in an actual GitHub Actions Node job, then commit minimal GREEN. Verify all exact-head Foundation/Node, Workerd/D1, browser and Cloudflare preview-safety workflows before merge. Create a draft PR for owner review; no automatic merge. Do not change unrelated M05 multi-unit, M07 returns, M08 ledgers or production D1.
