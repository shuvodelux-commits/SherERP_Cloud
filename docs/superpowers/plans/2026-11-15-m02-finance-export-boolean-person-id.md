# M02-P Finance export Boolean Person ID — Superpowers implementation plan

**Goal:** Fail closed on Boolean Person ID source export cells without rejecting valid Boolean deletion flags, changing valid finance transaction values, or enabling imports. **Source:** frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 FinanceModule.gs, ADR-007. **Spec:** docs/superpowers/specs/2026-11-15-m02-finance-export-boolean-person-id-design.md.

**Paths owned:** src/party/finance-export-coverage.js, tests/m02-finance-export-boolean-person-id.test.mjs, this plan and spec. No overlap with open #182/#180 finance gross preflight or #190 rehearsal coordinator and #191 readback metadata validation. GitHub-first, Superpowers RED → GREEN → CI, KISS.

### Task 1 — RED
- [ ] Inspect original Finance source creation of Finance ID and selected Person ID, original Config column contract and existing finance-export-coverage.js + Node tests.
- [ ] Commit new synthetic tests before implementation: active Boolean true/false Person IDs fail with UNSAFE_IDENTIFIER and no partial success; deleted Boolean Person ID also fails while deleted zero Amount remains allowed; string values keep exact source shape; number/null controls, Boolean Is Deleted and privacy/immutability controls.
- [ ] Open draft PR and capture expected GitHub Foundation RED on the three Boolean Person ID cases (assertion failures), with ordinary existing tests passing.

### Task 2 — minimum GREEN
- [ ] In the existing source export validator, extend the one Person ID unsafe-type check to include typeof value==='boolean' in addition to number. No extra issue shape, migration, global cell validity change or source normalization.
- [ ] Verify new tests and all Node/source pin/unchanged frontend checks. Refactor only if needed.

### Task 3 — integrate/owner review
- [ ] Verify exact-head GitHub CI Foundation, M02 Party local Workerd/D1 & synthetic import, M03 Workerd D1, M04 auth, M01 Chromium and Cloudflare PR safety. Do not infer financial D1 posting readiness.
- [ ] Compare against latest main and sync disjoint changed files if needed. Require exactly four PR paths and zero behind for review readiness.
- [ ] Record test-first RED/GREEN SHA, CI evidence, scope and rollback in PR. Keep new PR draft and unmerged until all checks green; owner decides merge.

**Release status:** offline-only export validation. No actual finance import, Cash/Bank/Party posting or cross-role settlement.
