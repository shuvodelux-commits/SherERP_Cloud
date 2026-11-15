# M06 — Invoice due-date timezone oracle regression (Issue #92)

**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Invoice.gs::computeInvoiceDueDate_` and `legacy/source/Utils.gs::formatDate_`. Original source and `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007 reviewed.

## Diagnosis and intended behavior

The original GAS `computeInvoiceDueDate_` creates a calendar date from local year/month/day, advances by calendar days with `setDate`, and uses `formatDate_` from `Utils.gs`. That helper delegates to `Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd')`, rather than ISO/UTC formatting. The existing isolated M06 test oracle instead shims `formatDate_` with `new Date(date).toISOString().slice(0,10)`; for a local midnight in `Asia/Dhaka` that returns the **previous UTC day**, introducing an oracle-only discrepancy (Issue #92). In the Worker read projection, `Date` is an already-reviewed source-shaped date-only/canonical string and `dueDate` advances its calendar day with UTC calendar arithmetic without a host-local timezone dependency.

The source test oracle must emulate the script's `Asia/Dhaka` formatting explicitly, regardless of the host process timezone. Preserve the original date-only invoice and payment terms contract. Do not alter source GAS, due-date production arithmetic, POS UI or persisted values for a test-double error. Do not claim arbitrary ISO timestamp/offset semantics are approved beyond the existing canonical read projection input policy; M03 owns the future D1 date serialization contract.

## RED → GREEN acceptance

1. **RED:** commit this plan and `tests/m06-invoice-timezone-regression.test.mjs` before changing the fixture. The test runs the existing independent native-vs-target invoice oracle suite in *both* `TZ=UTC` and `TZ=Asia/Dhaka` child processes. The latter must fail on the current oracle (demonstrating Issue #92).
2. **GREEN:** minimally replace only the `formatDate_` shim in `tests/fixtures/m06-posted-invoice-oracle.mjs` to emulate frozen `Utils.gs` using `Asia/Dhaka` date components (`Intl.DateTimeFormat(...).formatToParts`), not `toISOString()`. Keep the actual GAS `Invoice.gs` and `SalePayments.gs` loaded unchanged in `node:vm`.
3. Verify the dual-TZ test, the existing invoice oracle cases and all required GitHub CI checks; verify the source manifest remains unchanged. Report actual failing/passing evidence rather than treating a test-only fix as full POS readiness.

## File/RPC/table/financial impact and rollback

Two changed/new files in this slice plus this plan: one new timezone regression test, one modified **test-only** oracle fixture; no production code, database, migrations, import, settings, RPC, Worker/Cloudflare configuration or frontend changes. No Customer, Party, Cash, Bank, Stock, journal or invoice mutations. Source Customer ID remains authoritative, no cross-role netting. Revert this PR to restore prior test behavior. Production posting remains disabled pending M02-P/M03/M04/M05/M06/M08 safety gates.
