# M03 MVP — Supplier master end-to-end first vertical slice

**Purpose:** Restore a working original Supplier Quick Add and list in the private Owner ERP, as the first prerequisite for the real Purchase → POS → Return business workflow. Owner explicitly prioritized functioning ERP over optional Support, analytics, further dashboard decoration, or theoretical isolated proofs.

**Base:** `main@b94f617045749256b3f410facc7ed59860798d04`; latest merged upstream incorporated at `75bc5eda354f47421ec4992b61437897e1c63e05`. **Source truth:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Parallel boundary #456 comment 7037014227. PR #791.

## Source-faithful contract

Original `Suppliers.gs::addSupplier` accepts a new Supplier name, phone, address, notes, and optional signed opening balance. Its active-name duplicate check is case-insensitive, and it allocates `SUP-...` IDs. Original `suppliers.html` calls `getSuppliersBootstrap` and `addSupplier` via `serverCall`. This first clean-business migration preserves the original frontend and those call sites, but explicitly limits **opening balance to zero** rather than silently create a nonzero historical balance without the Supplier Ledger and Cash opening journal. After Supplier/Party finance migration, implement correct approved gross opening accounting rather than injecting a fabricated zero or a fake balance. No bank account or ledger is simulated.

## TDD and smallest GREEN

1. Real Workerd/D1 RED test imports missing Supplier repository and migration on two Shop databases, checks source IDs, SQL grant lease, replay/intent, original bootstrap fields and nonzero-opening denial. Test-only checkpoint `2ee6908f` was committed before implementation; a hosted observed failing RED run is not established because Actions superseded earlier jobs. Do not falsely claim observed RED.
2. GREEN: additive checksum-pinned `migrations/0002_party_identity.sql` and `staging-migrations/shop-owner-write/0005_owner_supplier_master.sql` after previous seven migrations. One receipt INSERT trigger atomically creates Party, Supplier role and Supplier master with immutable source IDs. Historical Party/legacy-link rows halt clean-shop initialization rather than guessing original ID floors.
3. Private D1 code `src/db/m03-owner-supplier-create.js` validates one operation, uses canonical intent hash, checks current Shop ID/database/marker and token hash with unexpired SQL-time Owner grant, and distinguishes create/replay, conflict, denied and unavailable. No shared financial posting kernel or public Worker changed.
4. Once parallel #788 Owner Support UI finished merging, add Owner-only Supplier GET/POST to the existing `src/m03-owner-redemption-worker.js`. Reuse clean-Products feature gate; fail closed when disabled or unprovisioned. The Owner UI `scripts/build-owner-frontend.mjs` dispatches **existing** `getSuppliersBootstrap` and `addSupplier` calls to these routes, with retry-stable operation ID.
5. Test local Workerd 2-Shop HTTP and DB, source-shaped supplier list and original Chromium Supplier screen; preserve old Products, login, print and mobile UI. Re-run full exact-head CI and treat Cloudflare Builds separately.

## Deliberate limits

This is **not yet the working ERP MVP**. No D1 purchase header/lines, operational lot/FIFO inventory postings, sale/POS payment, customer/supplier ledgers, return/refund, Cash Session payment, printable persisted invoice or hosted shop provisioning is delivered by this Supplier slice. Purchase source work (#793), POS source intent (#792), and the shared M03 transaction kernel remain independent. Do not turn on financial routes, remote D1 migrations, customer imports, or public preview D1 access. First finish the audited operational Product→Supplier→Purchase→POS→Return→Ledger flow on physical Shop D1, then test original UI and production restore before M11 GO.

## Rollback and review

Code revert removes the new private APIs and frontend bridge; the appended Shop migration must **not** be automatically rolled back on a live database or have its receipts truncated. There are no actual remote resources involved. Reserve all cross-module financial D1/schema files to one M03 integrator, and require security review, exact-head CI, explicit owner merge approval, staged migration rollback plan, and M10/M11 signoff for deployment.
