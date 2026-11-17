# M01 — Dashboard same-actor session turnover redaction

**Owner:** M01 dashboard UI and `qa/m01-browser.spec.mjs`; **Issue:** #567; **coordination:** #456; **depends on:** merged dashboard #570/#588/#601/#607/#613. **Original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Base:** latest `main` at branch creation. **M02/M03/M04/M09 remain integration owners** for real financial authority.

## Overview — 12 sentences

1. The M01 dashboard mirrors historical source summary DOM cells only while its current user/tenant identity matches stored layout state.
2. The earlier #607 regression clears legacy values on user/tenant switches and logout.
3. A new login session can nevertheless rotate the token while keeping the same user and tenant identifiers.
4. The dashboard's identity key does not include session-token turnover, so the old DOM summary may still be considered current.
5. This M01-owned slice adds a synthetic browser regression for the same-user/same-tenant token rotation.
6. The RED test verifies that a source-cell callback after token rotation but before an identity-sync event cannot mirror the prior session's totals.
7. It then verifies that a window focus identity sync clears old legacy source DOM values and displays unavailable placeholders.
8. It also verifies that a subsequent synthetic source-cell update under the new token can still render normally.
9. GREEN will record the last observed session token only in ephemeral closure state, without storing it in DOM or localStorage.
10. The dashboard will treat a token change for the same identity as a session boundary and redact stale summaries, while preserving user-specific widget layout.
11. The code will not introduce public RPC, D1 queries, real transaction data, Worker bindings, finance calculations or changes to original GAS.
12. The fix cannot authenticate source callbacks or prevent late old-token results after a new session is active, so M03/M04 must separately attach verified request/session provenance before production financial reads.

## Test and merge gates

- RED: One M01 Chromium test fails on stale mirrored value after synthetic token change and/or stale source content after focus.
- GREEN: The same test and all existing M01, print QA, local Worker/D1 and accounting checks pass on the exact final commit.
- Change only `src/ui/hisabiq-dashboard.html`, `qa/m01-browser.spec.mjs`, and this M01-only plan.
- M01 #619 Products preview touches separate paths; M03 #614, M05 #618, M10 #620 likewise do not overlap.
- Rollback by reverting this PR; preserve already merged #607/#613. No source data or production D1 touched.
- Human review/approval under GitHub protection and full exact-head CI are mandatory before merge.
