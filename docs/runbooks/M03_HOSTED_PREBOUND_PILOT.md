# M03 — Connect the existing Control Center to one hosted Shop D1

This is a **single prebound pilot shop**, not dynamic multi-tenant provisioning.
It reuses the existing M03/M04 Admin Google+MFA, PORT-P4
Create/Resume/list/Owner approval, PORT-P5 Owner Gmail login, and original
ERP Owner frontend. No new Shop D1 is created by an HTTP request, and
**financial writes remain disabled**.

## Exact staging resources

- Admin: `https://admin.hisab.workers.dev` → Worker `admin`
- Shop Owner: `https://shererp.hisab.workers.dev` → Worker `shererp`
- Control D1: `shererp-admin-control-v2` (existing Admin and MFA preserved)
- Shop D1: `shererp-shop-001` (one new, previously empty Shop)
- The **Shop UUID and marker** are generated once, stored only in the
  ignored `.wrangler/hosted-pilot/identity.json`, and must match on both
  Worker deployments and inside the immutable Shop D1 identity row.

## What exists in code

1. Existing signed-in platform Admin routes accept a shop display name and
   approved Owner Gmail, with one idempotent operation ID.
2. The new opt-in, in-process `attachHostedPilot` supplies the **same**
   reviewed PORT-P4 provider interface for exactly one *already bound*
   physical D1. It performs no Cloudflare API calls and no runtime DDL.
3. The owner-ready Shop migration plan consists of the original 13 pinned
   SQL source files. The private generator verifies source SHA-256 digests,
   composes migration files, and writes their receipt checkpoints. The
   original four platform-auth SQL migrations and nine platform-onboarding
   SQL files are also reused, with noncolliding names.
4. The existing SQL-ready trigger publishes the Shop binding and approved
   Owner Gmail **only after** Shop identity, D1 binding and 13/13 migration
   checkpoints match. No approval is published at reservation time.
5. The existing Owner Worker authenticates the exact approved Google Gmail,
   creates the immutable first Owner and D1 session, and serves the
   original Owner ERP through its protected `/app` route.

## One-time release procedure (staging, under one deployment owner)

- Verify GitHub source SHA, active Cloudflare account, both D1 IDs, and
  that this Shop D1 contains no previous business data.
- Make private Control D1 and Shop D1 exports; **restore them** to isolated
  SQLite and confirm integrity before schema changes.
- Run local Workerd/D1 tests. Generate private migrations with
  `node scripts/m03-hosted-pilot-migrations.mjs --generate
  .wrangler/hosted-pilot/identity.json .wrangler/hosted-pilot/migrations`.
- Use the account-specific ignored release profile, never checked-in
  public-preview settings. Apply only the nine new Control D1 migration
  names and the thirteen empty-Shop reviewed migrations, then read back
  the immutable Admin/MFA counts and the Shop checkpoint/snapshot.
- Deploy the reviewed Admin Worker with the correct Control/Shop D1
  bindings, `PLATFORM_HOSTED_PILOT_ENABLED=true`,
  `PLATFORM_SHOP_RESERVATION_ENABLED=true`,
  `PLATFORM_SHOP_DIRECTORY_ENABLED=true`; **preserve the already installed
  Admin bootstrap and factor-encryption Cloudflare secrets**.
- Deploy the reviewed original Owner Worker to the **existing** shop-user
  Worker URL with those same D1 bindings and pilot tuple.
  `OWNER_LOGIN_ENABLED`, `OWNER_GMAIL_SIGNUP_ENABLED` and
  `OWNER_DASHBOARD_BOOTSTRAP_ENABLED` may be enabled only after DB
  verification; all product, sale, purchase, return and write-grant flags
  remain off.
- In Google Cloud Console, the same Web client ID must allow **both**
  `https://admin.hisab.workers.dev` and
  `https://shererp.hisab.workers.dev` as Authorized JavaScript origins.

## What the operator does in the browser

1. Sign in to **Admin** with the existing Google account and MFA.
2. Enter **Business name** and **Owner Gmail**, then choose **Create
   business**; use the generated single operation ID on retries.
3. If the record remains `Reserved` or `Allocating`, use **Resume
   setup**, not Create again. Only `Setup ready` is approved.
4. Open the existing **Shop URL** and choose Google sign-in using the exact
   approved Owner Gmail address. On first verified sign-in, the Owner
   receives the immutable initial Owner record; later logins restore
   their Owner session and original frontend.
5. Refresh Admin to see the same Shop in the status directory.
   This pilot can create **one** business only. A second registration is
   refused; it never reuses the Shop D1 for a second tenant.

## Boundaries, security, rollback

- Static HTML does not grant privileged access; protected Admin APIs
  require current MFA-backed D1 sessions and Owner routes require
  nonce-bound Google + a D1-bound Shop identity.
- Keep `PLATFORM_HOSTED_PILOT_ENABLED` off unless the Shop database
  is correctly bound and **all 13 owner-ready SQL receipts match**;
  otherwise the Create/Resume capability fails closed.
- This enables **Owner login and ERP shell**, not production financial
  posting. The Super Admin's separate read-only Support Mode and dynamic
  provisioning for later shops still require independent releases.
- Preserve the previous Admin deployment version, previous Shop Worker
  version, private authenticated exports, approved source commit and
  `identity.json`. Roll back the Worker code/flags if any hosted check
  fails; never delete the immutable identity or migration ledger to
  force a retry. Review competing Cloudflare Builds before merging
  further PRs, or an older public Worker may redeploy over the Shop.
- Production go-live still requires M10/M11 backup/recovery and financial
  acceptance. Do not enable POS, returns, ledger, purchases or public RPC
  merely because authentication is working.

## Option A phase 0 — private deployment ownership preflight (2026-11-21)

The existing `shererp` Workers Builds setup still generates a **one-Shop-only**
`wrangler.shop-user.jsonc` and may promote it on a GitHub merge. This
cannot safely coexist with automatic D1 binding publication. Before any new
Shop D1 becomes active, a **single private deployment publisher** must own
the `shererp` Worker version and preserve every existing D1 binding.

The new **pure, nonpublishing** preflight is
`assertPrivateOwnerDeployOwnership` in
`scripts/m03-private-deploy-owner-guard.mjs`. It refuses an unknown
Cloudflare account, Worker name, release SHA, wrong branch, missing Control
D1, changed or deleted Shop D1, duplicated Shop binding/ID, and any
Cloudflare Builds command other than an exact nonpromoting
`npx wrangler@4.161.0 versions upload --config wrangler.shop-user.jsonc`.
It requires the reviewed code SHA and the existing full Shop binding
roster; it **does not** claim to read Cloudflare state or deploy a Worker.

**One-time account handoff, only after the trusted publisher is ready:**

1. Back up and verify the current `shererp` release version, exact D1
   bindings, Control/Shop identities, approved Owner login and the complete
   existing tenant roster. Confirm `admin` Google+MFA and Owner ERP login
   remain working.
2. In Cloudflare **Workers & Pages → shererp → Settings → Builds**,
   use a **nonpromoting** deploy command
   `npx wrangler@4.161.0 versions upload --config wrangler.shop-user.jsonc`
   instead of `wrangler deploy` or `wrangler versions deploy`.
   Do not change account secrets or existing D1 bindings.
3. Set protected Builds variable
   `SHERERP_DEPLOYMENT_OWNER=PRIVATE_PROVISIONER` **after** the private
   publisher has been reviewed and a compatible candidate verified.
   This makes the legacy one-Shop generator refuse to regenerate and
   promote an incomplete roster; from that point Builds should use
   a new publication-owned *immutable full-binding release profile*.
4. All Worker version promotions must go through that single publisher
   with **readback** verification, safe retries and rollback. No new Shop
   may be marked Ready until the active Worker itself proves its binding.

Until the publisher and Task 4 roster implementation are present, **do
not enable that protected variable on the currently working Owner Worker**.
The Phase 0 tests establish the safety contract, not the real-world Builds
configuration. A green PR and a Cloudflare version upload are not approval
to activate new Shop databases or financial write endpoints.

## Reviewed first-Shop Supplier Cash schema overlay — 2026-11-21

The hosted pilot's original **13** owner-ready migration receipts must
remain intact. M08's already merged, additive 0010 Supplier Cash Pay and
0011 Cash Close reconciliation change the SQL schema, so the old exact
13-step schema-snapshot equality rejects the upgraded Shop until the
reviewed extension verifier is published.

The isolated M03 schema-seal change permits the **existing first-Shop
prebound pilot only** to recognize exactly 14 added SQL objects and the
reviewed replacement of `owner_mvp_cash_close_guard`. It compares the
Shop's own original receipt snapshot with its current D1 `sqlite_schema`
and pins every changed object's type, owning table and normalized SQL
SHA-256. It rejects 0010 alone, unknown tables/triggers, a forged Cash
Close trigger, wrong immutable Shop identity and stale baseline receipts.
The original 13 receipts are never edited, and the generic Option A
multi-Shop schema revision is not broadened.

The first-Shop operational overlay is **not an instruction to run remote
SQL now**. The two current Cloudflare databases were exported privately
and both backups restored with `PRAGMA integrity_check=ok`; migrations
0010→0011 succeeded on an isolated Shop backup. Before applying any
remote migration, complete the single-publisher handoff, exact-worker
readback, approved backup/roll-forward/rollback rehearsal, independent
M08 financial review and CI, then explicitly approve the release.
Do not enable `OWNER_WRITE_GRANTS_ENABLED` or financial feature flags
merely because the new schema passes its identity/DDL verifier.
