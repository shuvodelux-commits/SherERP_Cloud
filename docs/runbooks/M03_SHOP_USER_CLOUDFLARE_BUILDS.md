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
   exact 13-step Shop migration receipt/snapshot. No live 0010/0011 SQL
   is required for this restricted core mode.
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
     has exactly nine expected `BLOCKED` reasons (six core flags, two
     missing Supplier migration phases, Supplier Pay disabled).
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
   or Supplier Cash Pay on this core profile — they remain OFF until the
   separately verified 0010+0011 schema extension is deployed.
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
