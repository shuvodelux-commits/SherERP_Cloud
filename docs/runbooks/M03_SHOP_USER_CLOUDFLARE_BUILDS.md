# M03 Owner ERP: Cloudflare Builds activation on shererp.hisab.workers.dev

**Status:** Safe, fail-closed **build/deployment configuration**, NOT evidence of live login, tenant activation or production ERP GO.
**Does not touch** the parallel `admin.hisab.workers.dev` Super Admin Worker, migrations, the public `hisabiq` preview, POS code or existing frontend source.

## What the earlier ENOENT meant

The deployed Cloudflare **Deploy command** was changed to
`npx wrangler@4.161.0 deploy --config wrangler.shop-user.jsonc`,
but that file did not exist in GitHub or in the build output. PR #816 generated a separate
ignored local P5 candidate in `.wrangler/portable-instance/`, not the deploy-time root config.

This change adds `scripts/build-shop-user-deploy.mjs` which **generates**
`wrangler.shop-user.jsonc` at the repository root during the **Cloudflare build**,
using only reviewed configuration values already placed in **Workers Builds variables**.
It deliberately does not check real Cloudflare/D1 identity by itself.
The generated file is `.gitignore`d and never committed with account IDs.

## A. Verify the Cloudflare account and data first

1. Verify the Cloudflare Workers account subdomain is exactly `hisab`; you own
   `shererp.hisab.workers.dev` and `admin.hisab.workers.dev` in that account.
2. The Super Admin setup must be complete, with a working Google/TOTP session and
   **Control D1**. This lane must not modify that Admin Worker.
3. In **Storage & databases → D1**, find **the existing Control D1** and **the
   existing first Shop D1**. Use their real names and UUIDs; do not create duplicates.
4. Confirm the Control D1 has approved onboarding / Owner Gmail tables and the shop's
   completed reservation/binding, and that the Shop D1 has its immutable `shop_identity`
   tuple with matching `shop_id`, `database_id` and `database_marker`.
   The Shop must be migrated and verified, not merely created. Record the provenance
   and migration/readback receipts privately. Do not run remote migration automatically.
5. Approve the **first Shop Owner Gmail** through the existing Admin flow, and register
   `https://shererp.hisab.workers.dev` as an exact **Authorized JavaScript origin**
   in Google Cloud for that Web OAuth client ID. No Google client secret is needed by
   the current popup/ID-token login.
6. Verify the chosen `shererp` Worker Build is the sole production deployment owner
   for that hostname; disable branch Preview builds on this Worker or keep them
   explicitly database-free. This build script refuses all non-`main` branches.

If any step is missing, **stop**. A generated config is not a safe authorization to
switch a live ERP database, create a shop, or post financial transactions.

## B. Enter configuration in the *Workers Builds* environment

Cloudflare Dashboard → **Workers & Pages → shererp → Settings → Builds** → build
variables/secrets (not the empty **Runtime variables and secrets** panel shown earlier).

| Variable | Required value or where to find it |
| --- | --- |
| `SHERERP_ACCOUNT_ID` | 32-character account ID of the **current** Cloudflare account |
| `SHERERP_CONTROL_DB_NAME` | Existing Control D1 database name |
| `SHERERP_CONTROL_DB_ID` | Exact UUID of that Control D1 |
| `SHERERP_SHOP_DB_NAME` | Existing first Shop D1 name |
| `SHERERP_SHOP_DB_ID` | Exact UUID of the first Shop D1 |
| `SHERERP_SHOP_ID` | **Existing** approved Shop UUID from Control onboarding, not the database UUID |
| `SHERERP_SHOP_MARKER` | Matching immutable `shop_identity.database_marker` UUID |
| `SHERERP_OWNER_GOOGLE_CLIENT_ID` | Existing Google Web OAuth client ID (`*.apps.googleusercontent.com`) |
| `SHERERP_OWNER_RATE_LIMIT_NAMESPACE` | Distinct positive numeric rate-limit namespace ID for the Owner Worker |
| `SHERERP_OWNER_LOGIN_RELEASE` | Set **exactly** `OWNER_LOGIN_ONLY_APPROVED` **only after verifying Steps A1–A6** |

Cloudflare Workers Builds injects `WORKERS_CI=1` and `WORKERS_CI_BRANCH=main`
on its production build. The generator checks both; it rejects missing values and
non-`main` builds. The account ID is also cross-checked against
`CLOUDFLARE_ACCOUNT_ID` if that environment variable is present.

These are *build-time* configuration values, **not** database credentials.
Never place any Google OAuth client **secret**, API token, Admin TOTP seed,
setup code, password, or Customer data in these variables. Keep the build
token restricted to the intended Cloudflare account and service.

## C. Replace the Cloudflare build command, keep deploy command

Under **Workers & Pages → shererp → Settings → Builds**:

**Production branch:** `main`. **Root directory:** `/`.

**Build command** (this is the missing operation):

```bash
npm run build:owner-frontend && node scripts/build-shop-user-deploy.mjs --generate
```

**Deploy command** (keep what you already entered):

```bash
npx wrangler@4.161.0 deploy --config wrangler.shop-user.jsonc
```

The generated root file contains:

- `name:shererp`, `main:src/m03-owner-redemption-worker.js`
- `assets.directory:dist-owner` with Worker-first routing
- `CONTROL_DB` and `PLATFORM_PILOT_DB` D1 bindings from validated inputs
- `OWNER_INGRESS` rate-limit binding
- `OWNER_AUTH_ORIGIN=https://shererp.hisab.workers.dev`
- `PLATFORM_AUTH_ORIGIN=https://admin.hisab.workers.dev`
- `PLATFORM_OWNER_CLIENT_ID`, exact shop ID and identity marker
- Enabled **only** first-owner approved-Gmail Google login and authenticated
  `/app` shell. **All business writes/financial posting and audit flags remain off.**
- `preview_urls:false`, no arbitrary public RPC and **no Admin MFA secrets**

**Important:** The generator can validate the *structure* of the values but
cannot independently prove that the account, bindings, data/owner identity
and migrations really exist. A green GitHub PR test is not a hosted acceptance.

If the build fails, inspect which variable is *missing* privately; the generator
prints only a generic blocker message rather than the account IDs.

## D. Acceptance once approved deployment succeeds

1. Visit `https://shererp.hisab.workers.dev` in a private browser window:
   the **Shop Owner sign-in with Google** page should replace mobile/password.
2. `https://shererp.hisab.workers.dev/app` without a session must redirect to
   the shop login, not show business data.
3. With the Admin-approved first Owner Gmail and correct D1 identity, Google
   verifies the ID token and creates the correct D1-backed Owner session.
4. The Owner sees the original ERP shell under `/app`; refresh retains the
   session, and logout revokes it. A different Google account is rejected.
5. Confirm wrong/disabled Shop, missing/mismatched D1 marker and revoked
   sessions fail closed. Verify same-origin cookies and two-Shop isolation.
6. **Do not enter live transactions**: Products/POS/Purchases/Returns/Finance
   remain gated in this profile. A later reviewed operational backend release
   must enable, test, and reconcile them separately. Staff login is also not
   implemented merely by this first-Owner deployment.

## E. QA, rollback and ownership

```bash
node --test tests/contract/shop-user-cloudflare-build.test.mjs tests/contract/port-p5-shop-user-login.test.mjs
npm test
npm run build:owner-frontend
```

Do not run `wrangler deploy` from GitHub Actions or another environment;
Cloudflare Workers Builds remains the single deployment owner. Avoid exposing
private D1 bindings to branch previews. If the authorized release fails, stop
new Owner login attempts and use the Cloudflare Worker deployment history
for a reviewed rollback to the previous known version. A Worker rollback is not
a database restore and cannot undo D1 writes. Do not delete or recreate D1.

## First hosted Shop — reviewed core-only acceptance release (21 November 2026)

**Use existing Workers Builds as the sole deployment owner.** Do not create
a second deploy job or use a manual Wrangler promotion while the one-Shop
Builds integration is active. The default login-only generated profile
remains unchanged.

The private, nondeploying candidate command is:

```sh
# Run only in the reviewed main worktree, with the live Worker version
# already read by wrangler versions view and D1 inspected read-only.
export SHERERP_ACCOUNT_ID="<same account selected in Wrangler>"
export SHERERP_FIRST_SHOP_CORE_APPROVAL=FIRST_SHOP_CORE_MVP_TEST_ONLY
node scripts/m03-first-shop-core-activation.mjs --prepare-from-version \
  <private-worker-version.json> <read-only-live-readiness.json>
npx wrangler versions upload --dry-run --strict --keep-vars \
  --config .wrangler/first-shop-activation/owner.core-only.candidate.jsonc
```

This outputs a mode-0600 private config and performs no remote write or
Worker upload/deploy. The candidate must preserve precisely the current
Control D1, first Shop D1, Owner Google origin, rate limiter, authenticated
Owner routes, assets and first-Shop immutable identity. It refuses changed
Shop/database identifiers, new or missing bindings, unsafe preview flags,
unknown feature flags, unverified baseline receipts and extra migration
requirements.

**Single-owner live release (separate operator approval, after CI):**

1. Confirm the current `shererp` deployment and database D1 bindings
   still match the read-only evidence. Backup **both** live D1 databases,
   restore both exports into isolated SQLite and require
   `PRAGMA integrity_check=ok`. Confirm existing Owner access and an
   exact 13-step Shop migration receipt/snapshot. The already-reviewed M08 Shop D1
   Supplier Cash 0010+0011 is now installed and the exact approved SQL overlay
   must verify; **do not rerun either migration**. The core release still
   keeps Cash Returns and Supplier Cash Pay OFF.
2. Merge the reviewed release PR with green tests. Before the next
   production build, add these three **production Builds-only** variables
   in Cloudflare Workers → `shererp` → Settings → Builds:
   - `SHERERP_FIRST_SHOP_CORE_RELEASE` =
     `FIRST_SHOP_CORE_MVP_TEST_ONLY`.
   - `SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT` = the exact full
     40-character GitHub **main SHA** approved for this release.
   - `SHERERP_FIRST_SHOP_CORE_READINESS_JSON` = the exact, identity-
     verified read-only report from
     `scripts/m03-live-owner-readiness.mjs`. This report intentionally
     now has exactly seven expected `BLOCKED` reasons (six core flags,
     Supplier Pay disabled), `approvedSupplierOverlayVerified:true`, correct
     immutable 13 receipts and verified exact SQL extension. For a genuinely
     unmigrated Shop the original nine-blocker baseline remains a distinct
     compatible report, but the migrated live Shop must use seven. Never
     copy the former report after a database migration.
   The report must not contain credentials, personal data or raw D1 IDs.
   These are **Build-time settings**, not Worker runtime secrets.
3. Trigger an approved **production** Cloudflare Build for that exact
   SHA. The existing build/deploy command remains the only publisher.
   Any other commit SHA, unknown Shop, invalid report or explicit release
   mode mismatch fails the build instead of silently deploying the old
   login-only profile over a financial pilot.
4. Independently read the **active** Worker version and verify Products,
   write grants, Purchase and POS Cash are `true`, but Cash Returns,
   Supplier Cash Pay, public RPC, support audit and Redemption stay OFF.
   Verify both D1 bindings and the Owner origin are unchanged.
5. The Owner must **sign out and sign in again** with their approved
   Gmail. New authenticated login publishes a fresh SQL-time, generation-
   fenced Shop D1 write grant; the historical disabled grant cannot
   authorize a save and must not be manually rewritten.
6. In the original Owner ERP perform a small, recognizable test:
   Create standard Product (zero opening stock), Create Supplier,
   Start Cash Session, Credit Purchase, one cash POS sale, then re-open
   Product stock, Supplier Purchase ledger, Invoice and Cash Book.
   Verify exact FIFO/cash/stock amounts and reload persistence. Test
   changed payment/return and negative paths. Do **not** test Cash Return
   or Supplier Cash Pay on this core profile — they remain OFF until their
   separate financial-feature release is approved and live tested, even
   though the reviewed SQL overlay is installed.
7. Preserve before/after D1 exports, active Worker version and CI SHA.
   On a validation failure roll the Worker **back** to the captured
   login-only version using Cloudflare's version rollback controls,
   remove the approval Build variables and retain financial data for
   reconciliation; do not delete immutable Shop identity, D1 receipt,
   grant generation or posted transactions.

Only a **single existing Shop D1** is in scope; this is an operator
acceptance test, **not** general production MVP, multi-Shop readiness or
approval to enable existing original Customer Due, full Finance, Bank,
Tiles, serial/bundle/multi-unit variants or general RPC. The private
Option A publisher, multi-Shop Owner resolver release, M10/M11 full
recovery and independent accounting/security acceptance remain separate.

Cloudflare documents `WORKERS_CI_COMMIT_SHA` as the current build SHA;
the release script relies on that protected commit pin and refuses an
unreviewed later `main` build.

### Live first-Shop Control D1 grant prerequisite — applied and verified

The hosted Control D1 installed the baseline authentication and Owner session
tables but **not** the two additive grant-fencing schemas required by
`OWNER_WRITE_GRANTS_ENABLED=true`. On 2026-11-21, before any Worker flag
flip, these already-reviewed source migrations were applied in order to
the **existing** `shererp-admin-control-v2` (not the Shop D1):

1. `staging-migrations/platform-owner-write/0009_owner_session_generation.sql`
   — SHA-256 starts `fcb3e1d0`.
2. `staging-migrations/platform-owner-write/0010_owner_grant_claim.sql`
   — SHA-256 starts `a8e86383`.

Operator evidence: fresh pre-write Control and Shop exports, isolated
SQLite restore with `PRAGMA integrity_check=ok`, exact source hashes,
absence of both grant tables before migration, offline rehearsal on that
Control export including a generated session generation and a blocked
revocation with pending grant claim. Real Cloudflare D1 then accepted both
migrations, and independent D1 readback found the two tables and all six
triggers. The existing one first Owner, one session and one Shop binding
remained; there are zero grants/claims until a fresh Owner login. The
post-migration Control export restored into isolated SQLite and passed
integrity, with 2 grant tables, 6 triggers and the original Owner session.

Private exports live only on the authorized CachyOS device at
`/home/shoaib/shererp-private-backups/2026-11-21-core-activation/` with
restricted permissions. Cloudflare D1 rejects remote `PRAGMA integrity_check`
(`SQLITE_AUTH`); the verified post-migration export's SQLite restore
provides the integrity evidence instead. No Customer/Shop D1 SQL write,
Owner grant mutation, test sale or Worker deployment occurred as part of
this Control grant-schema step.

**Do not rerun 0009 or 0010** against this Control D1: they are installed.
These are *Control D1* migrations, **not** the separate M08 *Shop D1*
Supplier Cash Pay 0010/0011 schema. That Shop extension has since been
installed and independently verified with the exact reviewed SQL overlay
on the first Shop (PR #843); do **not** apply either migration again.

### Reviewed Supplier SQL overlay and existing Builds permission — 2026-11-21

**The remote Shop schema has changed since the original nine-blocker
login-only preflight.** PR #843 was merged and its read-only verifier now
returns `approvedSupplierOverlayVerified:true` and exactly seven blocked
flags for the correctly migrated live Shop. The original 13 baseline
receipts remain immutable. The release builder accepts this seven-blocker
profile only when the cryptographic SQL overlay verification is true; it
rejects missing, unreviewed, partial and tampered evidence. This is still a
*core-only* release: Owner Cash Returns and Supplier Cash Pay remain OFF.

The 2026-11-21 read-only Cloudflare release rehearsal:

```sh
# Private files were created on the authorized operator PC using the
# active Wrangler Worker version and the read-only Shop D1 audit.
export SHERERP_FIRST_SHOP_CORE_APPROVAL=FIRST_SHOP_CORE_MVP_TEST_ONLY
# SHERERP_ACCOUNT_ID must match the already-authenticated Cloudflare account.
node scripts/m03-first-shop-core-activation.mjs --check-from-version \
  <private-active-worker-version.json> <private-readiness-report.json>
node scripts/m03-first-shop-core-activation.mjs --prepare-from-version \
  <private-active-worker-version.json> <private-readiness-report.json>
npm run build:owner-frontend
npx wrangler versions upload --dry-run --strict --keep-vars \
  --config .wrangler/first-shop-activation/owner.core-only.candidate.jsonc
```

The actual first-Shop overlay passed both the **check** and **prepare**
forms and compiled successfully with a Wrangler dry-run. The check mode
runs no D1 mutations, no Worker upload and no output config. It also
guards against ES module import cycles in the source CLI.

**Builds API access was explicitly checked:** the existing Wrangler OAuth
credential could read Worker and D1 metadata but received HTTP **403** on
the Builds configuration API. No permission elevation or token export
was attempted. Cloudflare requires a separate **user-scoped** API token
with **Workers Builds Configuration — Edit** (and Workers Scripts Read
for Worker-tag lookup) for API updates; see:
https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/

Until that permission is supplied, an account owner must set the three
protected production **Build-time** variables via Cloudflare Dashboard
under Workers & Pages → `shererp` → Settings → Builds. Do **not**
place a privileged token in GitHub, a public Worker var or a chat.
The `SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT` value must be the exact
merged, approved 40-character `main` SHA of the release and match the
automatically injected `WORKERS_CI_COMMIT_SHA`. The readiness JSON must
be refreshed against the currently active Worker and Shop D1 before
the production Build. Never bypass this SHA gate by running a separate
`wrangler deploy` while automatic Builds remains the release owner.


## 21 November 2026 — safe first-Shop core refresh after merged HisabIQ UI

**Status:** GitHub PR candidate, not a production deployment, database migration or release signoff.

**Observed mismatch:** GitHub `main@c002c8390adf1796880373672ca45d3723ebf159` includes the current HisabIQ Shell, Product Table, POS, Party, Settings and Dashboard, and local `npm run build:owner-frontend` embeds their controllers. The active `shererp` deployment (Cloudflare Worker version 70) was created **2026-11-20 21:35:25 UTC** and is older. Recent GitHub `Workers Builds: shererp` check runs have failed. The Cloudflare Builds API returns **403** for the currently authorized Wrangler OAuth; we cannot read the actual failing build log or edit protected production Build variables. The exact failing build stage (commit gate, quota, missing variables, or another error) requires the owner's Cloudflare Build History.

**Why simply moving the initial-release pin was unsafe:** the existing `FIRST_SHOP_CORE_MVP_TEST_ONLY` proof assumes a *pre-activation* Shop (seven disabled-feature blockers). The actual live authenticated Shop D1 and active Worker version 70 now report exactly **two** remaining disabled flags: `OWNER_MVP_CASH_RETURN_ENABLED` and `OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED`. Reusing seven old blockers would be falsifying current evidence. Deploying the login-only fallback would disable working Product/Purchase/POS functionality.

A separate, opt-in protected release value `FIRST_SHOP_CORE_MVP_REFRESH` now accepts **only** the current verified two-blocker report, with `authConfigured=true`, exact immutable Shop D1 identity, original thirteen receipt/schema seal, cryptographically approved Supplier Cash overlay, `coreReadConfigured=true`, `coreWriteConfigured=false`, `supplierCashConfigured=false`, and all five outstanding release checks. The generated runtime retains identical existing single-Shop D1 bindings, business IDs/markers, Owner Google origin, rate limiter and core flags; Cash Return, Supplier Pay, support audit and Redemption remain **OFF**. It still rejects wrong branch, unapproved SHA, stale/wrong report, extra flags and private publisher takeover. This is **not** approval to enable multi-Shop, any new financial operation, or public RPC.

### Required protected production Cloudflare Builds update — owner-operated

1. Check the most recent failing **Workers Builds: shererp** check and open its **Details → Build log**. This is necessary to distinguish the protected SHA gate from Cloudflare build-minute limits or unrelated installer/permission errors. Do not infer the error solely from the GitHub summary.
2. Confirm Cloudflare **Workers & Pages → shererp → Settings → Builds** is connected to `shuvodelux-commits/SherERP_Cloud`, branch `main`, root `/`. Leave the existing build/deploy commands unchanged:

   ```bash
   npm run build:owner-frontend && node scripts/build-shop-user-deploy.mjs --generate
   npx wrangler@4.161.0 deploy --config wrangler.shop-user.jsonc
   ```

3. First confirm read-only that the current active Worker is still bound to `CONTROL_DB` (existing `shererp-admin-control-v2`) and `PLATFORM_PILOT_DB` (existing `shererp-shop-001`). Verify the same Shop ID/immutable marker and Owner login. **Do not create D1, rerun migrations, switch account, delete Shop data or manually promote a different Worker publisher.** Before approved production promotion, preserve an independent existing Control/Shop D1 restore-tested backup and a rollback version, and require the repo's M10/M11 controls.
4. After the refresh PR merges and GitHub required tests are green, obtain the **new current, full 40-character `main` SHA**. Never copy the dated diagnosis SHA above or the branch commit SHA to the protected variable. Rerun the existing read-only `scripts/m03-live-owner-readiness.mjs --version <currently active Owner Worker version UUID> --shop-db shererp-shop-001`. A process exit code 2 and status `BLOCKED` are expected for the **exact two intentionally OFF flags**; do not ignore any other blocker. The JSON is non-identifying and contains no credentials.
5. In **production Builds Variables and Secrets** (not Runtime Variables, and not GitHub Secrets), replace exactly these protected values, keeping all existing IDs and other variables unchanged:

   | Variable | Verified new value |
   | --- | --- |
   | `SHERERP_FIRST_SHOP_CORE_RELEASE` | `FIRST_SHOP_CORE_MVP_REFRESH` |
   | `SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT` | full GitHub `main` SHA **after** this PR merges |
   | `SHERERP_FIRST_SHOP_CORE_READINESS_JSON` | fresh, successful read-only **two-blocker** report from the currently active Worker/Shop D1 |

6. Trigger or retry **one approved production build for that exact SHA** through Cloudflare's existing Builds integration. If the check still fails, inspect its Cloudflare log and fix the *specific* reported error; do not replace the protected release with login-only, remove the SHA gate, edit Worker runtime database bindings, or use a second manual `wrangler deploy`.
7. After it succeeds, read Cloudflare's active Worker version and compare it with the newly built version, runtime flags and both D1 bindings. Sign out and sign back in as the approved Shop Owner. Reopen `https://shererp.hisab.workers.dev/app` and verify the updated HisabIQ Shell, POS, Product Table, Party and Dashboard at desktop/mobile widths. Check existing Product/Supplier/Purchase/POS session flows without enabling new finance features; keep M10/M11 production NO-GO until approved acceptance.

**Parallel UI dependency:** PR [#882](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/882) already owns the Dashboard/Sales Invoice source-readiness and unsupported-RPC protocol. It must pass review and merge before accepting a UI release. The refresh lane deliberately **does not** edit its shared Dashboard compiler, Worker endpoints, Owner frontend, tests, Sales views, or `PROJECT.md`. The separately diagnosed post-merge string mismatch is not claimed as corrected by this release-gate PR.

**Local evidence:** `npm run build:owner-frontend` successfully compiled all five current HisabIQ controllers, and a *strict, local-only* Wrangler Worker dry-run was constructed from the actual active Worker bindings and current two-blocker D1 report. The candidate's D1 IDs, Owner runtime variables and enabled/disabled flag set were independently compared with the active version and matched. No Cloudflare code upload, release promotion, data mutation or Build-API variable update was made. This proves candidate integrity, **not** hosted deployment.
