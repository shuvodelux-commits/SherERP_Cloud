# M07 Returns Search — real compiled UI Playwright evidence (17 Nov 2026)

**Scope:** M07 preview only, M01 owns any actual frontend CSS change. **Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Source checkout:** SherERP_Cloud `main@892115db23b9dead40dce9ed1c69b536d11c0b6c`, updated *only in an isolated local QA clone* with the two proposed M07 CSS/Playwright edits from PR #592. These metrics are from the **complete compiled original Returns page** served at a loopback port with the existing fail-closed Worker; no real auth, network API, Return posting or D1 financial data.

## Root cause and RED

Original `node qa/m07-returns-ui-refine-preview.mjs` with compiled source and proposed CSS from merged PR #584 failed at viewport 320: `AssertionError: refinement must not clip at 320`. The compiled page adds `span.erp-search-clear-field` around the search input. The mobile grid selector targeted the **nested input**, not the direct-child wrapper, so the visible input remained 129px in a 266px row. QA also incorrectly counted the nested hidden global search-clear button as a third Find/Clear action. The source-fragment screenshot-only review could not detect the wrapper interaction.

## GREEN correction and browser validation

The corrective proposal places the direct-child search-clear wrapper across both mobile grid columns and makes the QA metric count only the row's direct action buttons. Run used Node 24.22.2, Playwright 1.65.1, system Chromium on the connected CachyOS device:

```bash
npm ci --ignore-scripts --no-audit --no-fund
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium node qa/m07-returns-ui-refine-preview.mjs
```

It returned `captures: 12`, `regression: 0`, `syntheticOnly: true` and `noPublicRpcChanges: true`. No runtime source or deploy code was modified. The generated PNGs and `metrics.json` are under `test-results/m07-returns-ui-refine/` in that isolated local QA clone, not currently attached to this PR; any reviewer can regenerate them with the command above.

| Search mode | Width | Original input / row | Refined input / row | Find/Clear widths after | Outcome |
| --- | ---: | --- | --- | --- | --- |
| Invoice | 320px | 64 / 266px | **266 / 266px** | 129 / 129px | PASS |
| Customer | 320px | 56 / 266px | **266 / 266px** | 129 / 129px | PASS |
| Invoice | 375px | 119 / 321px | **321 / 321px** | 157 / 157px | PASS |
| Customer | 375px | 102 / 321px | **321 / 321px** | 157 / 157px | PASS |
| Invoice | 1440px | 1080 / 1282px | 1080 / 1282px | unchanged | PASS |
| Customer | 1440px | 1063 / 1282px | 1063 / 1282px | unchanged | PASS |

All **four** refined mobile action pairs were 44px high; original Return confirmation and refund identifiers remained present; 12/12 page captures had **zero Playwright page errors** and no measured horizontal clipping. Desktop search/control metrics were unchanged.

## Limits and owner handoff

- The tests manually reveal existing original Returns DOM inside a synthetic localhost fixture. They do not prove user session, authorization, real Return search, Cash Session, original-lot reversal, or authenticated production route.
- This PR only changes the unused CSS proposal and its M07-specific QA script/test. **M01** must review final real screenshots, keyboard/touch and eventual production CSS integration in its own branch, with review of the global clear-wrapper contract.
- **M03** still owns all D1/RPC posting, source lineage, original-lot exactly-once reversal and Cash/Bank/Party transactional protections. No new operational feature is activated by this QA evidence.
