# M06 invoice timestamp clock integrity — TDD plan

> **Required:** Superpowers TDD: test commit → observed RED → minimal fix → exact-head GREEN CI. Use a dedicated GitHub branch; no auto-merge.

**Goal:** Reject impossible date-field time and timezone components before reprinting an invoice.

**Architecture:** Preserve existing `dateOnly` ISO shape and Gregorian round-trip. Add one numerical bounds guard for the optional timestamp suffix; no parsing to a different date/time zone.

**Spec:** `docs/superpowers/specs/2026-11-16-m06-invoice-timestamp-clock-integrity.md`

**Stack:** Node ESM and test runner, pure `src/modules/sale-invoice-read-model.js`, GitHub Actions. No dependencies.

## Constraints
- Frozen legacy source, original UI and receipts, D1 migrations and operational sale writer are unchanged.
- Separate from open M06 posting PR #333 and multi-unit PR #313.
- Existing invoice read-model source-parity and local-time tests must still pass.

## Review focus
- Valid Gregorian calendar date with impossible clock is refused before invoice body is returned.
- Invalid numeric timezone offset is refused without changing other timestamps.
- Source-valid `Z`, `+06:00`, `+0630` and fraction/time combinations accepted without shifting invoice date.
- No effects to existing `sale['Time']` legacy interpretation.
- Exact previous valid-date and year-end due-date tests still pass.

### Task 1: Timestamp suffix guard
**Files:** Modify `tests/m06-invoice-calendar-date-integrity.test.mjs`; modify `src/modules/sale-invoice-read-model.js`.

**Interface:** Existing `projectPostedSaleInvoice(invoiceId,snapshot)` stays unchanged.

- [ ] Commit a test that expects impossible clock and offset values to throw `Invalid canonical posted-invoice date`, and checks valid leap-day time, UTC and +HHMM offset.
- [ ] Watch GitHub Foundation Node test fail specifically `Missing expected exception` for a bad timestamp; all other unrelated tests should pass.
- [ ] Add one limited bounds check within `dateOnly` after existing date validation.
- [ ] Commit GREEN and verify exact-head Foundation, timezone source oracle and relevant Workerd/Cloudflare workflows.
- [ ] Open or update owner-review draft PR with links to RED and GREEN job results; no merge.
