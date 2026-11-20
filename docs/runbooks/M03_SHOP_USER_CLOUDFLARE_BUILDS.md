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
