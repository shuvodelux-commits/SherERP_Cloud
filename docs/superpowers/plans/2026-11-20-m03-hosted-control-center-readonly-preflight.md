# M03 Run 5 — Hosted Control Center Read-only Preflight Implementation Plan

> **For agentic workers:** Use /super build → /super qa → /super review with test-first TDD, an isolated GitHub branch, and a separate independent reviewer. This run performs **no remote mutations**.

**Goal:** Prepare the real Cloudflare-hosted Control Center provisioning boundary by validating the current Cloudflare account, exact existing D1 identities, the private Admin/Owner Worker D1 bindings and the six pinned Owner-ready SQL files before requesting any deploy or remote migration approval.

**Architecture:** Add one Node-only, fail-closed hosted preflight module that reuses the validated portable instance and existing P2 **GET-only** Cloudflare resource verifier. Check the real documented Cloudflare Worker **GET script settings** endpoint for exact D1 binding identities, and SHA-256 hash the same six SQL migration files already approved by merged M03 #751. The only next-step output is a sanitized assessment with all mutating capabilities false; the authenticated private Control Worker, its deployment config and existing shop operations remain untouched.

**Tech Stack:** Node ES modules, native fetch (injected in tests), Cloudflare REST GET, SHA-256, Node test runner, existing M03 migration manifest.

**Spec / issue:** [M03 #22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22), [PORT-00 #699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699), [clean business #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690); follows merged [#751](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/751). Existing `scripts/port-p1-instance.mjs`, `scripts/port-p2-bootstrap-preflight.mjs`, `docs/installation/PORT_P2_PROVISIONING_AND_RECOVERY_DESIGN.md`.

## Twelve-sentence implementation overview

1. M03 #751 merged a complete six-step Owner-ready Shop migration profile, guarded behind an opt-in **local** flag.
2. Hosted provisioning is not complete because a Cloudflare D1 database must also be created, initialized, bound in an Owner Worker version, and published safely.
3. Creating a database is different from publishing a D1 binding through a new Worker version and deployment.
4. No such remote creation, SQL mutation, version upload or deployment is authorized by this request.
5. The next minimal safe delivery is an executable read-only preflight rather than an unfinished write-capable Cloudflare installer.
6. A validated portable instance will select the exact account and private Admin and Owner Worker names.
7. The preflight will reuse existing read-only account, Workers subdomain, Control D1 and pilot D1 checks without reimplementing them.
8. The two Worker script settings GET responses must prove the exact D1 binding UUIDs and reject swapped or duplicate bindings.
9. Non-D1 application bindings may remain, but unexpected D1 bindings fail closed in this fresh two-Shop rehearsal.
10. All six pinned SQL source files must be rehashed locally before any HTTP request, so changed migration bytes cannot be rehearsed.
11. Output will contain only safe status labels and explicit disabled flags, never account IDs, D1 IDs, secrets, email addresses or access tokens.
12. Future hosted Create/Resume must reuse the Control D1 immutable operation, a protected installer journal, private version promotion and SQL receipt verification under *separate* security and deployment approval.

## Global constraints / exclusive ownership

- Base `main@9591444b105af09487fc251a583b0f007bf74645` after merged #751. **One M03 owner** for these disjoint paths: `scripts/port-p2-hosted-control-center-preflight.mjs` (new), `tests/contract/port-p2-hosted-control-center-preflight.test.mjs` (new), this plan. No changed path overlaps current #752 M03 Cash Session, #748 M02, #753 M10, #755 M01.
- No changes to `src/**`, `frontend/**`, `migrations/**`, `staging-migrations/**`, `wrangler*`, `src/index.js`, GitHub workflows, production Cloudflare Worker, or original source.
- Only fixed GET requests may be issued, to `https://api.cloudflare.com/client/v4` with a token provided from the operator environment. Never log token, URL path IDs, response body or sensitive errors.
- Never perform a real HTTP request in this development run. Integration tests use injected synthetic fetch.
- Never grant deploy, D1 create, migration, Worker upload, activation or owner impersonation privileges. Every report has `allowRemoteWrites:false`, `allowDeploy:false`, `allowRemoteMigrations:false`, `ownerActivation:false`.
- No hosted or remote D1 changes until separate independent security approval, M10 backup/recovery approval, M11 release/deployment authority, and explicit user go-ahead.

## Review focus

1. Any non-GET method, redirected request or URL off Cloudflare's fixed origin must fail before network interaction.
2. A swapped Control/Pilot D1 binding, reused UUID, duplicate binding name, missing binding, wrong Worker response, or extra Shop D1 binding must fail closed.
3. A changed SHA-256 migration file must prevent all network calls, including the otherwise read-only checks.
4. An invalid token, denied Worker Settings API response, network error, malformed JSON or incomplete preflight must produce only a fixed non-sensitive rejection.
5. No returned status must falsely claim remote installation, migration, Owner readiness or production activation.

## Task 1 — RED → GREEN: exact six-step local source check

**Files:** new test and script.

- [ ] RED: node tests expect offline plan to count six pinned migrations, report no deployed readiness and redact identifiers; no implementation exists.
- [ ] Record expected error, then implement `planHostedControlCenterDryRun(instance)` with current `validatePortableInstance` and manifest.
- [ ] Add `verifyOwnerReadyMigrationFiles()` that rehashes exactly the six tracked migration files and throws a fixed error on mismatch; verify before remote GET requests.

## Task 2 — RED → GREEN: Cloudflare Worker GET binding proof

- [ ] RED: tests inject mock Cloudflare API responses for the existing four GET endpoints plus two Worker script settings GET endpoints, expecting six successful GETs and exact admin/owner D1 binding UUIDs.
- [ ] Implement `verifyHostedControlCenterReadOnly(instance,{token,fetchFn})`; reuse `verifyBootstrapReadOnly`, then verify `/accounts/{accountId}/workers/scripts/{worker}/settings` for both scripts.
- [ ] Assert no extra/missing/swapped D1 binding, token leak, fetched remote D1 rows, request body or non-GET methods. Return redacted state only.
- [ ] Add guarded CLI `--dry-run <manifest.json>` (offline only) and `--verify-readonly <manifest.json>` (GET only), without a create/deploy action.

## Task 3 — release evidence and approval

- [ ] Run fresh focused tests RED→GREEN, full local Node suite, original 84-file source check, unchanged frontend build and exact-head GitHub CI.
- [ ] Open one **draft** PR, record current exact-head CI and independent Super QA/Review status. Do not merge without owner approval.
- [ ] After **separate** security/release authorization, a later M03-owned PR may add a protected installer plus verified published Worker version/binding and six-step D1 migration execution. This PR is **not** that remote writer.
