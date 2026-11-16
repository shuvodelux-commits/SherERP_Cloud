# M06 — Saved Drafts list must fail closed on duplicate draft identifiers

## Source and decision
The frozen source is `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `DraftSales.gs::getSalesDraftList` and `getSalesDraft`. Existing target `src/modules/sale-draft-detail.js::projectSaleDraftDetail` already rejects two rows with the same exact Draft ID before revealing owner data. The target `src/modules/sale-draft-list.js::projectSaleDraftList` instead lists each row under its Draft ID. For imported D1 data with two rows sharing the same Draft ID—particularly one draft owned by Staff A and another by Staff B—the list shows an apparently valid selectable draft, while the lookup/update path may choose a different row. This is an identity and ownership ambiguity, not an invitation to merge two rows.

**Decision:** The list must reject any repeated, nonempty exact Draft ID across the **trusted tenant-scoped input rows** *before* filtering the list by actor ownership. This ensures a staff-scoped query cannot hide a collision against a draft belonging to a different staff member. Throw the deterministic `NEEDS_REVIEW: duplicate Sales Draft ID in tenant snapshot`; do not silently select one row or reassign ownership. Preserve original source parity for unique IDs: authorization, owner/manager visibility, updated timestamp sort, money/display fields, and no leaked item/payment JSON. Do not infer identity from Draft No, Customer ID, phone, name, or timestamps.

Only the pure read-only list projection and its tests change. The original GAS source, saved business data, D1 schema/production database, Worker RPC/auth, draft posting/delete mutation, Cash/Bank/Party ledger, and the preserved UI remain untouched. Distinct Draft IDs remain independently selectable even when Draft No or Customer Phone is identical. There is no new actor permission; M03/M04 must still supply tenant-scoped rows and authenticated actor `manageAll` capability.

## Superpowers acceptance
1. Commit RED test(s) before implementation: two rows sharing a Draft ID are currently listed instead of rejected, including cross-staff collisions which are hidden by owner-only filtering.
2. Verify intended missing exception on the exact prior source through GitHub Actions, not merely anticipated failure.
3. Implement minimal detection in `projectSaleDraftList` before the owner filter; no abstract repository and no write.
4. Exact-head Foundation/Node, isolated local Workerd/D1, browser and Cloudflare safety checks all pass before merge.
5. Leave draft PR for owner review. Distinguish this source-divergent safety guard for **corrupted imported IDs** from valid unique-ID frozen-source parity. This does not establish a live production POS/draft writer.
