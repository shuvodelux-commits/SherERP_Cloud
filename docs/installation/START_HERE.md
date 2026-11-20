# SherERP Cloud — Complete New-Account Setup Guide

**One document: GitHub → Cloudflare → D1 → Google sign-in → Super Admin → Shop Owner frontend → business creation → verification.**

> **Important status — 20 November 2026.** This guide describes both the **steps that work now** and the **steps the project must finish before a real installation**. The repository is an MVP under development, **NOT a ready-to-install production financial ERP**. In particular, first-Super-Admin operational bootstrap, private hosted Worker promotion, dynamic Shop D1 onboarding, the fully connected Owner ERP, and M10/M11 financial/recovery release approval are **not complete**. A successful Worker build is not permission to use it for live transactions.
>
> **Source reviewed:** `shuvodelux-commits/SherERP_Cloud`, GitHub `main` at `e81e243b94ff7712ae6c42392ae4fc4c763faf8d`. Newer commits may change commands or gates; verify the latest `PROJECT.md`, `AGENTS.md`, issue [#699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699), onboarding [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), and release [#306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306) before any hosted changes.
>
> **Scope:** a **NEW, EMPTY, DISPOSABLE** Cloudflare account/business pilot. Moving historical business data is a different, protected migration; do not use this guide to migrate financial records. Nothing here authorizes edits to the original Google Apps Script/Sheets, remote business SQL, or production Worker releases.

## How to read this guide

Every stage shows one of three labels:

- **SAFE NOW** — local preparation, configuration checking, Google/Cloudflare dashboard preparation, and read-only verification. You may follow these after choosing an isolated account.
- **CONTROLLED CLOUD SETUP** — deliberately creates new, EMPTY resources in the account you selected. This changes that account and should only be done when you intend to use it for a disposable pilot. It does not enable real ERP financial operations.
- **STOP / RELEASE GATE** — the repository does **not yet** supply a reviewed, end-to-end operator workflow. The section explains exactly what must be implemented/verified. Do not invent missing SQL, make an unprotected Worker public, or change disabled flags to force progress.

**End-state goal:** from the same reviewed GitHub release, connect a new Cloudflare account; configure two separate private Workers and two D1 databases; securely enroll the first administrator; create two shops; and run accurate, isolated ERP transactions. This end-state is **not yet achieved**.

### Quick installation map

| Stage | You will obtain | Today |
| --- | --- | --- |
| 1. GitHub | One source repository and pinned release | **SAFE NOW** |
| 2. Local tools | Node, npm, Wrangler; successful build/checks | **SAFE NOW** |
| 3. Cloudflare account | Account ID and `workers.dev` namespace | **SAFE NOW** |
| 4. Empty D1 databases | Control D1 ID and one disposable Shop D1 ID | **CONTROLLED CLOUD SETUP** |
| 5. Google | OAuth Web client ID; authorized Admin and Owner origins | **SAFE NOW** |
| 6. Admin authentication | Select Google/TOTP or the existing Access profile | **SAFE NOW** (verify before publishing) |
| 7. Instance configuration | Validated ignored JSON and disabled Worker drafts | **SAFE NOW** |
| 8. Platform schema / first administrator | Versioned migrations, single-use setup ticket, MFA | **STOP / RELEASE GATE** |
| 9. Deploy private Admin Worker | Authenticated Control Center | **STOP / RELEASE GATE** |
| 10. Deploy Owner frontend/Worker | Owner Gmail sign-in and correctly scoped shop | **STOP / RELEASE GATE** |
| 11. Add business | Real provisioned Shop D1, Owner, tested ERP | **STOP / RELEASE GATE** |
| 12. Go live | Exact accounting + restore + security signoff | **STOP / RELEASE GATE** |

## Part A — Prepare the new installation

### Step 1 — Start with the correct GitHub repository (SAFE NOW)

1. Sign in to [GitHub](https://github.com/).
2. Open [SherERP_Cloud](https://github.com/shuvodelux-commits/SherERP_Cloud).
3. Use **the repository and a reviewed commit/tag**, not a screenshot or exported UI-only copy. If installing under another GitHub identity, fork the repository **only if needed** and keep it synchronized with the reviewed upstream. Avoid two independent source-of-truth copies.
4. On GitHub, inspect **Actions**, **Pull requests**, and [PROJECT.md](../../PROJECT.md). Do not select an unfinished PR branch as the installation release.
5. Record the selected commit SHA in your private installation notes. Keep the same SHA throughout the installation rehearsal.

**Expected:** you can identify exactly which code version you intend to install.

**If you cannot access the repo:** ask the repository owner for authorized GitHub access. Do not replace it with an old ZIP or remake the frontend.

### Step 2 — Prepare your CachyOS/Linux computer (SAFE NOW)

These examples use **Bash**. Node.js **22 or later** is required by `package.json`; use the repository's existing lockfile, not an unreviewed dependency upgrade.

```bash
node --version
npm --version
git --version
git clone https://github.com/shuvodelux-commits/SherERP_Cloud.git
cd SherERP_Cloud
git rev-parse HEAD
npm ci
npm run verify:source
npm run build:frontend
npm run build:owner-frontend
```

If the repository is already cloned, **do not clone over the existing directory**. Instead run `git status` and `git pull --ff-only` only when its worktree is clean and you intend to move it to the reviewed `main` commit.

To verify the checked-in portability logic, run:

```bash
node --test tests/contract/port-p1-instance.test.mjs
node scripts/port-p0-inventory.mjs --check
```

**Expected:** `dist/` contains the original compiled public frontend, `dist-owner/` contains the separate Owner frontend, and no Cloudflare resources were created. These generated directories are Git-ignored. A locally successful build does **not** prove the business API is connected.

**If a command fails:** stop, capture the exact non-secret error, and fix that issue through GitHub/CI. Do not continue to a private deploy.

### Step 3 — Create or select the Cloudflare account (SAFE NOW)

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Sign in to the **new account**, not the previous account that exhausted its build allowance.
3. Open **Workers & Pages** (Cloudflare menu labels can change). Find the account's default **Workers.dev subdomain** under Worker settings/subdomain management.
4. Record the new Cloudflare **Account ID**. It is normally a 32-character hex string; copy it from the account dashboard, **not from the old project's Wrangler files**.
5. Select two distinct Worker names, for example `admin-shererp` and `owner-shererp`. Check that they are available in this account.
6. Record the intended Admin authentication mode in Step 7.

Your example addresses will look like:

```text
https://admin-shererp.YOUR-SUBDOMAIN.workers.dev
https://owner-shererp.YOUR-SUBDOMAIN.workers.dev
```

**Important:** `YOUR-SUBDOMAIN` is your account's exact Workers.dev namespace, not a freely chosen standalone `hisabiq.workers.dev`. A custom domain is **not required** to start.

**Expected:** you have the account ID, Workers.dev namespace, two intended Worker names, and two exact HTTPS origins.

### Step 4 — Create TWO empty D1 databases (CONTROLLED CLOUD SETUP)

**Do this only in the approved new, disposable account. Do not import real customer, stock, sales or finance data.**

1. In Cloudflare Dashboard, open **Storage & Databases → D1 SQL Database** (or the account's equivalent **D1** menu).
2. Click **Create database**.
3. Use a new name such as `shererp-control`. Create it in your intended account.
4. Open the created database and record its exact **Database ID (UUID)** and name.
5. Repeat for a separate empty database, for example `shererp-test-shop`, and record its distinct UUID.
6. Do **not** start adding tables manually in the dashboard SQL editor. The final schema must come from reviewed, versioned migrations.

You can also create an empty database using Wrangler after confirming the active account:

```bash
npx wrangler@4.161.0 login
npx wrangler@4.161.0 whoami
# Changes the ACTIVE Cloudflare account — only for an approved empty pilot:
npx wrangler@4.161.0 d1 create shererp-control
npx wrangler@4.161.0 d1 create shererp-test-shop
```

**Use EITHER the dashboard OR the CLI; do not do both for the same database names.** If `whoami` identifies the wrong account, stop and switch accounts first. Creating a D1 is a remote mutation; the command block is an operator example, not something this guide or agent has executed.

**Expected:** two distinct existing D1 UUIDs belonging to the **new** account. The Control D1 is for platform identity/provisioning, and each Shop D1 stores one business's ERP data. Neither database is yet ready to run real sales.

### Step 5 — Choose a new Shop ID, identity marker and rate-limit IDs (SAFE NOW)

The current portable pilot manifest requires **two additional UUIDv4 values** besides the D1 IDs:

- `shopId` — the intended new Shop identity.
- `marker` — an independent immutable Shop binding marker.

Generate these **locally**; do not copy existing shop identities or choose the database UUID as the marker:

```bash
node -e "const {randomUUID}=require('node:crypto'); console.log('shopId = '+randomUUID()); console.log('marker = '+randomUUID())"
```

For rate limiting, choose **two distinct positive numeric strings** for this account, such as `"1001"` and `"1002"`, provided they are not already used for other rate-limiting bindings you want isolated. They are **binding namespace identifiers you define**, not D1 database IDs. See [Cloudflare Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

**Expected:** separate Control DB UUID, Shop DB UUID, Shop ID, marker, and distinct rate-limit namespace values. Do not share them between purposes.

### Step 6 — Set up Google sign-in (SAFE NOW)

The current SherERP private pages use **Google Identity Services ID-token sign-in** (`google.accounts.id`) in a browser popup, then verify the ID token on the Worker. **Do not add a client secret or JWT secret just because a generic OAuth tutorial suggests one.** The checked-in code uses a **Web client ID**, exact origins, server-side Google token verification, and separate platform MFA.

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create a Google Cloud project for **this installation**.
3. Open **Google Auth Platform**. Fill in the app **Branding** and, if requested, **Audience** information. If the app is in test mode, add only the intended Super Admin/Owner Google accounts as test users where Google requires it.
4. Open **Clients → Create client → Web application**.
5. Name it clearly, for example `SherERP New Account Pilot`.
6. Under **Authorized JavaScript origins**, add **both exact origins** from Step 3:
   - `https://admin-shererp.YOUR-SUBDOMAIN.workers.dev`
   - `https://owner-shererp.YOUR-SUBDOMAIN.workers.dev`
7. For the current **popup ID-token** flow, there is no app redirect callback in the checked-in browser implementation. Do **not** invent a redirect URI; add one only if a later approved release actually implements a redirect-based authorization flow.
8. Save and copy the **Client ID** ending in `.apps.googleusercontent.com`.

**KISS pilot:** one Google Web client ID can serve both origins because the current P1 generator has **one** `googleClientId` field and uses it in both private Worker drafts. Do not silently replace it with two different client IDs without updating and re-testing that contract.

**Expected:** Google client ID and authorized JS origins match the two private Worker HTTPS URLs character for character (no paths or trailing slashes in an origin).

**If Google says origin not allowed:** verify the Worker name, Workers.dev subdomain, HTTPS scheme, client ID, consent/testing-user configuration and browser popup settings. Official reference: [Google Identity Services Web client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

### Step 7 — Select Super Admin authentication (SAFE NOW, before any live publish)

For Google/TOTP without Zero Trust, set `"adminAuthMode": "google-totp-without-access"` in the ignored instance manifest in Step 8. Continue with the Google origins from Step 6 and the [Google/TOTP prerequisites](PORT_P1_LOCAL_CONFIGURATION.md) for the approved-operator subject, setup ticket and factor initialization. Use the following Access steps only if you choose the Access profile.

1. In the correct Cloudflare account, open **Zero Trust → Access controls → Applications** (menu names may vary).
2. Create a **Self-hosted** application protecting the intended **entire Admin Worker**, preferably by **Worker destination/name** if that is the supported account UI. Do not protect only the root page and accidentally leave `/api/platform/*` or `/platform-auth.js` public.
3. Create an **Allow** policy that identifies **only your intended platform operator email**. Do not use `Everyone`, `Bypass`, or a broad email-domain rule.
4. Use an authentication method supported by your account (for example Google or an approved one-time-pin identity provider). Verify the **email identity returned by Access**, not merely an allowed login screen.
5. Record the Access application's **audience (AUD) tag** privately for `PLATFORM_ACCESS_AUDIENCE`.
6. Record the exact approved operator email, lowercased, for `PLATFORM_ACCESS_EMAIL`.
7. Confirm no conflicting/bypass policies expose this Worker. If you cannot attach Access to a Worker before publication, **do not make the Admin Worker accessible** until a separately reviewed safe release order is available.

**Expected after an authorized private deploy:** unauthenticated and wrong-user requests are rejected for `/`, `/platform-auth.js`, `/platform-auth.css` and `/api/platform/auth/session`. Only a valid Access identity reaches the *separate* Google/MFA sign-in layer.

The runtime `src/m03-access-platform-auth-worker.js` explicitly checks `ctx.access.aud`, `ctx.access.getIdentity()`, approved email, and exact `PLATFORM_AUTH_ORIGIN`. A normal password login or an HTTP header alone cannot substitute for Access identity. See [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).

## Part B — Prepare reusable local configuration

### Step 8 — Fill in the instance manifest (SAFE NOW)

The repository already contains **one** invalid-on-purpose example:

```text
docs/installation/INSTANCE.example.json
```

Copy it into the Git-ignored private area:

```bash
mkdir -p .wrangler
cp docs/installation/INSTANCE.example.json .wrangler/instance.json
nano .wrangler/instance.json
```

Replace **every** placeholder with the values collected above:

| JSON field | Exact value to put there |
| --- | --- |
| `formatVersion` | Leave as `1` |
| `accountId` | New Cloudflare account ID, **32 lowercase hex characters** |
| `workersSubdomain` | Namespace before `.workers.dev` |
| `workers.admin` / `workers.owner` | Two different Worker names |
| `origins.admin` / `origins.owner` | Exactly `https://<worker>.<subdomain>.workers.dev` |
| `googleClientId` | Web client ID from Google |
| `d1.control.name` / `d1.control.id` | New Control D1 name and UUID |
| `d1.pilot.name` / `d1.pilot.id` | New disposable Shop D1 name and UUID |
| `d1.pilot.shopId` | New Shop UUIDv4 |
| `d1.pilot.marker` | Different new marker UUIDv4 |
| `rateLimits.adminNamespaceId` / `ownerNamespaceId` | Different numeric strings, e.g. `"1001"`, `"1002"` |

**Never insert** a Cloudflare API token, Google client secret, Access token, TOTP seed, customer record, or private backup into `.wrangler/instance.json`. The manifest is for IDs/metadata and is already covered by `.gitignore`; still treat your private machine and backups carefully.

**Expected:** one local JSON file with no `REPLACE_WITH_...` placeholders.

### Step 9 — Validate and generate the disabled Worker drafts (SAFE NOW)

From the repository root:

```bash
node scripts/port-p1-instance.mjs --check .wrangler/instance.json
node scripts/port-p1-instance.mjs --generate .wrangler/instance.json
```

Expected message(s) include:

```text
P1 local manifest valid; deployment, authentication and Cloudflare account verification pending
P1 ignored local config drafts generated; no deploy or resource changes
```

Generated local files:

```text
.wrangler/portable-instance/admin.generated.jsonc
.wrangler/portable-instance/owner.generated.jsonc
```

Inspect them locally, especially `account_id`, `name`, `main`, origins, `CONTROL_DB`, `PLATFORM_PILOT_DB`, and the rate-limit bindings.

**Critical:** these are **INACTIVE DRAFTS**, not release profiles:

- `workers_dev: false` and `preview_urls: false`.
- `remote: false` for D1 bindings.
- Admin reservation/binding/Owner invitations disabled.
- Owner redemption/login/product writes disabled.
- Access audience/operator and TOTP settings **not** added.

Repeated generation with unchanged values is safe; if you edit the manifest, the script **refuses to overwrite mismatching old generated files**. Review the change and securely archive/remove the obsolete ignored drafts before regeneration. **Do not change source code to accommodate a new Cloudflare account.**

### Step 10 — Run local + optional Cloudflare READ-ONLY preflight (SAFE NOW)

Start with the offline plan:

```bash
node scripts/port-p2-bootstrap-preflight.mjs --dry-run .wrangler/instance.json
node scripts/port-p2-hosted-control-center-preflight.mjs --dry-run .wrangler/instance.json
```

Expected: a report showing `allowDeploy: false` and `allowRemoteMigrations: false` (the first script also lists remaining gates). A successful dry run does **not** prove the listed Cloudflare resources are yours.

To verify **existing account/subdomain and two D1 identities**, use a **read-only, narrowly scoped Cloudflare API token**, if separately approved. Do not paste it into commands saved in shell history:

```bash
read -rsp "Cloudflare read-only API token: " CLOUDFLARE_API_TOKEN
echo
export CLOUDFLARE_API_TOKEN
node scripts/port-p2-bootstrap-preflight.mjs --verify-readonly .wrangler/instance.json
unset CLOUDFLARE_API_TOKEN
```

The first read-only validator requests account identity, Workers subdomain, Control D1 metadata and pilot Shop D1 metadata with GET only. It rejects mismatching IDs or denied permissions.

**Do not confuse the two checks:**
- `port-p2-bootstrap-preflight.mjs --verify-readonly`: works once **both existing D1s** and account identity can be read.
- `port-p2-hosted-control-center-preflight.mjs --verify-readonly`: additionally requires **already deployed, reviewed Admin/Owner Workers and exact bindings**, plus verified migration-file digests. It should **fail** before private Workers are correctly deployed. Its success still **does not** grant permission to create databases, migrate remotely, or activate Owner access.

## Part C — Private database and authentication release (GATED)

> **STOP HERE FOR CURRENT RELEASE.** Parts C and D are the **required operator/release sequence** for work that has not completed all security, migration, binding, browser and financial gates. They are deliberately written in enough detail that the eventual approved operator knows the order and expected checks. **Do not copy/paste remote commands or toggle flags today as a shortcut.**

### Step 11 — Review and apply the correct schema, not every SQL file (STOP / RELEASE GATE)

There are **multiple migration queues for different purposes**:

| Schema | Relevant source | Must be applied to |
| --- | --- | --- |
| First Admin bootstrap + sessions | `staging-migrations/platform-auth/0001_platform_bootstrap.sql` and `0002_platform_sessions.sql` | **Control D1** only, approved migration run |
| First Admin TOTP activation audit | `staging-migrations/platform-auth/0003_platform_first_mfa_activation.sql` | **Control D1** only, separate approved migration run |
| Shop reservations, bindings, invitations, Owner records, challenges, provisioning | `staging-migrations/platform-onboarding/0001...` through `0008...` and `0011_control_center_provisioning.sql` | **Control D1**, reviewed dependency/order |
| Shop identity and Owner-ready baseline | `staging-migrations/shop-identity/` and the reviewed Owner-ready migration manifest | **Pilot Shop D1** |
| Original ERP catalog, Party, Tiles and related schemas | Root `migrations/` and M02/M03 contracts | Target Shop D1 only as part of **approved complete business schema**; not blindly applied to the platform database |

The checked-in P1 Admin draft points its `CONTROL_DB` binding at the **platform-auth** directory; the P1 Owner draft points its `CONTROL_DB` binding at **platform-onboarding** and `PLATFORM_PILOT_DB` at **shop-identity**. This is **not** a complete installer that automatically applies all three queues in the correct order.

**Before a remote migration:**

1. Check the exact new Cloudflare account ID, database UUID, current schema and existing `d1_migrations` records.
2. Confirm the migration bundle is the **correct reviewed queue** for the target database and matches the release SHA.
3. Capture a private, restorable backup and a D1 Time Travel bookmark if available and appropriate.
4. Demonstrate the same migration on disposable local Workerd/D1 and verify post-migration table, trigger, and identity readbacks.
5. Confirm one approved operator, no concurrent writes, and M03/M04/M10/M11 signoff where relevant.
6. Only then run the release-approved remote migration operator. Never point the root 14-file migration queue at an old platform/staging database merely to fix a login problem.

Cloudflare's generic syntax is `wrangler d1 migrations apply <DATABASE> --remote --config <REVIEWED_CONFIG>`. **This is a syntax reference, NOT an approved command for the current generated profiles.** The project currently needs a reviewed private migration bundle/operator for an account-independent first installation. See [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) and [M03 auth-only operator checklist](../runbooks/M03_AUTH_ONLY_APPLY_CHECKLIST.md).

**Expected when this gate is completed later:** the correct tables/triggers exist in the correct D1; platform data stays out of Shop D1 and business rows stay out of Control D1; backup/restore readback succeeds.

### Step 12 — Configure secure Super Admin enrollment and MFA (STOP / RELEASE GATE)

**What exists in code:**

- `src/auth/platform-superadmin-bootstrap.js` consumes a **single-use, short-lived, Google-subject-bound** setup ticket from Control D1.
- `staging-migrations/platform-auth/0001_platform_bootstrap.sql` defines `platform_setup_tickets` and immutable first-admin enrollment.
- `0002_platform_sessions.sql` defines `platform_admin_auth`, challenges, attempts and revocable platform sessions.
- `src/auth/platform-superadmin-session.js` validates the Google token and a six-digit TOTP code. A session lasts **15 minutes** on this implementation.

**Required release setup (not yet an end-to-end installer):**

1. Identify the exact first Super Admin Google account and verified **Google stable subject**, not an unverified browser-supplied email.
2. Use a **reviewed private setup-ticket issuer** to insert a cryptographically hashed, unique **64-character token** with nonce, verified Google issuer/subject, issue time and expiry **no more than 10 minutes** into the **correct Control D1**. Do not hand-write SQL that bypasses those checks.
3. Securely provision `PLATFORM_TOTP_SECRET` (the existing verifier expects **40 lowercase hex characters**, representing a 20-byte TOTP key), enroll the same secret in the intended authenticator app, and configure a positive `PLATFORM_FACTOR_VERSION` matching the persisted platform auth factor version.
4. Store the TOTP key in **Cloudflare Worker secrets or another approved protected store**. Record secure recovery custody outside GitHub.
5. Confirm the exact HTTPS origin and Google client ID. For Google/TOTP without Access, configure `PLATFORM_OPERATOR_GOOGLE_SUBJECT` to match the verified operator subject. For Access, confirm the audience and operator email.
6. Open the protected Admin hostname → **Set up administrator** → enter one-time ticket → choose the approved Google account → finish enrollment.
7. While the setup ticket is valid, use the approved private factor activation procedure to initialize `platform_admin_auth`. Then use **Start sign-in** and enter the authenticator code.
8. Test rejection of the wrong Google identity, wrong/expired/replayed tickets, wrong TOTP and expired sessions. Verify logout revocation and, for the Access profile, rejection of the wrong Access user.

**Current blocker:** no verified, complete, account-independent **ticket issuer + MFA enrolment/operator script + first-hosted-deployment procedure** is available in this release. **Do not issue arbitrary remote SQL or seed a default Super Admin** to imitate it.

### Step 13 — Release the private Super Admin Worker (STOP / RELEASE GATE)

The Access profile uses the entry point below. Google/TOTP without Access uses `src/auth/m04-accessless-platform-admin-worker.js` and delegates to the same private platform app.

```text
src/m03-access-platform-auth-worker.js
    → src/m03-private-platform-auth-worker.js
    → frontend/platform-auth/{index.html, platform-auth.css, platform-auth.js}
```

**Required trusted configuration at release:**

| Binding or variable | What it represents |
| --- | --- |
| `CONTROL_DB` | New account's exact approved Control D1 |
| `PLATFORM_INGRESS` | Admin rate-limit binding |
| `PLATFORM_AUTH_SCOPE` | Exactly `private-platform-auth` |
| `PLATFORM_AUTH_ORIGIN` | Exact private Admin `https://...workers.dev` origin |
| `PLATFORM_CLIENT_ID` | Google Web client ID |
| `PLATFORM_ACCESS_AUDIENCE`, `PLATFORM_ACCESS_EMAIL` | Verified audience and approved operator email for Access mode |
| `PLATFORM_AUTH_MODE`, `PLATFORM_OPERATOR_GOOGLE_SUBJECT` | `google-totp-without-access` and the independently verified operator subject for Google/TOTP mode |
| `PLATFORM_TOTP_SECRET` | Protected TOTP seed, never committed |
| `PLATFORM_FACTOR_VERSION` | Valid positive MFA version consistent with Control D1 |
| `PLATFORM_SHOP_RESERVATION_ENABLED` | Remain `false` until Shop setup is approved |
| Other `PLATFORM_*_ENABLED` flags | Remain disabled unless their full per-feature release gate passes |

**Required release order:**

1. M03/M04/M11 independently approve the private Admin deployment profile, exact new-account IDs, no-preview policy and recovery plan.
2. Verify the selected boundary before exposure. For Access, confirm coverage of every Admin URL. For Google/TOTP, confirm the exact origin, approved-subject bootstrap, ingress rate limit and session-gated APIs.
3. Generate a reviewed **release profile**, rather than deploying `.wrangler/portable-instance/admin.generated.jsonc` unchanged. The generated draft intentionally has `workers_dev:false`, no public route and missing protected settings; the current hardcoded old-account staging profile is also **not portable**.
4. Perform local and Wrangler **dry-run** checks with that reviewed release profile, check that the sole D1 binding is the correct Control D1.
5. Under explicit release authorization, deploy/activate the approved private Admin Worker. Retain the previous Worker version for rollback and confirm audit/logging excludes tokens and cookies.
6. From a fresh browser, verify the unauthenticated responses for the selected mode. Access blocks HTML/CSS/JS and APIs. Google/TOTP serves the login page and restricts protected APIs. Verify Google and MFA sign-in as the approved operator.

**Never** copy old-account values from `wrangler.m03-platform-auth-access-staging.jsonc` into a new account. It embeds the existing account, hostname, Control D1 and rate-limit namespace. Do not publish the private Worker simply to see “Hello world”.

### Step 14 — Build and release the Shop Owner frontend/Worker (STOP / RELEASE GATE)

The Owner has a **separate Worker**, not the Admin login route and not the public D1-free preview:

```text
src/m03-owner-redemption-worker.js
    + frontend/owner-auth/{index.html, owner-auth.css, owner-auth.js}
    + generated dist-owner/
```

**Local frontend build already available:**

```bash
npm run build:owner-frontend
```

The Owner release must use:

- `OWNER_AUTH_ORIGIN` — exact Owner HTTPS origin.
- `PLATFORM_AUTH_ORIGIN` — exact Admin origin.
- `PLATFORM_OWNER_CLIENT_ID` — registered Web client ID.
- `OWNER_INGRESS` — distinct Owner rate-limit binding.
- `CONTROL_DB` — correct Control D1.
- `PLATFORM_PILOT_DB` — verified distinct Shop D1.
- `PLATFORM_PILOT_SHOP_ID`, `PLATFORM_PILOT_D1_ID`, `PLATFORM_PILOT_MARKER` — immutable, **matching** pilot identity and deployed binding.
- `OWNER_LOGIN_ENABLED`, `OWNER_GMAIL_SIGNUP_ENABLED`, `OWNER_DASHBOARD_BOOTSTRAP_ENABLED`, `OWNER_CATALOG_ENABLED`, `OWNER_CLEAN_PRODUCTS_ENABLED`, `OWNER_WRITE_GRANTS_ENABLED` — **separately gated**, not all-on switches.

**Required release order:**

1. Build `dist-owner` from the approved release.
2. Verify the Shop D1 schema, immutable `shop_identity` record, Control D1 binding receipt, Owner approval and correct Google client ID.
3. Have M03/M04 approve the exact Owner Worker release config, protected flags, D1 bindings and host/origin policy. Avoid Cloudflare Preview URLs with Shop D1.
4. Dry-run the proposed Worker profile and inspect what will be deployed. The generated `owner.generated.jsonc` is deliberately **disabled**, has `remote:false` and no live routing.
5. Under separate deployment approval, publish the Owner Worker only with the reviewed configuration and minimum permitted flags.
6. Test actual intended Owner Gmail login, refresh, logout, disabled access, wrong origin, wrong shop and cross-tenant denial.
7. Only enable live product/purchase/POS writes after the complete shared D1 auth/posting and financial gates pass.

**Today:** the Owner frontend can show the original ERP shell and local Product proofs, but some routes deliberately display **“Business data is not connected”**, and the source-generated shell still denies unapproved business RPCs. A visible POS page is not a functioning POS.

### Step 15 — Connect GitHub deployment without duplicate build pipelines (GATED for private Workers)

Existing public shell deployment uses **Cloudflare Workers Builds** as the sole build/deploy owner. Its checked-in **`wrangler.preview.jsonc` has no D1 binding**.

When an approved build release exists:

1. Open Cloudflare **Workers & Pages → selected Worker → Settings → Builds** (or create/import a Git-connected Worker if none exists).
2. Connect the correct GitHub repo and select the **reviewed release/production branch**.
3. For the existing **public, DB-free shell only**, the checked-in documented commands are:
   - Build: `npm run build:frontend`
   - Deploy: `npx wrangler@4.161.0 deploy --config wrangler.preview.jsonc`
   - Preview: `npx wrangler@4.161.0 preview --config wrangler.preview.jsonc`
4. **Do not reuse that public deploy command for Admin/Owner**. Each private Worker needs its own approved config, authentication, secrets, D1 bindings and release ownership. Multiple GitHub connections can trigger multiple builds per commit, so review build ownership before approving the private release.
5. GitHub Actions `.github/workflows/cloudflare-preview.yml` is **test-only**. Do not add an additional GitHub Actions push-to-deploy to the same Worker.
6. Keep public PR previews free of D1, Owner, cash, bank, secrets and mutable customer data.

**Because your previous account exhausted Free Workers Builds minutes:** turn off unnecessary **Preview Builds** or pause the Cloudflare Git-build connection while developing. Continue GitHub PR review and local Workerd/D1 tests. Switching accounts does not turn an unfinished ERP into a finished one. Review [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [build usage limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) before enabling automatic builds.

## Part D — Create businesses and finish the MVP

### Step 16 — Create a new business from Super Admin (STOP / RELEASE GATE)

**Required final workflow:**

1. Sign in to the **private Admin Worker** using Google and TOTP. Complete the Access prompt first if you chose the Access profile.
2. Open the **Control Center**.
3. Click **+ Business** and enter **Business name** + **Owner Gmail**.
4. Submit **one operation**. If the network fails, use **Resume setup**, not a second untracked create.
5. Server registers the business, creates the Shop D1 in the intended account, binds/routes it through a reviewed mechanism, applies and verifies the approved empty-shop migrations, and verifies immutable Shop identity.
6. Server records Owner approval/ready state only after database creation and binding/schema verification pass.
7. Owner signs in at the approved Owner Worker origin and sees **their own** shop.
8. Super Admin may later open the same ERP through a **separate authorized support session**, not by taking the Owner's password or reusing the Owner cookie.

**What exists now:** a tested **local** Control Center Create/Resume/list/search flow in Workerd/D1, including interruption/retry cases and two-shop pilot proofs. See merged [#722](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/722), [#735](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/735), [#742](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/742), [#759](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/759).

**What is missing:** the production-grade hosted Cloudflare **create D1 + publish binding/routing + schema migration + Owner activation** operator/provider. An existing D1 binding is declared in the deployed Worker configuration; entering a new database UUID in Control D1 **does not automatically create a new Worker binding**. The current P1 setup supports a **single static pilot binding**, not unlimited dynamic tenants.

**STOP if** the UI says **Reserved**, **Allocating**, **Preparing**, or **Database setup is next**. Those are not a ready shop. Do not manually set the database row to `ready` or bypass identity triggers.

### Step 17 — Verify a fresh Shop ERP and accounting (STOP / RELEASE GATE)

Once the real transactions are approved, test at least **two separate** empty shops, not just one. Use only disposable fixtures first:

| Test | Expected proof |
| --- | --- |
| Owner A sign-in vs Owner B sign-in | Separate valid shop IDs, no credential/cookie cross-use |
| Add Product and Unit Conversion | Source-faithful quantities and revision history |
| Tiles Box/Pcs/Sqft | Exact conversions, stock and price anchor, no floating-point drift |
| Purchase + Supplier Due | Correct lot, FIFO cost, Supplier AP and cash/bank effects |
| POS cash/credit/split payment | Exact totals, change, due, Cash Session rules, atomic stock + money postings |
| Retry and concurrent sale | No double posting; no invalid oversell/partial journal |
| Sale/Purchase Return | Exactly-once reversal and original-lot/price history |
| Party ledger | Customer/Supplier/Vendor/Owner/Lender/Borrower/Payee gross accounts stay separate |
| Daybook/report/invoice | Source-matched totals and print/browser parity |
| Backup/restore | Recovered data reconciles against original source, including acknowledged writes |
| Wrong-shop URL / API payload | Access denied; cannot read or write a different shop |

**Hard launch rule:** no unexplained stock/financial reconciliation difference, no known critical calculation defect, no unverified replay/concurrency boundary. M10 [#312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312) and M11 [#306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306) require separate documented GO decisions. The current public `src/index.js` still reports `database: 'not-connected'`, and `src/rpc/registry.js` deliberately has no public business method handlers.

### Step 18 — Final acceptance for a genuinely portable installation (STOP / RELEASE GATE)

Do not mark “setup complete” until someone else can repeat these steps with:

- [ ] A second Cloudflare account with different account/Worker/D1 UUIDs and different Workers.dev hosts.
- [ ] The **same exact reviewed application source SHA**, with **configuration changes only**.
- [ ] A working protected Admin host, verified Google/TOTP login and the exact Access identity if using Access.
- [ ] Independently verifiable Control D1 and Shop D1 schema versions/bindings.
- [ ] A usable new shop created from the UI, with a real Owner sign-in.
- [ ] Two shops with demonstrated SQL/backend tenant isolation.
- [ ] Actual purchase → POS → return → ledger/stock/cash reconciliation with exact values.
- [ ] Revoked sessions/Owner disable tests and an auditable Super Admin support session (when that feature is implemented).
- [ ] Private backup export, successful restoration, and documented recovery/rollback.
- [ ] Independent M10 and M11 GO/no-GO approval.

If any checkbox is missing, label the environment **pilot/staging only** and keep finance writes disabled.

## Part E — Troubleshooting

| What you see | Likely reason | Safe next action |
| --- | --- | --- |
| `wrangler whoami` shows old account | CLI logged into wrong Cloudflare account | Stop; select/login to intended account before D1 creation or any deploy |
| P1 says invalid manifest | Wrong account format, placeholder, origin, distinct UUID, or rate-limit ID | Correct only `.wrangler/instance.json`; rerun `--check` |
| P1 refuses to generate new drafts | Manifest differs from previously generated ignored files | Review old/new identities; securely archive/remove stale drafts; regenerate |
| P2 `--verify-readonly` fails | Token lacks GET permissions, D1 name/UUID mismatch, or wrong account | Recheck actual resources; do **not** change SQL or disable identity checks |
| Hosted preflight fails before Worker deployment | Both private Worker bindings do not yet exist | **Expected** until a reviewed private release; do not fake a successful response |
| Admin returns 403, “Access required” | Access missing/wrong user/audience, host mismatch | Check Worker-wide Access app, correct operator email, audience, exact origin |
| Admin returns 503 “Platform authentication unavailable” | Missing `CONTROL_DB`, rate-limit binding, client ID, scope, audience/email/TOTP setup | Inspect protected deployment config; do not expose secrets in logs |
| Google popup says origin mismatch | Web client doesn't include exact Admin/Owner Workers.dev origin | Fix authorized JS origins and test-user/branding configuration |
| One-time Admin setup fails | No valid unused ticket, wrong Google subject, expired ticket or incomplete MFA state | Stop and use the reviewed private bootstrap operator; do not seed a default user |
| Owner login is not shown | Owner release flag is disabled or separate Worker not approved | Do not toggle it blindly; check Owner acceptance/release gates |
| “Business reserved; Database setup is next” | Reservation only, no verified D1/binding/schema | Resume the same operation when the hosted provisioner exists; see #690 |
| ERP says “Business data is not connected” | Intended Owner-shell read-only placeholder | Wait for actual authenticated D1 transaction API activation |
| Public `/api/health` says `database: not-connected` | This is the **expected** DB-free public preview | Do not attach a private Shop D1 to the public preview |
| Cloudflare Workers Builds failed | Could be build minutes exhausted or a real build error | Inspect exact Cloudflare build log; reduce Preview Builds, use local build + GitHub CI; never bypass required PR checks |
| Two shops show the same data | Potential binding/tenant authorization failure | Stop immediately; disable writes; do not attempt a live correction without audit/restore plan |

## Part F — Moving an existing business to another account (NOT a fresh install)

A fresh account installation starts empty. **Historical business migration requires additional controls**, especially for an accounting ERP:

1. Agree on a single source of truth and a specific cutover point.
2. Take a private, authenticated, encrypted export and verify an offline restore.
3. Check original source IDs, Party role links, lot/FIFO history, opening balances, all payment/return IDs and the current accounting schema.
4. Import only into an approved isolated database, not one already accepting active shop writes.
5. Reconcile source-versus-target row counts and **exact monetary, stock, and gross account balances**.
6. Rotate account-scoped secrets, Cloudflare Access configuration and Google origins/clients.
7. Plan recovery of writes acknowledged after the source snapshot; never let old and new deployments accept uncoordinated parallel financial writes.
8. Enable traffic only after M10/M11 signoff. If reconciliation fails, leave the original service untouched and follow the approved rollback.

No GitHub file, local P1 manifest, or Cloudflare Worker deploy command automatically copies live D1 records to another Cloudflare account.

## Reference links and next implementation work

**Current active project:** [PROJECT.md](../../PROJECT.md) · [AGENTS.md](../../AGENTS.md) · [parallel ownership](../PARALLEL_EXECUTION.md) · [M03 integration gate](../M03_PARALLEL_READINESS.md).

**Keep existing specialist runbooks as evidence, but use this file as the one beginner-facing new-install guide:**

- [P1 portable instance source contract](PORT_P1_LOCAL_CONFIGURATION.md)
- [P2 read-only account/bootstrap preflight](PORT_P2_READONLY_PREFLIGHT.md)
- [P2 provisioning and recovery design](PORT_P2_PROVISIONING_AND_RECOVERY_DESIGN.md)
- [Private Super Admin staging runbook](../runbooks/M03_PLATFORM_AUTH_STAGING.md)
- [M03 auth schema safety checklist](../runbooks/M03_AUTH_ONLY_APPLY_CHECKLIST.md)
- [Cloudflare GitHub deployment ownership](../CLOUDFLARE_GITHUB_SETUP.md)
- [Full portability roadmap](PORTABILITY_ROADMAP.md)

The executable installer still needs reviewed Admin/Owner release configuration, approved authentication settings and secrets, restorable Control/Shop migrations, an operator ticket and MFA tool, hosted shop provisioning and Owner handoff, financial acceptance in the original ERP, and two-tenant M10/M11 signoff.

**Documentation maintenance:** after each milestone, update this **same file**, replacing `STOP / RELEASE GATE` with actual reviewed operator commands and acceptance evidence. Do not write another overlapping “complete installation guide.” Keep this tutorial practical for one operator, while preserving **all** financial safety and tenant-isolation gates.
