# Superpowers RED→GREEN — M06 original sale unit snapshot audit

**Issue #314, board #456.** Owner approved next independent M06 preparation. **Base:** 1f068fc3c30c625446c560364fb872ae68cb8bc1. **File ownership:** new `src/modules/m06-sale-checkout-snapshot-audit.js` and `tests/m06-sale-checkout-snapshot-audit.test.mjs`, plus two M06-specific docs, exclusively. No shared integrator files.

1. Reuse merged #468 `planMultiUnitPosCheckoutPreview` fixture: 1 Bag+2 Box+5 Pcs (145 Pcs, ৳1,340) plus legacy 2 Feet (৳60), discount ৳15, Grand ৳1,385, Bank ৳500+Mobile ৳285+Cash ৳600 applied with ৳50 returned Cash change.
2. Write test-only new M06 audit import and automated RED tests expecting `ready:true` for this source valid preview despite effective base price 9.24*145 != 1340; verify no current conversion/product records are consulted.
3. Tamper individual immutable components, price identity, duplicated conversion IDs, base quantity, FIFO coverage, source line amount, checkout discount, paid/due, payment row/change. Assert deterministic codes and zero mutation. Legacy no-unit data must remain valid. Reject accessors and malformed row shapes.
4. Commit tests **before** implementing the missing function; verify actual GitHub Node RED job if possible. When CI auto-cancels, record direct evidence distinctly and do not misstate it.
5. GREEN: create one pure M06 `auditMixedUnitSaleCheckoutSnapshot(preview)` function, use frozen `salePaymentPaisa_` for exact cents, accumulation safety, and component rounding allowance. Do not recompute current prices/quantities or use any D1/SQL/posting helper.
6. Run full current-head Github Node tests, source Oracle, real local Workerd/D1, Chromium QA and Cloudflare no-secrets PR safety. Any failed required check blocks merge until resolved by its file owner.
7. Keep one draft PR against main, include this spec, actual RED/GREEN evidence, risk/rollback, exact affected files and dependency/merge sequence. Owner review and all-green current-head CI required to merge. Production sale posting remains blocked by M02/M03/M04/M05 interfaces.

**Interface impact:** no RPC, SQL table, data migration, actor/tenant/session authorization, public frontend or invoice/stock issuance. **Rollback:** revert this self-contained M06 audit; no data undo required.
