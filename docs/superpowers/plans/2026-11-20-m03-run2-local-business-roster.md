# M03 Run 2 — Local Control Center business roster and recovery

> **For agentic workers:** Use Superpowers test-driven development and a separate independent QA/review gate. This is a small continuation of merged PR #722, not a production SaaS activation.

**Goal:** An authenticated Platform Super Admin can view recent local Shop setup operations from durable Control D1 and resume a pending one even after changing browsers or losing sessionStorage.

**Architecture:** Reuse the merged Control D1 `platform_shop_reservations` and `platform_shop_provisioning` tables and the current Super Admin session predicate; add no schema, data copy or remote Cloudflare integration. A flag-gated read-only private endpoint lists only the requesting operator's recent 50 operations, projecting safe fields. The existing Control Center page displays them using DOM `textContent` and a Resume button for non-ready rows. Clicking Resume uses exactly the existing `POST /api/platform/shops/resume` with the recorded operation ID; it never creates a fresh intent.

**Tech Stack:** Hono private Worker, Cloudflare D1/SQLite, existing HTML/vanilla JS, Node 22 tests, local Workerd/D1, Chromium/Playwright.

**Spec:** SherERP Cloud [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), PORT-00 [#699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699), M03 [#22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22), existing `docs/CLEAN_SHOP_HANDOFF.md`.

## Twelve-sentence implementation overview

1. PR #722 introduced durable, local-only business provisioning and safe retries.
2. Its original form saves only one current operation in browser sessionStorage.
3. The operator should not need that particular browser to find a pending business.
4. The next small M03 slice will show a list of recent operations already recorded in Control D1.
5. No extra tenant, Owner, permission or transaction tables are needed.
6. The list must be authorized using the same current Platform Super Admin session as existing status and Resume routes.
7. The endpoint will return only the operation, Shop identifier, business name, Owner Gmail, safe setup stage and safe failure stage.
8. Internal D1 database UUIDs, Worker bindings, allocation evidence and administrative credentials must never enter the response.
9. The current Control Center style and Create Business, Google/MFA and legacy name-only reservation behavior stay unchanged.
10. Each non-ready row provides a keyboard-accessible Resume action that calls the existing idempotent backend with the original operation ID.
11. Tests must prove unauthorized requests fail closed, another operator's rows cannot appear, a lost browser draft is recoverable, two Shop operations remain distinct and old results cannot render after sign-out.
12. This is a local Workerd/D1 feature behind the existing `PLATFORM_LOCAL_PROVISIONING_ENABLED` gate; remote Cloudflare resource changes, staff impersonation, owner activation and accounting writers are excluded.

## Global constraints

- GitHub-only branch and PR, TDD RED then minimal GREEN, no direct commits to main.
- No deploy, public RPC/Worker, remote migration, production Cloudflare changes, finance/stock/ledger writer.
- No modification to source `legacy/source`, shared `src/db/**`, SQL schema or Wrangler configs.
- One M03 integration owner; M01 UI coordination recorded before editing `frontend/platform-auth/index.html` and `platform-auth.js`.
- Private authorization at SQL read time; never infer platform authority from client role or route visibility.
- One bounded list (latest 50 by immutable created timestamp and operation ID); defer pagination/search until needed and label the bound clearly.
- XSS-safe text rendering and no internal D1 allocation metadata in JSON.

## Review focus

- Missing, expired, disabled or revoked admin sessions: list and Resume must deny, no client-side stale rows appear.
- Different admin identity: SQL must filter by `created_by_subject`, even if a second identity is present in a synthetic fixture.
- Reused/forged operation IDs: no new intent and no cross-operator switch from a list.
- Interrupted allocation, binding mismatch, resumed readiness: stay visible and recover without duplicate DB or Owner approval.
- Legacy flag off: no roster API or UI, no regression to existing Create and sign-in flows.

## Task 1 — Private listing contract (RED → GREEN)

**Files:** `tests/integration/port-p4-control-center-provisioning-workerd.spec.mjs`, `src/auth/port-p4-local-provisioning.js`, `src/m03-private-platform-auth-worker.js`.

- [ ] Add a real local Workerd/D1 test for GET `/api/platform/shops/list`: after creating two distinct reservations it lists exactly those rows with safe fields, stable order, bounded count, and no database/binding metadata. Require 401 for missing or revoked auth. Require 404 when local mode is disabled. Assert the SQL identity filter with a second synthetic creator and reject cross-operator leaks.
- [ ] Run the test before implementation and record expected RED (missing route).
- [ ] Implement `listLocalProvisioning(db,token)` with SQL join to `CURRENT_PLATFORM_ADMIN_FROM`, fixed 50-row LIMIT, safe projection and `{code:200,body:{shops:[...]}}` response; invalid session = 401.
- [ ] Add private `GET /api/platform/shops/list` under `localProvisioningGate` without touching default public Worker.
- [ ] Verify Workerd/D1 RED→GREEN plus original 26-case M03 Access release regression.

## Task 2 — Original Control Center roster and Resume (RED → GREEN)

**Files:** `qa/m03-control-center-provisioning-page.spec.mjs`, `frontend/platform-auth/index.html`, `frontend/platform-auth/platform-auth.js` (minimal existing CSS only if needed).

- [ ] Extend real Chromium test: after local Admin login, empty roster; after two Shop operations and cleared sessionStorage/reload, the list shows correct labels and two statuses and can Resume the pending Shop without re-Creating it. Assert successful two-DB isolation and two local approvals, no leaked allocation fields or DOM interpolation, and no list after denied session.
- [ ] Run browser RED (the new list is missing).
- [ ] Add a compact `Recent businesses (up to 50)` section in signed-in view, hidden in legacy/disabled mode, `ul` rows and button; no new route or styling system.
- [ ] Fetch with current session in `showSignedIn`; validate response shape and stage values, render using textContent, guard stale async responses with the current UI `generation`.
- [ ] Resume calls existing endpoint, updates the list from current Control D1, shows errors without losing retry and does not clear an unrelated Create form draft.
- [ ] Verify 320, 390 and 1440 widths, keyboard controls, sign-out denial and original Platform/Owner browser flows.

## Task 3 — PR verification and handoff

- [ ] Run source manifest, preserved frontend build, focused tests, full affected Workerd/D1 and Chromium checks.
- [ ] Push scoped commits to one PR from updated main and confirm exact current GitHub CI status; do not claim success from stale head.
- [ ] Obtain independent Super QA → Super Review and M01 UI review. Do not merge without user approval.
- [ ] Keep hosted provisioning, M08 financial posting, historic import and production activation separately blocked.
