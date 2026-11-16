# M01 Static UI Contract: Real DOM ID Attribute Parsing

> For agentic workers: use Superpowers executing-plans, test-driven-development, verification-before-completion. Make a failing test first and retain evidence.

**Goal:** Make M01's compiled frontend contract check distinguish real element `id` attributes from `data-id` attributes or `id=` fragments inside other attributes' quoted values.

**Source authority:** Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Requirements: `AGENTS.md`, `docs/WORKSTREAMS.md` M01, `docs/MIGRATION_PLAN.md` P1.

**Architecture:** Leave the source, generated HTML, compiler and runtime unchanged. Update only the static CI checker `scripts/check-m01-ui.mjs` to tokenize HTML opening-tag attributes, recognize an attribute named exactly `id`, and count its value; continue stripping CSS, JS and comments beforehand. Avoid new dependencies or runtime DOM code.

**Stack:** Node.js built-in test runner, existing M01 CI Foundation and Chromium test jobs.

## Global constraints
- No edits to `legacy/source`, original GAS deployment, Sheets, styling, scripts, DOM handlers, printing or navigation.
- No changes to `src/index.js`, `src/rpc`, auth, D1, stock/finance, migrations or Cloudflare configuration.
- Keep required shell ID set and error messages stable; real duplicate and missing IDs must still be rejected.
- Static checker is not a substitute for real-browser DOM or authenticated D1 integration.

## Task 1 — RED, regression tests
**Modify:** `tests/m01-ui-contract.test.mjs`
- [ ] Build frozen UI via the existing `before` helper and inject an extra `<div data-id="printHost">...` plus `<div data-label=" id='printHost'">...`. Neither should count as a duplicate real shell ID.
- [ ] Replace one true `id="app"` with `data-id="app"` and require an `app missing` error.
- [ ] Verify true `id="printHost"` duplicates still fail (existing test).
- [ ] Commit test first, observe expected new assertions RED in GitHub Foundation CI before implementation.

## Task 2 — GREEN, minimal checker fix
**Modify:** `scripts/check-m01-ui.mjs`
- [ ] Scan opening tags with quote-aware tag boundaries, then match attributes with consumed quoted values (not naive word-boundary substrings).
- [ ] Count only an attribute whose entire name is `id`; preserve handling for single/double-quoted values and optionally valid unquoted IDs.
- [ ] Confirm new tests GREEN plus existing required-ID, print, RPC, mobile, source byte, frontend build and Chromium checks.
- [ ] Review exact PR diff and all exact-head CI checks. Record RED/GREEN/remaining gates for owner review; do not auto-merge.

## Edge-case review
- `data-id` is never an `id`.
- A textual `id=` inside another quoted attribute value is not an `id`.
- Both quote styles and other attribute order remain valid.
- Comments, script and style fragments remain excluded from live markup count.
- Real missing/duplicate IDs continue to fail.

## Impact inventory
Only test, static checker and this plan. No HTML output change, no RPC request/response contract changes, no database tables, accounts or posting changes. M03/M04 authenticated browser/real D1 parity remains a separate release gate.
