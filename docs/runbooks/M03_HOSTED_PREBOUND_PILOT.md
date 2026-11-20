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
