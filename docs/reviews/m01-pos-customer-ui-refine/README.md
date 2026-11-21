# M01 POS Customer `[+]` — D1-aware HisabIQ visual refinement

**Baseline/reference lock:** `shuvodelux-commits/hisabiq_ui@e42a00a` `src/components/pos/CustomerPicker.tsx`, existing HisabIQ `Pos.tsx`/CheckoutPanel, user-annotated POS markers #1, #2 and #3. The approved goal is a compact, keyboard/touch-friendly Name+Phone Quick Add without changing the cart, source ledger or original Customer form handlers. Source is never edited.

**Requested skill:** `/ui-refine-loop` was not present in the connected skill catalogue or local user Codex/Agent skill directories. This PR therefore uses the *same bounded workflow manually*: screenshot current reference/production adapter → identify a specific UI/UX defect → RED Playwright acceptance → minimal edit → GREEN with responsive screenshots → bounded visual check. Do not claim that absent skill was executed.

## Production D1 diagnostic — read only

- 2026-11-21, authorized Cloudflare Wrangler OAuth on user machine: `wrangler d1 list` showed production `shererp-shop-001`.
- Read-only SQL `wrangler d1 execute shererp-shop-001 --remote --command "SELECT name FROM sqlite_schema WHERE type='table' AND name IN (...)"` returned `success:true`, `rows_written:0`. Existing production tables: `shop_identity`, `parties`, `party_roles`, `shop_owner_write_grant`, `owner_mvp_sale_receipts`.
- Crucial **NOT present** on that production Shop D1: `owner_customer_master`, `owner_customer_create_receipts` from merged M03 migration `0015_owner_customer_master.sql`. No remote migration applied here.
- Unauthenticated live endpoint checks: `/app` redirects (302), `/api/owner/pos/bootstrap` requires auth (401), and `/api/owner/customers` is not exposed (404). **These requests cannot prove the deployed Worker-to-Shop binding**; they do show why a live Customer `[+]` must not falsely promise Save. A distinct authorized production rollout with a backup, Shop identity/binding check, signed session and verified read/write is required before activation.

## Bounded UI/UX loop

1. **Found:** the original POS `[+]` always opened the Customer form, even if the private Customer API returned HTTP 404 because production migration/flag had not been enabled. **Fixed:** an authenticated, no-store, read-only GET checks the current Shop Customer directory at click time; 404/403/401/503/network failure show an accessible inline explanation and do not open the unusable form, mutate the cart or POST. Loading disables duplicate activation, then restores the button. No D1 connection or new permission is fabricated.
2. **Found:** the original Customer Add modal displayed historical Opening Balance (Due/Credit) during POS Quick Add, although M03 requires a zero-opening Customer. **Fixed:** the original field stays present but set to zero/disabled and hidden only while entered from POS. Fast path shows **Name → Phone**; Guardian/Address/Notes are behind the accessible **More details** disclosure. Source Customer page still owns the same modal and event handlers. Cancel returns keyboard focus to `[+]`, and the additional styling is removed on close.
3. **Second screenshot review found:** the optional Guardian input disappeared while its label remained on mobile. A failing Playwright check caught the orphan label, then the entire source form row was collapsed. The original relation select, notes and address are accessible through More details.

## Browser evidence

- `images/390-unavailable-customer.png` — mobile inline D1 unavailable state, no unusable modal.
- `images/390-ready-modal.png` — touch-phone Name+Phone first, optional details toggle, Save remains visible.
- `images/1440-ready-modal.png` — desktop modal over the pinned HisabIQ POS layout.
- Explicit RED→GREEN Playwright assertions cover D1 404, no POST/cart reset, exact 200 data response, zero opening hidden, name focus, optional field/label collapse and disclosure, focus return, and 320/390 viewport geometry.
- Original responsive 320/390/768/1024/1440 POS markers, stock/cart/amount/payment gate, keyboard/drag, original POS invoice and Cash Return tests remain required CI gates.

## Boundaries and rollout

Changed code **only** M01 DOM enhancement `src/ui/hisabiq-pos.js`, its local stylesheet and browser QA/screenshots. No `src/db`, Worker, D1 schema, grant, flag, financial posting, role permissions or original `legacy/source` changes. The safety query is private and authenticated, and cannot grant permission. When the Customer API is truly ready, the same existing modal remains available. Registered-customer Sale, full-paid anonymous guest Sale, Store Credit refund, split payments and mixed-unit posting remain separate backend transactions and stay gated; UI refinement does not claim them.
