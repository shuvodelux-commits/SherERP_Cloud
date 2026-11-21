## Summary
M01 Owner-only HisabIQ POS V2 visual/cart layout migration. This is intentionally a **partial UI parity PR** — not completion of multi-unit, split-payment or checkout backend parity.

- Source: `hisabiq_ui@e42a00a9`. Base: SherERP_Cloud@9670c5e2 (shell #860 merged).
- Restyles the actual cart/quick items/checkout through scoped compiled Owner assets; preserves original POS event handlers, product dataset, cash-session authority and source legacy files.
- Responsive 320/390/768/1024/1440, dark-color tokens, bilingual labels and compact controls.
- Screenshots and before/after review in [M01 visual evidence](docs/reviews/m01-hisabiq-pos-ui-refine/README.md). No public Worker/DB paths modified.

## TDD and checks
- RED: two isolated contract tests failed for missing Owner-only injector/design.
- GREEN: extended focused Node + live Chromium browser tests, adding real UI products, editing qty/line total and remove, source Drafts, no horizontal overflow and no sale POST.
- Source manifest 84 files verified, docs check passed, Owner HTML compiled. Existing Owner suite, real local Workerd/D1 regressions, and CI must be reviewed on the exact PR head.

## File ownership / dependencies
- **Workstream:** M01 owner UI; no M03/M06 backend modifications, no schema, migration, RPC, Worker config, POS canonical original HTML/JS change.
- **Edited:** `scripts/build-owner-frontend.mjs` (two lines), new `scripts/patch-owner-hisabiq-pos.mjs`, `src/ui/hisabiq/pos-parity.{css,mjs}`, tests/QA, plan/spec/screenshots.
- **No endpoint/table mutation.** Existing private `/api/owner/pos/bootstrap` reused unchanged by original source POS.
- **Dependencies:** final checkout, 2–4-unit quantity/price and tiles conversion pending M05/M06/M03 D1 source authority. Exact React component reuse not claimed.
- **Merge:** isolated PR to main, keep original source; don't remove legacy cart before proven D1/screenshot reconciliation.

## UI-refine disclosure
`/ui-refine-skill` unavailable here; manual installed Impeccable fallback and inspected browser screenshots used. Skill-specific gate **unverified**. Exact parity **not complete**. Source reference and screenshot comparisons identified/fixed desktop blank gap and mobile hidden-banner leakage.

## QA / roll-forward
No D1 cutover or deploy. Review visual screenshot matrix, permissions, dark theme, stale session and customer/warranty/serial workflows before any follow-up claiming full POS parity.

## Completion-of-pass supplement

- Rebased onto merged shell #860 without changing shared shell source.
- Added source-connected customer disclosure; original-input Cash shortcuts;
  amount-in-words, paid/change/due summary; nonposting preview and F2/F8/F9.
- Disabled Installment and unsupported Bank/Mobile in current Cash-only pilot.
  Full multi-unit, split-payment and D1 invoice capabilities remain gated.
- Visual refinement corrected 1024px shell menu overflow, pilot warning
  placement, in-words display and scrolled screenshot sticky header artifact.
- Added responsive, dark and viewport-state images and product-search keyboard QA.
- No shared financial, D1, Worker, Auth, routing, Party or legacy files modified.

## Exact latest local verification results

- **17/17 PASS:** source Owner compiled Chromium UI/contract tests at
  five source viewports including responsive geometry, amount words, cart,
  Drafts, keyboard product entry, preview, cash shortcut, customer details
  and dark-mode UI.
- **1/1 PASS:** targeted dark computed-style contrast regression.
- **3/3 PASS:** focused customer, cash and product combobox interaction
  screenshot flows.
- **7/7 PASS:** existing compiled Owner ERP browser regression.
- **4/4 PASS:** existing real local Workerd/Shop D1 cash sale regression
  (one-product paid Cash FIFO, exact Cash Book, guardrails, replay, rollback,
  concurrent last-unit and isolated Owner invoice read). These test the
  preexisting M03 writer, not multi-unit or split tender.
- Source 84/84, docs checks and 7/7 design/shell tests PASS, Owner build PASS.
- **No complete POS feature parity claim:** multi-unit compound, tiles,
  installment, Customer Due, saved drafts and split payment require separate
  reviewed M05/M06/M03 posting and authenticated D1 proofs.
- The exact /ui-refine-skill executable was unavailable; manual screenshot
  inspection with documented refinement rounds used as fallback.

## Additional source-safe POS refinement (same PR, no financial writer edits)

- **RED:** three new real Chromium tests first failed for multi-item early
  rejection, empty Cart copy and incomplete unsaved preview.
- **GREEN:** new POS-only capture-phase guard blocks known-unsupported
  multi-line, discounted, Due/partial or non-Cash checkout before a POST;
  original confirmation remains reachable for eligible one-product Cash.
  SQL Worker remains the only authority for accepted writes.
- HisabIQ CartTable empty-state now tracks original cart rows and Add Product.
- Preview now includes customer/phone, subtotal, discount, paid, due/change and
  total from existing source inputs; does not post, invent an invoice or alter
  editable cart values.
- [Third-pass before/after 320px and preview screenshots](docs/reviews/m01-hisabiq-pos-ui-refine/README.md).
- No schema, D1, Worker, source legacy, public RPC, auth or M03/M06 files touched.

## CI regression repair (old head 48835507)

- GitHub owner-pos-cash failed because M01 had hidden original required
  Name/Phone inside its collapsed details accordion. New RED test reproduced
  hidden #posCustomerName; GREEN keeps original Name/Phone directly visible
  at 320/390/768/1024/1440 and moves only optional fields into disclosure.
  The same existing actual Workerd/D1 checkout -> persisted receipt ->
  reload/reprint Chromium test passed 1/1 locally after fix.
- Shared-shell CI separately reported 254px vs expected 256px on GH runner.
  Parallel shell owner #864 was notified with exact log/line; no shell
  code or test changed in this POS PR. Local full M01 browser suite passed
  157/157 including the shell test.
- M01 POS new early guard/empty cart/preview tests first failed RED, then
  passed GREEN; source financial confirmation stays intact.
- CI on this new exact head must still run; no release/merge claim until
  those results are verified.

## Final verified local acceptance after all scoped fixes

- **157/157 PASS** latest full M01 browser suite, including original
  POS, print/A4/thermal, Shell, Party and Owner access.
- **30/30 PASS** focused Owner POS browser/contract and Owner regression,
  with source Name/Phone shown at five responsive breakpoints.
- **1/1 PASS** actual Owner Chromium confirmed single-product cash sale
  to local Workerd/D1, persisted receipt and reload/reprint.
- **4/4 PASS** existing local Workerd/D1 atomic FIFO/Cash writer
  regressions (backend unchanged by this M01 PR).
- **84/84 PASS** original source verification, docs check, Owner build.
- Previous head's Cash CI failure addressed by preserving visible original
  Name/Phone. Shell width 254/256 CI failure assigned to #864 without
  touching shell. Wait for **new exact-head CI and owner review**;
  no production Worker deploy or D1 migration is included.
