# Owner-visible Support Activity in the existing ERP — M03 Run 6

> For agentic workers: REQUIRED SUB-SKILL: superpowers:executing-plans, test-driven-development, independent /super qa → /super review. Every behavior is RED first, then minimal GREEN, then exact-head CI.

**Goal:** Show each authenticated Shop Owner the already available, private, own-Shop support audit without redesigning the frozen original ERP interface or enabling hosted access.

**Architecture:** Inject one hidden, compact, keyboard-accessible Support Activity disclosure alongside the existing Owner-authenticated ERP shell notice via scripts/build-owner-frontend.mjs. The private Owner session response advertises supportAuditEnabled only if the dedicated route is enabled. After user click, a single GET loads bounded, redacted action/timestamp/reason records from the merged #786 own-Shop SQL-current Owner read; no Shop ID or raw token flows through the browser. Treat expired authentication and server-unavailable separately; do not use browser storage and always render untrusted reason text via textContent.

**Tech stack:** existing HTML/JS/ESM Owner frontend patcher, Hono Owner Worker, Playwright Chromium, node:test and current Workerd/D1 security tests.

**Spec:** https://github.com/shuvodelux-commits/SherERP_Cloud/issues/765; baseline previous merged PR #786; original source snapshot Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## Constraints

- Base main 447034b01d34333c935305f393ed97e1ee7d579e. Owned files only: scripts/build-owner-frontend.mjs; src/m03-owner-redemption-worker.js; new qa/m03-owner-support-activity-browser.spec.mjs; new .github/workflows/m03-owner-support-activity-browser.yml; this plan.
- The Owner Worker must return supportAuditEnabled only after valid Owner session and only if OWNER_SUPPORT_AUDIT_ENABLED==='true', with no new roles.
- The generated UI component must remain hidden, unmounted or inert if the server does not advertise the capability. Never call /api/owner/support/audit without owner interaction.
- Fixed GET endpoint must remain the merged #786 private, current-session and Shop-scoped audit endpoint. No client Shop selector, arbitrary query, localStorage/sessionStorage or cached support event contents.
- Display START/READ/END, human timestamp, generic Super Admin label and reason via node.textContent. Reject unexpected response shapes, events over 50 or invalid types.
- Narrow, accessible mobile layout matching existing Owner notice. No new SPA framework, Owner login screen refactor or POS redesign.
- Missing hosted Control DB audit migration means capability/route must remain default-off in all Wrangler profiles. No remote migrations or Cloudflare deployment.
- No edits to original ERP source; build patch only, preserving all frozen-snapshot build, financial/stock and current Owner product behavior.

## Task 1 — RED browser contract

- [ ] Create qa/m03-owner-support-activity-browser.spec.mjs, serving the actual built Owner ERP assets in an isolated localhost HTTP server and exercising Chromium.
- [ ] Verify absent capability hides panel and does not call audit endpoint, active capability exposes a clearly marked Support activity control, manual click loads safe events from own-Shop API, malicious reason remains inert text, no token or Shop ID in URL, and mobile 390px no overflow.
- [ ] Verify 200 empty events, 401 expired session, 503 unavailable, malformed responses, sign-out and no persisted secrets. Run alongside existing qa/m03-owner-erp-browser.spec.mjs and real Workerd/D1 auth suite.
- [ ] Commit RED tests and a PR-only Chromium workflow; verify exact expected missing widget failure in hosted RED run.

## Task 2 — GREEN minimal Owner shell integration

- [ ] Modify scripts/build-owner-frontend.mjs to insert the minimal widget and script into the existing patch, using an exact anchor and existing build determinism.
- [ ] Modify src/m03-owner-redemption-worker.js to attach a boolean supportAuditEnabled only when a valid Owner session is present and the flag is enabled. No change to the already private audit API.
- [ ] GREEN real Chromium and original Owner browser + Workerd auth tests.

## Task 3 — independent review and release handoff

- [ ] Check exact HEAD full GitHub Actions, paused/failed Cloudflare Builds separately and branch conflict with other PRs.
- [ ] M04/M11 review privacy, current-session proof, owner-facing display and source-fidelity; leave draft until human-approved merge.
- [ ] Report that hosted Support Mode and Owner Support Activity cannot be enabled without approved grant/event Control D1 migration, trusted hosted Shop bindings, Access protection, revocation-race policy and deployment authorization.
