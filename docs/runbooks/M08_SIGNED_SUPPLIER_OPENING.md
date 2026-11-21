# Signed Supplier historical opening — migration candidate (issue #852)

**Status:** candidate source/SQL/Workerd only; **not deployed**. Depends
on first-day D1 overlay PR #857 (migration 0012), with all prior
0010/0011 Supplier Cash tables already installed in the first Shop.

## Gross accounting and direction

- **Positive** Supplier opening, e.g. +৳500.25, represents **payable**:
  the business owes the Supplier. The immutable opening checkpoint
  increases the one authoritative `owner_supplier_master.current_due_paisa`
  via a single SQL-time trigger. Subsequent Purchase amounts add to payable
  and authorized Supplier Cash Pay reduces payable.
- **Negative** Supplier opening, e.g. -৳250.50, represents a distinct
  **Supplier Advance/Receivable**. It is recorded separately from Supplier
  payable and does **not** automatically net or reduce future purchases.
- Signed historical opening is a **baseline**, not a Purchase, today's
  Cash In/Out, bank transfer, Owner contribution, lender loan or expense.
  No Cash Session is required to create it. No implicit Customer, Vendor,
  Owner, Lender, Borrower or Payee role settlement is permitted.
- The original `owner_supplier_master.opening_paisa=0` invariant stays
  unchanged (historical 0005 contract). Signed opening comes from the
  new `owner_supplier_opening_checkpoints` immutable table, with
  Supplier ID, operation ID, actor, exact paisa amount, Bangladesh date
  and recorded timestamp. The source ID issuer is unchanged.
- The Supplier read model exposes **Opening Balance** (signed),
  **Opening Payable**, **Supplier Advance** and **Current Due** (payable),
  while the ledger includes the positive historical opening as its own
  immutable line; a negative advance is disclosed separately, never
  included as a misleading credit against payable.

## API and compatibility

The existing `POST /api/owner/suppliers` can accept signed `openingBalance`
after migration 0013 is installed, atomically with the Supplier creation
receipt/Party role (no duplicate source ID). It rejects a nonzero opening
without that schema, preserving the current zero-only mode.

For a Supplier **created before 0013**, `POST
/api/owner/suppliers/:supplierId/opening` accepts exactly
`{"operationId":"<UUID-v4>","openingBalance":"-80.25"}`.
The operation is authenticated to a current Owner and Shop D1 write
grant, idempotent and SQL-time guarded. It is allowed exactly once for
a current Supplier with zero previously posted financial activity.
Duplicate, different, cross-Shop, expired grants and Supplier records
with Purchase/payment history must be rejected. Existing posted
history must never be retroactively netted or silently edited.

A new Supplier created with a zero opening has **no financial checkpoint**;
the one-time explicit opening endpoint may be used later while the Supplier
still has no Purchase or payment activity. The idempotent replay of a
legacy Supplier creation must never silently create a zero checkpoint
and consume the old Supplier's chance to record its actual historical
opening. Once a nonzero checkpoint is recorded, it is immutable; any later
change requires a separately approved adjustment instead of overwrite.
The UI must distinguish an unset opening from an immutable recorded opening.

## Database migration authorization gate

The physical first-Shop D1 currently has **one Supplier**, zero opening
balances, and other core data. **Do not execute 0013 on production** until
PR #857 has been independently reviewed/merged, its 0012 migration
installed safely, and this PR passes independent security/accounting
review and a full encrypted export/restore/foreign-key/integrity
rehearsal. Original 13 Shop receipts and exact 0010+0011+0012 schema
pins must be verified. Migration 0013 adds only the five explicitly
SHA-256 pinned SQL schema objects: checkpoint table, clean-history
guard, payable posting trigger, immutable UPDATE trigger and immutable
DELETE trigger. Unknown schema objects are denied.

Do not re-run older migrations, mutate existing Supplier or Cash
records, fabricate Cash/Bank source rows, change Worker flags, or use
a second manual Worker deploy while Cloudflare Builds publishes
production.

## Test evidence

- Real D1 signed +500.25 payable and -250.50 advance, independent
  gross positions and a zero Cash Book.
- Replayed create/one-time opening, signed limits, precision and
  immutable no-update/no-delete.
- Strict source/role/Shop SQL grants, no Purchase/payment restatement,
  legacy schema fail-closed and full Supplier payable ledger check.
- Hosted first-Shop baseline 13 receipts and approved 0010+0011+0012
  schema remain exact; new 0013 pin verifies and modified opening-post
  SQL is denied.

**Frontend coordination:** M01 HisabIQ Party PR #854 owns its UI;
this backend PR changes **no Party page/component**. A follow-up UI
should show both gross Supplier balances and a one-time opening action,
without exposing an adjustment when posted money already exists.
