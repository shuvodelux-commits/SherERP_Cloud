## Summary
M01 Owner-only HisabIQ POS V2 visual/cart layout migration. This is intentionally a **partial UI parity PR** — not completion of multi-unit, split-payment or checkout backend parity.

- Source: `hisabiq_ui@e42a00a9`. Base: `SherERP_Cloud@71aabc89`.
- Restyles the actual cart/quick items/checkout through scoped compiled Owner assets; preserves original POS event handlers, product dataset, cash-session authority and source legacy files.
- Responsive 320/390/768/1024/1440, dark-color tokens, bilingual labels and compact controls.
- Screenshots and before/after review in [M01 visual evidence](docs/reviews/m01-hisabiq-pos-ui-refine/README.md). No public Worker/DB paths modified.

## TDD and checks
- RED: two isolated contract tests failed for missing Owner-only injector/design.
- GREEN: 12/12 focused Node + live Chromium browser tests, adding real UI products, editing qty/line total and remove, source Drafts, no horizontal overflow and no sale POST.
- Source manifest 84 files verified, docs check passed, Owner HTML compiled. Existing Owner suite/CI status must be reviewed on exact PR head.

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
