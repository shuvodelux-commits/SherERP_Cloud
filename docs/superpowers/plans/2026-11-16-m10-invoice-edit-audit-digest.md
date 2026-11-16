## CI dependency verification (2026-11-16)

- The first M10-08 exact-head run passed its own Foundation and local D1 parity gates, but the unrelated M07 read-only adapter suite failed in the *unchanged* unpaid-purchase fixture. The required source guard rejects an input paymentMethod of `''`, and the durable ledger method is intended to be `''` **only after** a zero-paid Cash request is normalized.
- Reviewed M07 PR #390 (`fix/m07-unpaid-purchase-tender-test-a01`) has 21/21 green checks and provides a proper test-only fix; PR #387 is a redundant competing fix and is not merged.
- Temporarily stack M10-08 PR #391 onto #390's branch to test the exact combined merge via GitHub Actions without copying M07 files into this M10 branch. Keep this PR draft, verify green exact-merge CI, then restore `main` as its base **after #390 is owner-merged** and recheck before owner merges #391.
- Never modify source data, public Workerd bindings or production D1 to resolve CI fixture problems.

# M10-08 — Invoice edit audit original source-ID parity plan

> Required Superpowers workflow: tests RED with GitHub Actions evidence → minimal GREEN implementation → complete exact-head CI → draft owner PR; avoid direct main commits/auto-merge.

**Goal:** independently compare source and actual persisted local D1 `INVOICE_EDIT_LOG` rows and original Log IDs without changing immutable audit history or posting financial events.

**Files:** new `src/migration/m10-invoice-edit-audit-digest.js`; new `tests/m10-invoice-edit-audit-digest.test.mjs`; new `tests/integration/m10-invoice-edit-audit-digest-workerd.spec.mjs`; new `.github/workflows/m10-invoice-edit-audit-local-d1.yml`; this plan and companion spec. Do not edit shared M10-07 workflow while #374 is open.

## Task 1 — RED test-first
- Add unit test independently hashing exact fields and 49-group pinned mapping, checking original source Log IDs, zero-preserving original text money values, exact source JSON and whitespace, Date conversion, duplicate IDs/symbol/getter rejection, missing source rows, and no unapproved live source access.
- Add real local Workerd/D1 test using `wrangler.m02-invoice-edit-audit-test.jsonc` and existing M02 offline importer; separately SQL SELECT persisted original 12 columns; compare independent summaries, verify D1 audit UPDATE/DELETE triggers and replay reject; content versus original-ID drift via readback *copies*.
- Add PR-only local D1 workflow with Node 22, `npm ci`, `wrangler@4.161.0` and new integration test, plus pure unit test. Commit and open draft PR.
- Verify RED job failure because source digest helper does not yet exist. Record evidence.

## Task 2 — minimal GREEN
- Add pure `summarizeM10InvoiceEditAudit`, relying on reviewed M02 preflight and mapping; fixed redacted error and canonical `M10-ROW-v1` / `M10-ID-v1` SHA-256. No SQL writes, schema, public RPC or UI.
- Verify focused Workerd/D1 and unit tests and full Foundation `npm test` on exact commit with GitHub logs. Correct unexpected errors using root-cause evidence.
- Review changed files, check conflicts/overlap against latest main, update PR evidence and limitations.

## Task 3 — owner review
- Leave draft unmerged, track #312. M10-07 #374 and M07 duplicate #387/#390 remain separate and must be reconciled by owners, not conflated. No private live Sheets, source GAS or remote D1 used.
