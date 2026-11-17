# M01 Dashboard — actor/tenant summary isolation regression (2026-11-17)

**Issue:** #567 (dashboard UI continuity); **base main:** `5290a06abda5a0e42192b8bfbcc2f83e59495647`; **merged prerequisite:** Step 3 PR #601. **Workstream:** M01, compiled UI-only hardening. **Original source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Owned files:** `src/ui/hisabiq-dashboard.html`, `qa/m01-browser.spec.mjs`, this plan only. **No** `legacy/source/**`, `src/db/**`, `src/rpc/**`, schema, auth, financial posting or Worker deployment edits. No conflicting open dashboard PR at task intake.

## Twelve-sentence implementation overview

1. The merged HisabIQ dashboard mirrors the ten original summary-cell values into displayed metric widgets.
2. Layout settings are actor/tenant-scoped, but the source summary cells can retain values after actor or tenant switches.
3. This task closes the immediate UI-level stale-summary display gap without creating an alternative backend authority.
4. A Playwright test first writes clearly synthetic Sales/Due values for actor A and verifies the dashboard mirrors them during the active synthetic session.
5. The same test changes to another tenant/actor without reloading and requires all mirrored legacy summary values to return to an unavailable marker, including source-cell cleanup.
6. The test then simulates fresh source values for the new actor and verifies the normal legacy-to-widget mirror still works.
7. The test signs out, injects a stale late source-cell mutation and verifies no financial amount is mirrored while signed out.
8. Signing back in with a different synthetic actor must again discard source values left during the signed-out interval.
9. Keep the original `dashLoad/getDashboardStats` API and all ten source IDs unchanged, and never infer zero from unavailable data.
10. Use a single small source-cell reset only after a previously observed authenticated identity has changed, together with an active-session guard in metric hydration.
11. Record a genuine RED browser failure before the smallest GREEN HTML/JS change and require full current-head GitHub CI including Chromium before merge.
12. This is defense in depth for the static UI; complete protection against late cross-session RPC replies requires M03/M04 trusted request/session binding, which remains a separate release gate.

## Acceptance and constraints

- [ ] RED: browser test fails because old actor's synthetic amount survives a tenant/user switch or signed-out metric hydration.
- [ ] GREEN: values return to `—` after actor or tenant change, logout and subsequent new-actor sign-in until fresh source cells update.
- [ ] Existing legacy source IDs and upstream source loaders are left intact; no financial values are invented or zeroed.
- [ ] No username/tenant layout preference crossover, no UI redesign, no React, no new public RPC.
- [ ] Full current-head GitHub Actions and M01 desktop/mobile/print tests pass; PR review and owner approval before merge.
- [ ] Pending limitation: only M03/M04 may establish cryptographically trusted actor/source-result attribution to defend against in-flight late responses.

**Merge order:** Steps #570 → #588 → #601 (all on main) → this scoped regression PR (after review/CI) → separately approved M09 read model/M03+M04 authentication integration. **Rollback:** revert this single regression PR; three merged dashboard UI steps remain.
