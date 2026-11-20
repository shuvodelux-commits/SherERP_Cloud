# M03 Option A Automatic Multi-Shop Provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT for owner review. Option A topology is approved; individual implementation PRs and any live Cloudflare mutation require their own approval.

**Goal:** From the existing Super Admin, create and manage multiple isolated shops with their own D1 databases and Google Owner access, without manually creating databases or editing Workers Builds variables for each shop.

**Architecture:** One shared private Owner Worker with a checked, append-only Shop D1 binding registry, plus an internal least-privilege Provisioner Worker. The current MFA-protected Admin and Control D1 own a durable idempotent provisioning journal; the sole private publisher publishes verified Worker versions, while existing Owner ERP reads/writes are routed only by server-validated Shop membership.

**Tech Stack:** Cloudflare Workers + Hono, D1 SQLite, Workers service binding, Cloudflare D1 and Worker Versions APIs, original HTML/JS ERP, Node.js >=22, Wrangler Workerd integration, Playwright/Chromium, GitHub Actions.

**Spec:** [Option A design](../specs/2026-11-21-m03-option-a-auto-provisioning-design.md)

## Global Constraints

- **One private production deploy owner** for Worker `shererp`; GitHub Builds must not overwrite live Shop bindings.
- The existing first Shop `shererp-shop-001`, Super Admin/MFA, Owner membership and existing D1 data must survive every stage.
- Use existing `src/auth/port-p4-local-provisioning.js`, `src/auth/port-p2-create-attempt.js`, `scripts/port-p2-provisioning.mjs` and pinned SQL migration contracts. Do not replace the onboarding state machine.
- Preserve the original ERP frontend and each module's accounting/auth/cash/session behavior. Avoid shared POS/Purchase/Return/Finance writer changes.
- Do not expose Cloudflare provider tokens to browser, Owner Worker, public Workers Builds, GitHub Actions PRs or logs.
- Default deny; exact Cloudflare account/Worker/database allowlists, verified current Admin Google/TOTP session, service-binding authorization, rate limits, CSRF/origin.
- No remote production SQL, provider write, binding publication, login-policy change or financial activation without a separately approved M03/M04/M10/M11 release gate.
- Keep the public `hisabiq` preview DB-free. Every PR includes source SHA, RED→GREEN evidence, affected file list, CI result and rollback.
- Coordinate M03 shared files with parallel Owner backend work through issue [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456) and onboarding [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690).

## Review Focus

1. **An existing Shop is present before a new binding:** new version retains its exact D1 UUID, session routing and active login (**Task 4 and Task 5 tests**).
2. **Network timeout after Cloudflare successfully creates a database:** only one attributable D1 can become linked; unprovable outcomes remain `needs-attention` (**Task 2 tests**).
3. **Simultaneous Create, retry or parallel deployment:** durable journal/lease prevents duplicate or lost bindings (**Task 2 and Task 4 tests**).
4. **Forged Shop ID, stale Owner session or the same Gmail owning two Shops:** exact current membership and explicit selected Shop are enforced (**Task 5 tests**).
5. **Quota exhaustion, schema drift, provider credential denial or failed binding promotion:** never mark Ready or allow Owner access (**Task 2, 3, 4, 6 tests**).

---

## Task 1 — Private Worker deployment ownership (M03/M11 PR)

**Files:**
- Create: `scripts/m03-private-deploy-owner-guard.mjs`
- Create: `tests/contract/m03-private-deploy-owner-guard.test.mjs`
- Modify: `scripts/build-shop-user-deploy.mjs`
- Modify: `docs/runbooks/M03_HOSTED_PREBOUND_PILOT.md`
- Do not edit: any Product/POS/Purchase/Return/Finance business writer

**Interfaces:**
- Consumes: current Worker release configuration and verified active D1 binding roster.
- Produces: `assertPrivateOwnerDeployOwnership({buildSettings,activeRelease,candidateRelease})` => explicit allowed/blocked result; no provider writes.

- [ ] **Step 1: RED** — Test that an attempted GitHub Builds promotion after a new Shop binding is present is refused; an unknown deploy owner, missing binding, or old code SHA fails before any Cloudflare call.
- [ ] **Step 2: Run** — `node --test tests/contract/m03-private-deploy-owner-guard.test.mjs`; expected FAIL for missing owner guard.
- [ ] **Step 3: GREEN** — Implement the smallest exact-account/worker/release/binding checks and document the one-time Cloudflare Builds change: no automatic production promotion of private Owner Worker; allow nonpromoting version uploads where approved. Do not claim the dashboard has been changed by repository code.
- [ ] **Step 4: Verify** — Same test PASS, `node --test tests/contract/shop-user-cloudflare-build.test.mjs` PASS and `node scripts/check-project-docs.mjs` PASS.
- [ ] **Step 5: Commit / PR** — Scope only deployment ownership; retain old active Worker version and immutable rollback inventory. **Human approval required** before editing live Builds settings.

## Task 2 — Durable Control D1 provisioning journal and provider adapter (M03/M04 PR)

**Files:**
- Create: `src/provisioning/hosted-shop-create.js`
- Create: `src/provisioning/cloudflare-d1-provider.js`
- Create: `staging-migrations/platform-onboarding/0012_hosted_shop_provisioning_journal.sql` (use next free actual migration number at implementation time)
- Create: `tests/contract/m03-hosted-shop-create-provider.test.mjs`
- Create: `tests/integration/m03-hosted-shop-journal-workerd.spec.mjs`
- Preserve: `src/auth/port-p4-local-provisioning.js`, `src/auth/port-p2-create-attempt.js`

**Interfaces:**
- Consumes: authenticated current Admin D1 session, `operationId`, `displayName`, `ownerEmail`; injected provider with `inspectAccount()`, `createDatabase(intent)`, `findCreation(intent)`.
- Produces: `reserveHostedShop(controlDb,sessionToken,input)` and `advanceHostedShopCreate(controlDb,operationId,provider)` => sanitized `{operationId,shopId,status,failedStage}`; no browser-provided D1 IDs.

- [ ] **Step 1: RED** — Assert one immutable operation for double-submit, mismatched intent 409, denied Admin zero provider calls, real D1 journal CAS, and `createDatabase` timeout becoming `outcome-unknown` until exact attributed provider evidence is read back.
- [ ] **Step 2: Run** — `node --test tests/contract/m03-hosted-shop-create-provider.test.mjs tests/integration/m03-hosted-shop-journal-workerd.spec.mjs`; expected FAIL.
- [ ] **Step 3: GREEN** — Adapt existing PORT-P2 create/reconcile receipts to Workerd (Node file-journal logic remains operator-only), implement exact account and D1 capacity preflight, stable deterministic database names, least-privilege REST adapter, durable operation/step audit and guarded transition.
- [ ] **Step 4: Verify** — Both new suites PASS plus `node --test tests/contract/port-p2-provisioning.test.mjs tests/integration/port-p4-control-center-provisioning-workerd.spec.mjs` PASS.
- [ ] **Step 5: Commit / PR** — Migration and journal require isolated Control D1 backup/restore rehearsal; **no hosted write during this task**.

## Task 3 — Pinned Shop D1 initialization and private Provisioner Worker (M03/M04/M10 PR)

**Files:**
- Create: `src/provisioning/shop-schema-initializer.js`
- Create: `src/m03-private-shop-provisioner-worker.js`
- Create: `tests/integration/m03-private-provisioner-workerd.spec.mjs`
- Modify, minimally: `scripts/m03-hosted-pilot-migrations.mjs`, `src/db/m03-owner-ready-shop-migrations.js` only with their file owner's review
- Use: `src/db/port-p2-shop-schema.js` and PORT-P2 checkpoint contract

**Interfaces:**
- Consumes: Task 2 journal + exact verified new D1 UUID, immutable Shop UUID/marker, pinned reviewed migration manifest; internal Admin service-binding request authenticated against current Control D1.
- Produces: `prepareVerifiedShop(provider,operationId,manifest)` => `{databaseId,shopId,marker,schemaRevision,receiptDigest}` only after all immutable receipts/identity checks; internal `POST /internal/provision/:operationId/advance` is **not publicly routable**.

- [ ] **Step 1: RED** — Real local D1: incomplete/altered migration checksum, nonempty foreign database, swapped identity, expired MFA and public-origin invocation cannot advance readiness.
- [ ] **Step 2: Run** — `node --test tests/integration/m03-private-provisioner-workerd.spec.mjs`; expected FAIL.
- [ ] **Step 3: GREEN** — Apply exact migrations only on newly verified empty D1 via the private provider and stored intent; record immutable receipt prefix and schema revision. Secure the Provisioner using service binding + independently checked Admin/session authorization, fixed account scopes and protected token. Do not expose raw SQL input.
- [ ] **Step 4: Verify** — New Workerd suite + `tests/integration/port-p2-shop-bindings-workerd.spec.mjs` + `tests/integration/m03-hosted-prebound-pilot-workerd.spec.mjs` PASS; replay and wrong-DB tests stay green.
- [ ] **Step 5: Commit / PR** — Do not execute remote migrations without explicit account, backup and owner release approval.

## Task 4 — Publish complete, versioned multi-Shop bindings (M03/M11 PR)

**Files:**
- Create: `src/provisioning/owner-worker-release-publisher.js`
- Create: `src/provisioning/verified-binding-roster.js`
- Create: `tests/contract/m03-owner-binding-publisher.test.mjs`
- Create: `tests/integration/m03-two-shop-binding-publication-workerd.spec.mjs`
- Adapt: `scripts/build-shop-user-deploy.mjs` for a verified roster rather than one pilot field; keep signed source/artifact release constraints.

**Interfaces:**
- Consumes: Task 3 verified D1 receipt, current complete active bindings/Worker version, reviewed immutable Owner bundle/asset release SHA, exclusive publication lease.
- Produces: `publishShopBinding(provider,verifiedPlacement,activeRelease)` => `{activeVersion,rosterHash,bindingKey}` only after version upload, full roster comparison and active-version readback.

- [ ] **Step 1: RED** — A candidate that drops the existing Shop, changes any database UUID, lacks source/artifact integrity, races an activation, or comes from a stale Builds deployment must be rejected. Timeout after publication must reconcile the active version, not blindly upload again.
- [ ] **Step 2: Run** — `node --test tests/contract/m03-owner-binding-publisher.test.mjs tests/integration/m03-two-shop-binding-publication-workerd.spec.mjs`; expected FAIL.
- [ ] **Step 3: GREEN** — Use reviewed Cloudflare Worker Versions API (prove exact request/response with test adapter) and one deployment owner. Publish append-only unique binding keys, verify full active roster, then persist a published generation in Control D1. Keep preview URLs private; preserve prior eligible deployments for compatible rollback.
- [ ] **Step 4: Verify** — New suites PASS and existing `tests/contract/shop-user-cloudflare-build.test.mjs` PASS; confirm no active Shop can be orphaned by an older config.
- [ ] **Step 5: Commit / PR** — Do not run version publication against the live account without M03/M11 release approval and current-resource preflight.

## Task 5 — Owner session → exact Shop D1 routing (M03/M04 PR)

**Files:**
- Create: `src/auth/m03-owner-tenant-router.js`
- Create: `tests/integration/m03-two-shop-owner-routing-workerd.spec.mjs`
- Modify, under exclusive M03 ownership: `src/m03-owner-redemption-worker.js`, `src/auth/platform-shop-binding.js`, existing Owner session/membership lookup as necessary
- Retain: `src/auth/m03-hosted-prebound-pilot.js` as compatibility bridge until existing Shop acceptance passes

**Interfaces:**
- Consumes: Owner session's validated Shop membership and Task 4 published binding roster plus current Control D1 verified ready placement.
- Produces: `resolveAuthorizedOwnerShop(env,session)` => `{shopId,shopDb,schemaRevision}` or denied; never accepts client-selected D1 ID or falls back to pilot.

- [ ] **Step 1: RED** — With two real local Shop D1 bindings, the same source product ID must resolve to different data per verified Owner Shop. Forged Shop UUID, wrong Gmail, revoked membership, suspended Shop, swapped marker, stale binding generation and a shared Gmail without Shop selection must fail closed.
- [ ] **Step 2: Run** — `node --test tests/integration/m03-two-shop-owner-routing-workerd.spec.mjs`; expected FAIL.
- [ ] **Step 3: GREEN** — Reuse existing Owner Google login and original ERP handlers; refactor only their Shop binding resolution (not their accounting algorithms). If the same approved Gmail owns two Shops, add explicit Shop selection/confirmation before issuing the scoped Owner session. Preserve original first-Shop login.
- [ ] **Step 4: Verify** — New suite PASS; run `tests/integration/m03-owner-onboarding-workerd.spec.mjs`, `tests/integration/m03-hosted-prebound-pilot-workerd.spec.mjs`, and affected Owner Product/Purchase/POS/Return integration tests.
- [ ] **Step 5: Commit / PR** — Coordinate with parallel M06/M07/M08 work. Require a two-Shop cross-tenant security review before any hosted binding activation.

## Task 6 — Existing Control Center Create/Resume and Shop detail (M03 UI PR)

**Files:**
- Modify: `src/m03-private-platform-auth-worker.js`, `frontend/platform-auth/platform-auth.js`, `frontend/platform-auth/index.html`, only minimal existing CSS
- Create: `tests/integration/m03-hosted-control-center-create-workerd.spec.mjs`
- Create: `qa/m03-hosted-control-center-create-page.spec.mjs`
- Preserve: current platform MFA, status roster, read-only Support Mode and browser setup

**Interfaces:**
- Consumes: Task 2 operation status, Task 3 verified readiness, Task 4 active roster and Task 5 Owner Shop session.
- Produces: existing `POST /api/platform/shops`, `POST /api/platform/shops/resume`, `GET /api/platform/shops/list`, and a scoped status/detail read; never returns provider secrets or arbitrary SQL.

- [ ] **Step 1: RED** — Create a second Shop from the UI, show separate progress stages, resume after a simulated network cut, withhold Ready until active binding verified, display safe quota/denial errors, and reject wrong Admin/expired MFA.
- [ ] **Step 2: Run** — `node --test tests/integration/m03-hosted-control-center-create-workerd.spec.mjs qa/m03-hosted-control-center-create-page.spec.mjs`; expected FAIL.
- [ ] **Step 3: GREEN** — Adapt existing Create/Resume/roster once to invoke private provisioner; show database health and last completed stage, but no per-shop Cloudflare config/UUID entry. Keep existing approved Gmail and Support Mode UI.
- [ ] **Step 4: Verify** — New tests + `qa/m03-control-center-provisioning-page.spec.mjs`, `qa/m03-hosted-support-visit-page.spec.mjs` and Admin MFA suites PASS.
- [ ] **Step 5: Commit / PR** — UI remains disabled when the private provisioning service/publisher isn't configured and verified.

## Task 7 — Shop access management and audit visibility (optional small MVP PR)

**Files:**
- Create: `src/auth/m03-platform-shop-controls.js`
- Create: `tests/integration/m03-platform-shop-controls-workerd.spec.mjs`
- Modify: `frontend/platform-auth/platform-auth.js` and relevant existing Control D1 tables only after schema ownership review
- Reuse: existing Owner approval/session revocation and read-only support audit

**Interfaces:**
- Consumes: current Admin MFA, existing Owner approval/membership and verified Shop placement.
- Produces: explicit `pauseShop`, `resumeShop`, `replaceApprovedOwner` operations, each auditable and idempotent; no database deletion or arbitrary finance access.

- [ ] **Step 1: RED** — Pausing a shop revokes Owner access without deleting D1; previous Owner Gmail/session cannot remain active after reapproval; wrong Shop/old MFA cannot change access.
- [ ] **Step 2: Run** — `node --test tests/integration/m03-platform-shop-controls-workerd.spec.mjs`; expected FAIL.
- [ ] **Step 3: GREEN** — Extend existing shop status and Owner approval contract only; display safe access/health/audit state in Shop detail.
- [ ] **Step 4: Verify** — New test plus Owner login and Admin MFA tests PASS.
- [ ] **Step 5: Commit / PR** — Separate from initial automatic database creation if it threatens the MVP critical path.

## Task 8 — Two-Shop integration, recovery and release gate (M03/M04/M10/M11)

**Files:**
- Create: `tests/integration/m03-hosted-two-shop-e2e-workerd.spec.mjs`
- Create: `qa/m03-control-center-two-shop-browser.spec.mjs`
- Modify: `docs/installation/START_HERE.md`, `docs/runbooks/M03_HOSTED_PREBOUND_PILOT.md`, `PROJECT.md` after owner approval
- Update relevant release checklists; do not silently promote or modify `hisabiq` public preview

**Interfaces:**
- Consumes: Tasks 1–6, optional Task 7, approved account-specific one-time Provisioner installation/credential procedure.
- Produces: signed release evidence showing two new Shop D1s, exact Owner identity/scope, setup/resume, binding publication and backup/restore/rollback acceptance.

- [ ] **Step 1: RED** — Full Workerd/browser scenario: existing Shop A retained; create B and C; duplicate Create; error after D1 create; replay; conflicting intent; wrong binding; same Gmail two memberships; failed version publish; quota exhaustion; disconnected provider; original Owner login and Shop activity log.
- [ ] **Step 2: Run** — `node --test tests/integration/m03-hosted-two-shop-e2e-workerd.spec.mjs qa/m03-control-center-two-shop-browser.spec.mjs`; expected FAIL.
- [ ] **Step 3: GREEN** — Complete only missing tests/glue and operator documentation; no new financial features. Require documented protected D1 exports and successful restore rehearsal, immutable Shop identity/migration receipts, and single-publisher deployment test.
- [ ] **Step 4: Verify** — All affected Workerd/D1, Playwright, source parity and GitHub CI pass at the exact head SHA. Independently confirm real protected Admin and Owner browser flows in an approved nonproduction account and cross-tenant denial.
- [ ] **Step 5: Commit / PR** — Obtain M03/M04/M10/M11 acceptance and explicit owner authorization **before** live Cloudflare create, schema, binding/version mutation or any financial GO decision. Preserve compatible rollback candidate and complete operation journal.

---

## PR order and review boundaries

1. **First, Task 1:** stop automated Owner Worker binding rollback; do not start dynamic shop creation before this is confirmed.
2. **Next, Tasks 2–4:** private provider + durable journal + pinned D1 migrations + one verified publisher, without Owner finance code.
3. **Then Task 5:** shared Owner Worker resolves multiple authorized Shop D1s. Coordinate with parallel M03/M06/M07/M08 before touching its route file.
4. **Next Task 6:** enable the existing Admin Create/Resume UI to use that verified backend.
5. **Finally, Task 8:** two-Shop proof, recovery and new-account documentation. Task 7 is additive only if its tests don't delay automatic onboarding.

Do not merge every phase into one giant PR. Every scoped PR requires source SHA, RED evidence, GREEN tests, independent review and human-approved merge; remote Cloudflare provisioning is gated again after code merge.

**Owner review requested:** Confirm that the design and phased implementation plan meet the intended no-per-shop-manual-setup workflow. No product implementation, SQL migration or deployment is performed by this planning PR.
