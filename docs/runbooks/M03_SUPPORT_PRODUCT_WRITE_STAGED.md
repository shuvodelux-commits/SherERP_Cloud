# M03 Support Edit: real Product write adapter (staged, not live)

This PR is the first business-write slice after merged PR #853 and the approved
Control D1-only `0002_support_write_authority.sql` migration. The Control D1
migration was backed up, restore-tested and applied to
`shererp-admin-control-v2` on 21 Nov 2026. Control D1 retains the pre-existing
Shop binding and old READ grants. The new tables were verified empty.

## Implementation: reuse the Owner Product contract

`src/db/m03-support-product-create.js` reuses the original validated
`validateOwnerProductDraft` and existing `owner_product_create_receipts`
trigger. No competing Product master, ledger or stock algorithm is created.
It supports **only creation of Standard Products with zero opening stock**,
not modifications, purchases, stock adjustments, POS, returns, or finance.

Steps inside one server-controlled operation:

1. Require both **default-OFF** flags `M03_SUPPORT_WRITE_ENABLED=true`
   and `M03_SUPPORT_PRODUCT_WRITES_ENABLED=true`.
2. Verify the **current Super Admin Control D1 session** and the exact
   immutable Shop D1 physical identity; derive `support:<Google subject>`
   only from that verified session, never from browser input.
3. Normalize the Product using the original Owner Product validation and
   compute its existing versioned canonical intent fingerprint.
4. Reuse `authorizeSupportWriteIntent` from PR #853. It must find a currently
   authorized scope=`products` with a prior fresh MFA Support Edit grant
   bound to the existing five-minute Support READ session.
5. Recheck the active Control D1 session, provisioned ready Shop binding,
   physical D1 tuple, exact action, actor, intent ID, fingerprint and expiry.
6. Insert a **single immutable, operation-specific Shop D1 Product permit**
   with its exact Shop tuple, actor, receipt ID, normalized Product name,
   byte-for-byte JSON payload, canonical fingerprint and expiry no later
   than the Control D1 Support Edit grant.
7. Insert into the EXISTING Owner Product receipt table with actor
   `support:<subject>`. An independent Shop D1 BEFORE INSERT trigger
   rejects any support-origin receipt unless it has the exact matching
   unexpired Product permit. Existing receipt-after-insert logic creates
   the Product. Duplicate ID/name and non-clean source guards still apply.
8. After a confirmed Shop D1 receipt, append a Control D1 `RESULT` audit
   event tied to the approved intent. Retry with an identical operation
   ID is read/replay only. If a cross-D1 audit uncertainty occurs,
   return `needs-review` rather than claiming a confirmed success
   or creating a different Product ID.

The original Owner `createOwnerProduct` and its Owner session grant remain
unmodified except exporting its **pure Product validator** for reuse.
No Owner session/cookie or fake Owner subject is issued to Support.

## Staged Shop D1 migration and release blockers

The new **Shop D1-only** migration
`staging-migrations/shop-owner-write/0013_support_product_permit.sql`
creates `shop_support_product_permits` and 3 triggers (immutable approval,
Shop D1 SQL-time exact support receipt guard). It is NOT applied to any
live Shop D1, because the deployed Owner/Admin release has a pinned
13-migration original baseline plus a reviewed M08 Supplier/Cash and first-day Cash opening overlay.

**DO NOT execute 0013 on production merely because this PR merges.**
The filename was renumbered from staged `0012_support_product_permit.sql`
because first-day Cash opening already occupies Shop D1 migration 0012.
Shop D1 migration 0013 is ordered *after* exact pinned 0010+0011 Supplier
Cash and 0012 first-day Cash. The verifier accepts only those prior approved
profiles or their complete 0013 composition with all four new SQL objects
pinned by SHA-256 of SQLite-stored definitions. This is Shop D1 only;
**Control D1 hosted journal migration 0012 is unrelated and already applied.**

The verifier extension is code-level preparation, not permission to activate
Support writes. Coordinated Owner/Admin release, backup and restore evidence,
in-flight revocation safety and independent approvals remain mandatory.

Explicit follow-ups, before production Support Product WRITE:

- Approve one exact pinned **Support Product schema overlay** and ensure
  both the Admin and Owner release can verify it without weakening their
  immutable original migration receipts or M08 cash reconciliation.
- After a protected Shop D1 backup and independently restored migration
  rehearsal, coordinate a safe Admin/Owner Worker version cutover.
- Add a strict private, CSRF/origin-protected Admin HTTP route and UI for
  fresh per-module MFA, support reason, submit and confirmation; no Owner
  impersonation or form writes to the read-only Support ERP.
- Ensure the Shop D1 has a revocation/fence policy for **in-flight** writes.
  Control D1 and Shop D1 cannot be atomically committed together; a
  revocation race between the Control authorization and Shop SQL mutation
  needs explicit replay/rollback and result-reconciliation signoff.
- Surface immutable Support actor/action/result receipts to the Shop
  Owner and Admin auditor. The current basic Shop Activity Log displays
  product receipt activity but is **not yet a complete Support Edit audit UI**.
- Add real two-Shop integration tests for HTTP route, expiry/revocation
  between Control and Shop D1, concurrent calls, duplicate intent, failed
  Shop trigger, Control audit outage, and cross-tenant D1 swaps.
- Keep Purchases/POS/Returns/Finance out of this slice; their original
  atomic cash-session, inventory, party due and ledger rules require
  separate M08 financial signoff.

## TDD and nondeployment evidence

RED: test imported nonexistent `m03-support-product-create.js`.
GREEN: local isolated Workerd tests with genuine separate Shop A/Shop B D1,
current Super Admin MFA/Support READ+EDIT grants, and the real Owner Product
receipt trigger. Tests verify exact first Product ID, one Support audit,
idempotent retry, wrong Shop rejection, changed payload refusal, nonzero
opening stock refusal, direct Support SQL without permit rejection,
End Support revocation and unchanged original Owner Product creation.

No live `admin` or `shererp` deployment, no Shop D1 migration,
no plaintext Google/TOTP credentials, no production business writes,
and no support write API/flag are part of this PR. A merged PR does
not itself enable Support Product edits.
