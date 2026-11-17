# M01 / issue #25 — Original POS V2 keyboard and no-match search Playwright regression

**Base `main`:** `1f7f3e6379030b0866e9295acbbf45e43f653138`, after full-CI merges #494 and #476.  
**Coordination:** `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, board #456, module issue #25.  
**Frozen original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, no legacy source change.  
**Owner / paths:** M01 test-only `qa/m01-landscape.spec.mjs` plus this M01-only plan.  
**Read/write scope:** synthetic browser only, local loopback fake login and synthetic shop shell; no database, public business RPC, posting or cash-session writes.  
**Dependencies:** merged M01 #476 and compiled CSS fix #494; no active cross-lane file owners.  
**Merge order:** own PR to main after exact-head mandatory Playwright + all repository CI, review and conflict check.

## Approved independent QA overview (12 sentences)

1. Preserve the existing POS V2 frontend, DOM handlers, mobile tabs, product search and source route without editing any production code.
2. The earlier M01 Playwright suite verified that the source POS V2 route and touch workflow tabs work at phone/tablet/desktop widths.
3. This incremental regression covers real **keyboard** activation of those tabs rather than repeating touch tests.
4. Use a synthetic POS-only Clerk in the original compiled UI with inert public Worker business methods.
5. Launch actual Chromium on a small touch phone and a desktop keyboard viewport, retaining the original font and UI.
6. On mobile, focus each original Cart/Customer/Payment button and press Enter, checking the source's active tab state and ARIA selection.
7. On both viewports, focus the original product-search input and type a unique no-match string.
8. Press ArrowDown, ArrowUp and Enter to ensure the original search code does not fabricate a product or add a cart line.
9. Press Escape and verify that the original search text clears without changing route or creating a sale.
10. Verify that a direct denied Bank navigation still returns the user to Dashboard.
11. Save reviewable non-sensitive screenshots and verify no checkout/posting RPC was invoked.
12. Keep existing original login, authentication, print and D1 integration regressions mandatory alongside this new Playwright case.
13. If the source exhibits a real defect, retain the failing browser evidence and create a separately reviewed integration issue instead of weakening the assertion or changing protected frontend code.

## Superpowers plan and gate

This is a **test-only parity increment**: the first implementation is the executable Playwright assertion itself; no artificial production-code mutation or fabricated RED is needed. Baseline TDD evidence for fixed UI permission visibility already exists in #476/#494, while this new regression is expected GREEN if behavior matches frozen source. The check uses actual keyboard events, not mocked DOM state. All exact-head M01 Chromium, source/build, Cloudflare preview safety and all Workerd/D1 workflows must pass before merge. Rollback is a test/docs-only revert, with no production-state change.
