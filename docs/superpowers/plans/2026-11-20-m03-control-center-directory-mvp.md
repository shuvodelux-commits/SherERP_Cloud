# Minimal Tenant Control Center — Recent Business Directory MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development; follow each checked task from RED to GREEN, then independent QA.

**Goal:** Make the existing private Control Center a compact, searchable, honest recent-business directory for one Super Admin without adding backend authority or risking financial data.

**Architecture:** Reuse authenticated `GET /api/platform/shops/list` (maximum 50 rows). Add client-only name/Owner Gmail search, `All / Setup ready / Needs setup` filtering, bounded setup counters and responsive styling to the existing platform-auth page. Never infer total businesses or ERP operational readiness from the recent 50, and never fabricate an Open ERP support action.

**Tech Stack:** Existing HTML + CSS + vanilla JS, Playwright browser test, local Workerd/D1 via existing M03 fixture, GitHub PR CI.

**Spec / approved design:** The owner wants a KISS one-operator tenant Control Center: Create Business, listing, setup status, Resume, later secure Shop-scoped support access, no heavy SaaS features. Original source UI and accounting remain immutable. This first milestone is DIRECTORY ONLY; the server-side Support Access requires a separately designed permission/grant/audit gate.

## Existing UI convention checklist

- Maintain `frontend/platform-auth/index.html` existing authenticated `#signed-in` section with semantic sections/forms/labels and existing Google/MFA controls.
- Reuse `#business-roster`/summary/list; do not create a second dashboard or duplicate API client.
- Reuse theme tokens in `platform-auth.css` (surface, border, text, primary, radius); no new dependencies/design system.
- Existing buttons/inputs have minimum 44px target, clear focus-visible outline, mobile 320/390px overflow checks.
- Preserve exact `Resume setup for <name>` button accessible labels and current stable operationId POST.
- Keep `localProvisioningEnabled` as the visibility gate; never display roster to signed-out users or invent business counts.
- Use `textContent` and `createElement` for remote strings, never `innerHTML`.
- Clear directory strings and search state when changing to the signed-out screen.
- Keep empty, loading, network-failure and filtered-zero states distinct.
- Avoid implying `ready` means an operational ERP; labels refer only to *setup*.

## Global constraints

- Repository: `shuvodelux-commits/SherERP_Cloud`, branch `m03/control-center-minimal-directory-mvp-20261120`, source baseline `main@9591444b105af09487fc251a583b0f007bf74645`.
- Frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` unchanged.
- Only owned files: `frontend/platform-auth/index.html`, `frontend/platform-auth/platform-auth.css`, `frontend/platform-auth/platform-auth.js`, `qa/m03-control-center-provisioning-page.spec.mjs`, NEW `.github/workflows/m03-control-center-directory-browser.yml` (PR-only, M11 review required), and this plan.
- M03 #752 local Cash Session, #757 hosted read-only preflight, M02 #748, M01 #755, M05 #756 and M10 #753 own disjoint files.
- No new API route, D1 binding, DDL, public RPC, financial posting, owner impersonation, tenant ERP opener, or remote deployment.
- Preserve original Create Business/Resume/Owner logic; 100% business calculations are outside and must not be touched.
- Do not merge or deploy without independent QA/review and owner approval.

## Review focus

1. The roster reports only the **recent** maximum-50 server list, never total tenant count.
2. No business data/search remains in the DOM or JS cache after sign-out/rejected auth; reload uses authenticated GET.
3. Search on Unicode names and case-insensitive Owner Gmail never sends the search query to the server.
4. Filtering cannot hide a previously pending record permanently; Resume still posts its exact original operationId and refreshes without a second Create Business.
5. Empty roster, no-match, 401, and other errors remain distinguishable; status labels cannot claim ERP readiness.

## Task 1: RED Chromium/Workerd contract

**File:** `qa/m03-control-center-provisioning-page.spec.mjs`

**Interfaces:** Consumes existing page, Workerd/D1 fixture and `/api/platform/shops/list`; produces browser assertions.

- [ ] Add assertions to the existing real-local-D1 browser flow after the pending second shop is created: recent count 2, setup ready 1, needs setup 1, search name/email, status filter, no match, clear/reload.
- [ ] Verify filtered row hiding preserves original pending operation Resume and post-resume counts.
- [ ] Assert min 44px controls, no 320px horizontal overflow, and the signed-out roster/search is inaccessible.
- [ ] Run real M03 Chromium test and observe expected **RED** because controls do not exist; record exact GitHub check/run.

## Task 2: GREEN minimal directory UI

**Files:** `frontend/platform-auth/index.html`, `frontend/platform-auth/platform-auth.css`, `frontend/platform-auth/platform-auth.js`

**Interfaces:** Consume validated `result.shops` only. Produce DOM controls `#business-search`, `#business-status-filter`, `#business-recent-count`, `#business-ready-count`, `#business-pending-count`, `#business-filter-summary`.

- [ ] Add controls and bounded totals inside existing `#business-roster`, gated by its signed-in/localProvisioning visibility.
- [ ] Keep a local roster array scoped to active view, render filtered rows via existing safe textContent operations; counts refer to all returned rows, not visible-only.
- [ ] Add `input`/`change` listeners; preserve query/filter across the existing Resume refresh but clear all on sign-out.
- [ ] Add compact desktop expansion of the existing card and responsive mobile tool row; use existing CSS tokens and 44px targets.
- [ ] Run targeted browser and original auth/browser Workerd suites; verify existing create/resume/Owner flow unchanged.

## Task 3: Verify, inspect, hand off

- [ ] Verify GitHub exact current branch HEAD and changed-file ownership against new open PRs, including M03 #752/#757.
- [ ] Inspect full test runs (Foundation, M03 Chromium, Workerd/D1, Cloudflare public preview safety, source freeze), record failures explicitly.
- [ ] Perform an independent `/super qa → /super review` before owner-approved merge; no hidden automatic launch.
- [ ] Keep a reviewable PR, with no permission to deploy admin-hisabiq until a separate Admin Worker deployment review.
- [ ] Follow-on milestone: secure tenant ERP support access with explicit Admin identity, Shop-scoped grant, expiry, audit, revocation and permission-reviewed financial mutations; **NOT IMPLEMENTED HERE**.

## Execution evidence (Run 1)

- **RED test-first commit:** `7c4fb03d67cac730c970cea9d89ef9cafc09e6f6`.
- **RED hosted real Chromium/Workerd D1:** [run 44689079478](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44689079478), 0/1 test passing, exact expected Playwright locator timeout on missing `#business-recent-count`, after executing the original local Create/Resume flow.
- **GREEN files committed:** HTML `ba95fe3`, CSS `1cf9696`, JS `d550f5a`.
- **GREEN hosted real Chromium/Workerd D1:** [run 44689705724](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44689705724), success.
- **Exact GREEN code-head checks:** 52/53 succeeded at `d550f5a`; Cloudflare `Workers Builds: hisabiq` failed. Other simultaneous M02/M03/M10 PRs have independently failing Cloudflare build checks; do not assume cause or waive. This plan-only commit requires fresh final-head verification.
- **Review hold:** PR remains draft; independent /super QA → /super review, M11 CI ownership/security review and explicit human merge approval required. Nothing deployed to Admin Worker and no production database modified.
