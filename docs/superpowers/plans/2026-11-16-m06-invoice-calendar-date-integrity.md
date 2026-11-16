# M06 Gregorian invoice-date validation — Superpowers TDD plan

> **For agentic workers:** use Superpowers TDD; implement test first on a dedicated GitHub branch, prove RED, then minimally GREEN. Owner review before merge.

**Goal:** Do not print an invoice for a D1 record whose purported invoice date is impossible in the Gregorian calendar.

**Architecture:** Retain source-format guard in `src/modules/sale-invoice-read-model.js::dateOnly`; add a strict calendar round-trip using UTC parts before returning the date. Leave formatting/time-only and due-date calculation unchanged for valid source dates.

**Spec:** `docs/superpowers/specs/2026-11-16-m06-invoice-calendar-date-integrity.md`.

**Tech stack:** Node ESM/test runner; original plain JS read model; GitHub Actions. No new dependencies.

## Global constraints
- No live D1 data, migrations, production posting or legacy source changes.
- No React/frontend redesign. No RPC registration.
- Existing timestamp forms and timezone parity unchanged for valid dates.

## Review focus
- Leap day accepted only in leap year.
- Non-existent month/day never silently normalized.
- Real year-end and leap-day rollover stays correctly formatted.
- Invalid timestamp suffix continues to fail as before.
- Any malformed date refuses a payload rather than displaying zeroed/misleading dues.

### Task 1 — Trusted invoice date preflight

**Files:**
- Create: `tests/m06-invoice-calendar-date-integrity.test.mjs` (RED)
- Modify: `src/modules/sale-invoice-read-model.js` (GREEN)

**Interfaces:** `projectPostedSaleInvoice(invoiceId, snapshot)` remains unchanged.

- [ ] Write dedicated test fixture with original-shaped one-sale row, required trusted arrays/settings/shop. Assert impossible dates throw; assert valid leap day and valid due-date calculations return intended dates.
- [ ] Commit tests only; run GitHub Foundation CI and capture actual RED failing assertions.
- [ ] Add minimal UTC round-trip to `dateOnly` after existing syntactic validation.
- [ ] Commit code, run exact-head Foundation and all affected M06/timezone checks; report result.
- [ ] Open/update reviewable draft PR with RED/GREEN evidence, file inventory and production-isolation note. Do not merge.
