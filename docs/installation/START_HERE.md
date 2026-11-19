# START HERE — Install SherERP Cloud on a new Cloudflare account

> **Status (19 November 2026): planned installation guide, NOT YET an executable end-to-end installer.**
> Do not use the current staging Wrangler profiles in another account without reviewing and replacing instance-specific resource references. Do not enable real business transactions or run remote D1 imports based on this draft. Production release remains gated by M10/M11.
>
> **Goal:** One reviewed GitHub codebase. A person sets up a new Cloudflare account, enters new account configuration and Google sign-in settings, completes secure first Super Admin setup, and creates new shops from the Control Center—without editing ERP application code or running SQL per tenant.
>
> **Available P1 local draft:** [Validate a new instance configuration without deployment](PORT_P1_LOCAL_CONFIGURATION.md). It generates only disabled, ignored Wrangler drafts; Cloudflare provisioning, Access setup and deployment are still gated.

## 1. What you are installing

| Component | Purpose | Data |
| --- | --- | --- |
| ERP Worker | Serves the original ERP frontend and authenticated ERP API | Connects only to the correctly authorized shop database(s) |
| Super Admin / Control Center Worker | Private platform administration; creates and manages businesses | Separate **Control D1** |
| Control D1 | Platform administrators, shops, provisioning status, Owner enrollment and audit | **No shop sales/ledger data** |
| Shop D1 (one per business in the approved pilot design) | Each shop's products, inventory, customers, sales and finance | Must not be accessible from a different shop |
| GitHub + Cloudflare Workers Builds | Versioned code, PR checks, reviewed deployment | Public PR previews must have **no real D1/secrets** |

A **new installation** starts with empty shop data. Moving an existing company's ERP history to another Cloudflare account is a **separate, protected backup/export/import/reconciliation task**.

The system currently has source files for these components, but **not** a proved, fully automated new-account installation. Do not interpret a deployed preview page as a working ERP.

## 2. Prepare these items

- Access to the exact SherERP Cloud GitHub repository/release and permission to connect it to Cloudflare.
- A separate Cloudflare account with Workers, D1 and the Cloudflare Access configuration you will use for the private Super Admin host.
- A Google Cloud project with a **Web** sign-in/OAuth client for the new, exact HTTPS hostname.
- The intended first platform Super Admin's Google account and an authenticator app for MFA.
- A safe place to hold secrets and recovery codes. **Never paste client secrets, API tokens, MFA secrets or shop data into GitHub, chat, public docs or screenshots.**
- Confirm Cloudflare resource limits, required features and pricing for the desired number of shops before onboarding users.

You **do not need to buy a custom domain** just to use a suitable Cloudflare \`workers.dev\` address. The subdomain is scoped to the new account's available Workers namespace; you cannot assume the old account's full hostname will carry over.

## 3. Target setup — simple operator sequence

The steps below describe the **required final user experience**. Each status explains what remains before somebody can follow this as a no-code installation. Until those parts pass the new-account test, **stop at planning; do not improvise remote SQL or remove protective gates**.

### Step 1 — Choose a release from GitHub

Use a **reviewed, tested tag or main commit** of \`shuvodelux-commits/SherERP_Cloud\`. The final setup package will expose a simple \`START HERE\` entry and a validated example instance configuration.

**Expected:** The chosen release and database schema version are recorded.  
**Current gap:** Release-ready installer package and installer-tested schema-version contract are not implemented.

### Step 2 — Connect GitHub and name your Cloudflare resources

In Cloudflare, connect GitHub under **Workers & Pages → Create / Import a repository** (exact labels may change). Select the approved repository, create separate Worker identities for ERP and private Super Admin, and keep staging/public previews distinct.

**Expected:** Installer records the Cloudflare account, Worker names and account's \`workers.dev\` namespace as configuration.  
**Current gap:** Existing checked-in staging profiles still contain current-account Worker names and D1 UUIDs. The P1 draft accepts a validated per-instance admin hostname in runtime config and generates disabled, ignored instance profiles, but it does not check remote account ownership or deploy anything. See [P1 local configuration](PORT_P1_LOCAL_CONFIGURATION.md).

### Step 3 — Register Google sign-in

In **Google Cloud Console → Google Auth Platform → Clients**, create or select a **Web application** client. Add the exact approved Administrator/ERP HTTPS origins and any redirect URIs required by the actual implemented flow. Use the new OAuth client ID in the corresponding Worker instance configuration.

**Expected:** The new account's sign-in origin and client ID match the approved Google registration.  
**Security note:** A Google **client ID is not a secret**. A Google client secret is needed only if the selected server-side OAuth code flow requires it; do **not** invent or share one for an ID-token-only flow. A JWT secret is also not a substitute for properly verifying Google identity tokens.

### Step 4 — Protect the Super Admin hostname

Before publishing the private Control Center, configure **Cloudflare Access** to protect the **entire admin hostname**, including HTML, JavaScript/CSS and all platform API paths. Restrict it to the approved operator identity and verify there is no bypass policy.

**Expected:** Anonymous users and unapproved identities cannot open the page or call the API.  
**Current contract:** The private platform Worker checks the Access audience and approved operator email before it serves protected routes.

### Step 5 — Create and initialize Control D1

The finished installer must create the new account's **Control D1**, record its actual database UUID in a private instance configuration, and apply the **reviewed, versioned** platform migrations exactly once. Check schema version and create a recoverable backup/bookmark before subsequent changes.

**Expected:** Control D1 is connected and schema checks pass.  
**Current gap:** The existing staging setup uses a fixed named Control D1; a new-account bootstrap and tested migration operator are required.

### Step 6 — Configure the Workers and credentials

Supply the instance values for account, Worker hosts, D1 bindings and Google sign-in. Set secrets using Cloudflare's secure Worker secret settings, never a committed file.

| Value | Where it belongs |
| --- | --- |
| Worker names, account/resource IDs, exact origins, D1 binding names | Validated **instance configuration** / generated Wrangler config |
| Google client ID, Cloudflare Access audience and approved operator email | Reviewed Worker instance configuration (not secrets unless organizational policy demands) |
| MFA/TOTP seed, any OAuth client secret actually used, signing keys and provisioning API token | **Encrypted Cloudflare secrets or protected one-time installer store** |
| Customer/ledger records and archived source data | Private database/backup storage only; **never GitHub** |

**Expected:** A preflight check reports missing/mismatched values without revealing secret contents.  
**Current gap:** A single complete configuration inventory, generated config and non-secret installer diagnostics do not yet exist.

### Step 7 — Enroll the first Super Admin

Use a **one-time, expiring setup ticket** scoped to the intended Google identity. Complete Google identity verification, then configure and verify MFA before granting persistent Super Admin access. Consume the ticket once, and test login, logout and rejected unauthorized logins.

**Expected:** No built-in default password, hardcoded Administrator, or seeded privileged login.  
**Current contract:** The private platform has one-time Google-subject-verified enrollment and separate session/MFA logic. Its operational bootstrap must be packaged and verified for a fresh account.

### Step 8 — Create the first business from Control Center

The final screen must ask for **Business name** and **Owner Gmail**. It should then:
1. Record an idempotent shop reservation.
2. Create a new shop D1 resource without exposing the Cloudflare provisioning token to browsers.
3. Apply the approved empty-shop schema, bind/rout the shop safely, verify database identity and mark it ready.
4. Invite/approve the intended Owner; show status, error and **Resume setup** if interrupted.

**Expected:** No code edits, SQL commands or hand-editing Worker bindings **for each new shop**.  
**Current gap:** [Issue #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690) tracks this. Today's existing UI can report **“Business reserved. ... Database setup is next.”** That is *not* completed provisioning.

### Step 9 — Let the Owner sign in and use the new ERP

The Owner logs in using the approved Gmail account and starts with an empty shop. Verify: add a product, purchase stock, POS sale, return, correct Cash Session behavior, finance/ledger balances and the original UI/printing rules. Test multi-unit quantities and Tiles Box/Pcs/Sqft where enabled.

**Expected:** One tenant cannot access another tenant's data, even by changing a URL or API payload.  
**Current gap:** End-to-end Shop D1 + authorized ERP posting for a fresh installation is gated on M03/M04/M05–M09 integration.

### Step 10 — Verify before production use

Use the formal second-account install tests in [PORTABILITY_ROADMAP.md](PORTABILITY_ROADMAP.md). A working login, a healthy Worker or one product screen is not enough. Production needs **separate M10 reconciliation/recovery acceptance and M11 owner release approval**.

## 4. Quick troubleshooting guide (draft)

| What you see | What it generally indicates | Next check |
| --- | --- | --- |
| “Sign-in is unavailable” | Missing/inconsistent auth configuration or binding | Worker auth settings, Control D1, deployment logs |
| “Origin forbidden” | Requested host does not equal configured allowed origin | Worker host + app origin + Google origin |
| HTTP 403 before the login page | Access/identity policy rejected the request | Cloudflare Access app, audience, approved operator |
| Google origin/redirect mismatch | Google client does not authorize this exact HTTPS origin/redirect | Google Auth Platform Web client settings |
| “Database not connected” in public preview | Expected intentionally DB-free public preview | Use properly gated private installation, **not** by adding real D1 to PR previews |
| “Business reserved; Database setup is next” | Business identity was reserved, not fully provisioned | #690 provisioning workflow; do not claim shop ready |
| Failed GitHub checks | Possible regression or incomplete integration | Inspect exact failed check/log; do not bypass CI |

## 5. Installing vs. moving an existing live business

**Fresh install:** empty Control D1 + newly created shop D1(s), then real admin/Owner enrollment.

**Move to another account:** separately approve maintenance/freeze; take encrypted export/backup; validate target schema and tenant IDs; import on the new account; reconcile products, lots, invoices, Party gross balances and transaction IDs; rotate account secrets and update Google/Access origins; test restore and confirmed rollback/replay of in-flight writes. Never let the old and new ERP both accept writes independently.

Cloudflare's D1 Time Travel/backups are recovery tools, **not an automatic portable copy stored in GitHub**.

## 6. Progress tracking

- [PORT-00 master installation/portability issue](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699)
- [#690 — New businesses through Super Admin](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690)
- [M03 readiness gate](../M03_PARALLEL_READINESS.md)
- [M11 release readiness](../runbooks/M11_RELEASE_READINESS_MATRIX.md)

**Success rule:** A separate tester installs the same reviewed codebase in a second, empty Cloudflare account, changes **configuration only**, creates two shops from the UI, demonstrates secure tenant isolation and real ERP workflow, and proves backup/recovery. Until then this is a roadmap, not an installation guarantee.
