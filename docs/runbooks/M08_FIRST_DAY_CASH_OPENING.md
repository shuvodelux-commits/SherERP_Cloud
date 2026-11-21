# M08 first-day Cash Session opening — D1 candidate (issue #851)

Status: **code + offline Workerd/D1 only; NOT deployed to production**.

## Current behavior and accounting boundary

The existing first-Shop schema (0006) fixes `opening_paisa=0`. The
additive 0009 migration introduced `carried_opening_paisa` as a
nonnegative, immutable physical drawer carry. Its original
`owner_mvp_cash_open_carry_guard` requires a first-ever Cash Session
to start at zero. This rejected an Owner's physical drawer amount.

**Migration `0012_owner_first_day_cash_opening.sql`** does not rebuild
the Cash Session table, rewrite any receipt, remove the existing
Close Day check, or create any Cash Book transaction. It changes exactly
one existing trigger: **only when no Cash Session row exists** may the
very first `carried_opening_paisa` be the Owner's measured physical
cash. All subsequent Start Days must still equal the last durable
counted Close Day. A separate `owner_mvp_cash_session_no_delete`
trigger protects past session existence and the first-day gate.

The first-day value is a **drawer opening baseline**, never a new Cash
In, Party historical opening, owner contribution, lender loan or a Bank
transfer. The original `opening_paisa` column remains zero as required
by the historical `CHECK(opening_paisa=0)`. Live Cash Session read,
Cash Session counted reconciliation, POS, Return and Supplier Pay
cash guards already include `carried_opening_paisa`.

## Strict additive-schema compatibility

The original 13 migration receipts and the previously reviewed
0010+0011 Supplier Cash overlay are unchanged. The host's read-only
schema verifier recognizes only two approved overlay profiles:
0010+0011, and exactly 0010+0011+0012. The latter additionally pins
the changed `owner_mvp_cash_open_carry_guard` and new
`owner_mvp_cash_session_no_delete` by **SHA-256 of SQLite-stored
`sqlite_schema.sql`**, not by loose text matching. Any extra or
modified table, index or trigger remains rejected.

Do **not** apply 0012 against the real `shererp-shop-001` until
GitHub CI, independent code/security review, current remote D1
read-only preflight, encrypted private export, offline restore/integrity
rehearsal, and a separately authorized single-database release are
complete. Do not re-run 0010/0011 or the Control D1 grant migrations.

## Existing open zero-valued Session

On 2026-11-21 the first Shop already has an **Open** Cash Session
with physical starting balance zero. 0012 does **not** mutate or
retroactively restate it. Do not update its immutable opening columns
directly or invent a Cash In transaction to fill the opening.
A separate, uniquely authorized **append-only correction/reconciliation**
must be reviewed for an already-open Session, including a no-postings
check, fresh Owner grant, immutable intent receipt and exact cash/ledger
reconciliation. Until then, the existing session remains unchanged;
normal counted Close Day and subsequent carry preserve the audit trail.

## Evidence & tests

- Real Workerd/D1: first physical 125.75 accepted; opening 125.75,
  Cash In 0, Cash Out 0, no Cash Book entry.
- Two physical Shops isolated; no duplicate initial source ID.
- Negative/fractional money rejected. Same operation ID replays.
- After counted close at 190.10, new opening 200.25 rejected and
  190.10 accepted; no reset.
- Legacy pre-0012 SQL still rejects first nonzero opening.
- Hosted prebound verifier must accept exact 0012 and reject modified
  opening triggers/unknown schema while preserving 13 receipts.
