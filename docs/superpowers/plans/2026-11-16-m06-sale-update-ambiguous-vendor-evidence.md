# M06 — ambiguous vendor source in Sales Update Mode: test-first plan

**Source of truth:** `docs/superpowers/specs/2026-11-16-m06-sale-update-ambiguous-vendor-evidence.md`, frozen `SalesManagement.gs::getSaleForUpdate`, `src/modules/sale-update-read-model.js`.

**Goal:** Do not present an arbitrary last vendor record when source-shaped D1 snapshot has multiple active vendor rows for the same invoice/product.

**Workflow:** GitHub branch and draft PR; commit tests only, verify intended RED from a real runner, minimal GREEN implementation, full exact-head Foundation/Workerd/Cloudflare/browser checks. Never merge without owner approval. KISS.

## Task 1 — expose unsafe duplicate source evidence
Files: `tests/m06-sale-update-read-model.test.mjs` (tests), `src/modules/sale-update-read-model.js` (implementation).
- Add source-shaped test with two different active `VENDOR_SOURCING` rows for invoice `INV-010` and product `PIPE`. With valid active session and user permission, assert deterministic NEEDS_REVIEW error. The regression must fail initially because the last vendor is silently used.
- Add valid-source test where a deleted row shadows one active vendor and another active record belongs to a different product/invoice: match the frozen native oracle and preserve original customer/tender fields.
- RED: capture GitHub workflow/job logs showing `Missing expected exception` on duplicate active vendor evidence.
- GREEN: in the existing vendorByProduct map loop, refuse an already-present active product key rather than overwriting. Keep other input and output shapes identical.
- Verify exact-head Node and source fixture parity plus local Workerd/D1 and Cloudflare safety workflows. Document any failures; keep draft until all checks pass.

## Non-goals and rollback
No conversion of multi-vendor historical sales to a chosen Party, no financial write, schema, auth, transaction editor, or source data changes. Revert this scoped PR if reviewed historical schema shows distinct legitimate active sourcing needs a different data model, but do not silently collapse identities.
