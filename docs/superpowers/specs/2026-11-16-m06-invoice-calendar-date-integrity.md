# M06 — Reprinted invoice rejects impossible canonical calendar dates

**Intent:** Avoid displaying a fabricated invoice/due date when an imported D1 sale record has a syntactically ISO-like but impossible date, such as `2026-02-31` or `2026-13-01`. This is data-integrity rejection for the future trusted D1 read projection, not a change to the frozen Google Apps Script source.

**Sources:** SherERP Cloud `AGENTS.md`, `docs/WORKSTREAMS.md` M06, `src/modules/sale-invoice-read-model.js`, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `Invoice.gs`. Apps Script stored sheet Dates; D1 import must enforce calendar correctness rather than allowing JavaScript Date normalization to invent a due date.

## Behavior
- A canonical yyyy-mm-dd or yyyy-mm-ddThh:mm:ss value must represent a real Gregorian calendar day before any invoice payload is returned. 2024-02-29 is valid; 2026-02-29, 2026-02-31, 2026-13-01 and 2026-00-10 are invalid.
- Reject malformed or impossible dates with an explicit `Invalid canonical posted-invoice date` error. No invoice body should be returned for a corrupted date.
- Preserve exact current source parity for **valid** input, including Asia/Dhaka due-date formatting, no-terms blank date, historical paid amount and print fields. Do not alter trusted D1 query contracts or unrelated source modules.
- Ensure date and due-date calculations cannot silently roll the date into a different month/year.
- No source GAS/HTML, production DB migrations, auth/RPC or financial posting change.

## Approaches
1. Chosen: validate the Gregorian date components at the `dateOnly` trusted-snapshot boundary with a UTC calendar round-trip, then preserve the existing due-date implementation. Smallest fail-closed change.
2. Validate only in the future D1 importer: leaves the read model vulnerable to drift and hand-crafted corrupted records.
3. Broader date utility refactor: unnecessary and risks regressions across M08/M09.

## Acceptance
- Dedicated RED test proves an impossible imported invoice date currently produces a date/due-date without rejection.
- GREEN rejects impossible month/day/leap-day cases while accepting leap-day 2024-02-29 and preserving an exact valid due-date rollover.
- Existing M06 invoice source-parity and timezone tests stay green.
- Github CI must pass on exact HEAD; draft PR only until verification.
