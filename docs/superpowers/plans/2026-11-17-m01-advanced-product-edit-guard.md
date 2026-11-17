# M01 — Existing advanced Product Edit safety guard

**Issue:** #605 · **Parent:** merged PR #581 · **M05:** merged #566/#586 · **M03 authoritative writer:** #22 · **board:** #456.  
**Base main:** `5290a06abda5a0e42192b8bfbcc2f83e59495647`.  
**Ownership:** Only `src/ui/m01-products-preview-controller.mjs`, `qa/m01-products-preview.spec.mjs` and this plan; original `legacy/source/products.html`, shared `src/db/**`, `migrations/**`, public RPC, Worker, source data remain unchanged.  
**Release gate:** full exact-head GitHub CI and human review before merge. Actual Product D1 write integration remains blocked pending M03/M04.

## Twelve-sentence Superpowers overview

1. The existing Add/Edit Product UI preserves the frozen original business handler and only adds read-only advanced source-backed previews.
2. The original Edit Product handler loads a Product ID and its current stock, but it does not itself recognize the new multi-unit/Tiles measurement revisions.
3. Currently the enhanced modal resets the advanced selector to Single Unit whenever it opens.
4. A Product whose source row carries `M05 Stock Preview` metadata must therefore not expose the original `updateProduct` Save action.
5. This is a client-side fail-closed guard against accidental legacy edits, not a replacement for M03/M04 server-side authorization.
6. The M01 controller will identify the original editing product by its `Product ID` in the current source product collection.
7. A product with an own `M05 Stock Preview` field is treated as advanced even if the field is stale or malformed, because unsafe revision guesses must not authorize writes.
8. The Save button remains grey and disabled, and the modal explains that revision-aware editing requires the approved server workflow.
9. The legacy quantity field remains visible in Single Unit display mode so the existing stock can still be inspected.
10. Ordinary Single Unit and Bundle records without advanced source metadata keep their original editing and Save behavior.
11. A Chromium regression first proves the current unsafe enabled Save on an advanced record and then verifies the smallest corrected UI change.
12. The acceptance run includes exact combined M05 and M01 tests, local Chromium, full GitHub workflows, reviewer approval and no new production writer.

## Test-first acceptance and rollback

Chromium tests: existing advanced row, malformed-source metadata row, regular row and bundle preserve controls across modal reopen. No new `updateProduct` call; still no posting authority or client-created Product ID. Rollback is a focused M01-only UI and QA change; no migration or data reconciliation.
