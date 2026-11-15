# M06 — Saved Draft deletion preflight design

**Date:** 2026-11-15. **Frozen authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/DraftSales.gs::deleteSalesDraft`, `requireSalesDraftFeatureAccess_`, `requireSalesDraftAccess_`, `appendSalesDraftAudit_`.

## Problem and selection
Merged #116 ports draft payload preflight; #132 plans version-guarded edits; #103/#109 list/read drafts. A future authorized delete requires source-shaped ownership/version checks and immutable DELETED audit evidence, but M03 D1 writer and M04 authorized session/RPC gates remain closed. Port only a **pure planning function** `planSaleDraftDeletion(draftId, expectedVersion, reason, draftRows, trusted)`. It returns `{reply,audit,guard}` as a proposed intent; no rows are mutated.

## Source requirements
- Feature access: `pos.add OR sales.edit`. Managers with `sales.edit` may delete another owner’s draft, **even without `pos.view`**; the original requires `pos.view` only for `mode==='edit'`, not `mode==='manage'`. Owner lacking `pos.add` and `sales.edit` is denied regardless of view.
- Draft identity is exact trimmed `Draft ID`, never customer name, phone, invoice number or Party role. Missing rows cause `Draft not found.`; other owner without `sales.edit` is rejected.
- Compare original numeric `Version` to `expectedVersion` using JavaScript `Number`, before reason normalization. A stale row produces the frozen error. The **DELETED audit uses existing row Version**, not incremented version (contrasts with the UPDATED audit).
- `reason` is optional source `cleanDraftText_` (`String(value||'').trim()`) and becomes the audit Note; invoice ID is empty; audit actor and timestamp are server trusted; Created By/At and finance data remain untouched.
- Auditing before deletion is source order; future M03 must commit audit insert and guarded draft deletion **atomically** with session/tenant/owner/version checks, rejecting zero-row CAS. This planning helper does **not** prove atomicity or execute a D1 delete.
- Future boundary stricter than GAS: duplicate Draft IDs fail closed, trusted session authority/timestamp required; do not permit browser-supplied actor or permission flags. Actual M04 auth+M03 tenant filtering remain caller requirements.

## Scope
Exactly five *new files*: this spec, `docs/superpowers/plans/2026-11-15-m06-draft-delete-preflight.md`, `tests/fixtures/m06-draft-delete-oracle.mjs`, `tests/m06-draft-delete.test.mjs`, `src/modules/sale-draft-delete-plan.js`. Native source runs in isolated test VM with synthetic rows/lock/auth/audit sink. No edits to existing source/tests, UI or `src/db/**`, `src/rpc/**`, `src/auth/**`, migrations, Worker bindings, inventory, Party/finance/Cash/Bank, remote D1 or production deployment. Rollback = revert PR, no data recovery.
Acceptance: direct native-vs-port parity for owner, manager without POS view, denied roles, numeric Version, reason, audit ownership/Version, missing IDs, no mutation and explicit fail-closed duplicates. RED test-first GitHub Actions, GREEN minimal module and all exact-head CI required. `PARALLEL-MODULE-READY=false`; no public draft deletion until shared M02-P/M03/M04/M05/M06/M08 approval.
