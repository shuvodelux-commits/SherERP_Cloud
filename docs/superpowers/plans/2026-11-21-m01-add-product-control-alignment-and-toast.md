# M01 Add Product: equal visible controls and truthful Owner feedback

Reference: approved `docs/design-system/HISABIQ_SHERERP.md`, pinned `hisabiq_ui` Add Product unit equation. Branch only changes the Owner Add Product compiled CSS, Owner fallback error copy and its Playwright regression. No frozen `legacy/source/**`, D1 schema, product writes, session policy, stock logic, or other forms change.

1. The annotated 390px screenshot was captured by synthetic `qa/m01-hisabiq-add-product-unit-editor.spec.mjs`: its Owner shell is nonposting and background unrelated functions still reject, so a transient toast did not establish an actual live-Shop D1 outage. Do not suppress a genuine server/permission failure in production.
2. The Owner `serverCall` fallback is a fail-closed rejection for **unsupported function names**, not a database health check. Its generic “Shop business data is not connected yet” claim is misleading when a Shop D1 is operational. Retain the rejection while naming the unavailable **feature/action**, not the entire Shop.
3. The global toast originally anchors 20px from the viewport bottom and can cover the Add Product modal's fixed Save/Cancel footer. In the Owner Add Product view only, anchor it above the modal footer without changing which errors are displayed.
4. The source's `touch-select-trigger` generates visible buttons from `<select>`. Its 44px mobile minimum overrides the new numeric input's 36px geometry. Style the **visible trigger**, the original Add Product's native inputs, and custom unit inputs to the approved 36px height and 6px radius.
5. The packed equation uses unequal `1.4fr/1fr` form tracks, which makes dropdown and quantity fields inconsistent on desktop. Give the two editable fields equal 1fr tracks and align their top/bottom edges, preserving readonly numbers and unit suffixes. Keep opening/price rows equal and responsive.
6. Do not erase D1 unavailable notices, authorize multi-unit Save, mask failed RPCs, or claim a real cloud connection. Keep the existing authentic D1 Save guard unchanged. Keep screenshot fixture's transient toast observable in DOM but **wait for its normal 3.2s expiration before capturing the illustrated form**.
7. RED: Playwright 390px/1440px checks for visible enhanced picker and input height=36px, top/bottom alignment, equal widths, Owner function rejection wording and non-overlapping error toast.
8. GREEN: one CSS scope and one fallback rejection-message change; extend existing Playwright screenshot helper for deterministic, truthful visual evidence. Retain old regression behavior and source manifest.
9. Verify 320/390/768/1024/1440 touch and pointer widths, modal scroll, price selectors, keyboard select interactions, Bundle safety, no D1 write and saved single-unit baseline; attach before/after images under a new scoped review path.
10. GitHub PR only; no automatic deploy or production cutover. `/ui-refine-skill` launcher is unavailable here: use pinned source + Playwright screenshots with bounded visual inspection, accurately mark the specific gate unverified.

## Current TDD / QA status

- RED observed: 320px Product Name was 46px vs requested 36px, visible Manage Unit action 44px, and unsupported Owner RPC blanket Shop-data message.
- GREEN: 41/41 focused Owner Add Product, M05 unit conversion and actual local Workerd/D1 single-unit Save test cases pass. Five-breakpoint Playwright evidence and scoped UI review under `docs/reviews/m01-add-product-controls`.
- Full M01 Chromium regression completed on candidate `83d36bcf`: **181/181 passed**, zero failures. Remote GitHub CI and live hosted D1 connectivity remain separate gates. No production D1 connection or multi-unit Save was asserted.
