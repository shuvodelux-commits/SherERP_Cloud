# M03 / PORT-P5 — Shop login on the existing ERP URL (two-host rollout)

**Status:** candidate configuration and contract tests; **not deployed, not production GO**.
**Target URLs:** Admin `https://admin.hisab.workers.dev` (other workstream) and shop users `https://shererp.hisab.workers.dev`. **No third Owner hostname.**

## Scope / non-conflict boundary

1. Reuse `src/m03-owner-redemption-worker.js`, the existing Google ID-token verifier, approved-Gmail first-Owner onboarding, D1-backed Owner sessions, host-only secure cookie, `GET /app`, and `dist-owner` built by `npm run build:owner-frontend`.
2. The existing Admin Worker, platform setup, MFA, Control Center, main `src/index.js`, original UI, operational D1 writers, migrations and `wrangler.preview.jsonc` are **not changed** by this workstream.
3. The current Worker built from `src/index.js` is a database-free demonstration shell with mobile/password sign-in intentionally disabled. A newly created shop and Admin setup do not activate that login.
4. The shop-user hostname must ultimately serve the existing **Owner Worker**. Assigning the configured Owner Worker the hostname via an independently approved deployment is the required replacement; a redirect from the public shell is not sufficient because the Owner's `__Host-` cookie is same-origin.
5. This candidate supports the **first approved Shop Owner Gmail** and authenticated ERP shell for **one bound pilot shop only**. Shop-staff login, general dynamic multi-shop provisioning, and production financial posting are not certified by this PR.

## Prepare candidate locally without deployment

- In the private, ignored `.wrangler/instance.json`, keep the approved existing account, Control/Shop D1 IDs, exact shop marker, Google Web client ID and rate-limit namespace; set:
  - `workers.admin = "admin"`
  - `workers.owner = "shererp"`
  - `workersSubdomain = "hisab"`
  - `origins.admin = "https://admin.hisab.workers.dev"`
  - `origins.owner = "https://shererp.hisab.workers.dev"`
- Make sure the intended Cloudflare account actually owns these Worker names and D1 resources. **Do not paste secret values into GitHub.**
- Run the private, read-only local checker:

```bash
node scripts/port-p5-shop-user-login.mjs --check .wrangler/instance.json https://shererp.hisab.workers.dev
```

- After review, generate only an ignored candidate profile:

```bash
npm run build:owner-frontend
node scripts/port-p5-shop-user-login.mjs --generate .wrangler/instance.json https://shererp.hisab.workers.dev
```

The generated `.wrangler/portable-instance/shop-user.candidate.jsonc` contains the Owner entrypoint and assets, the exact **one** pilot shop and Control D1 bindings, the existing `OWNER_INGRESS` rate limit, Google Gmail first-Owner login, `OWNER_LOGIN_ENABLED=true` and `OWNER_DASHBOARD_BOOTSTRAP_ENABLED=true`. It explicitly disables catalog write grants, Purchase, POS, Returns and audit. It does **not** change either deployed Worker or make remote D1 writes. It cannot be generated under a mismatched hostname, and it refuses to overwrite a changed local profile.

## Prerequisites before a separate hosted release decision

1. Finish the independent Super Admin Google/MFA enrollment and verify a real current Admin session on `admin.hisab.workers.dev`.
2. Confirm the Control D1 onboarding and Owner Gmail approval tables, Shop D1 migrations, current shop binding ID/marker and source audit receipts; verify backups/restore checkpoint. The approved email must match the Google verified email; do not trust UI-supplied identity.
3. Confirm **who deploys `shererp` now**. A currently published demonstration Worker may already own this hostname. Do not race GitHub/Cloudflare Builds or overwrite the existing service via another deploy path. M11 must select one deployment owner and approve a reversible cutover; ensure private credentials are not exposed to public PR previews.
4. Configure the Google Web OAuth client's **authorized JavaScript origin** `https://shererp.hisab.workers.dev` exactly, and the separate admin origin where required. The Owner Google login uses an ID token popup, not a client secret or arbitrary redirect callback.
5. Verify `CONTROL_DB`, `PLATFORM_PILOT_DB`, `OWNER_INGRESS`, the host's exact origin and all scoped values against the selected account. **Do not deploy this candidate merely because it was generated.**
6. Independently review M03/M04 auth, tenant-scoping, session/logout, deployment ownership, two-shop isolation and M10/M11 release gates.

## Acceptance after an authorized staging deployment

1. Signed-out user opens `shererp.hisab.workers.dev`: sees **Shop Owner sign-in with Google**, not the historical mobile/password form; `GET /app` redirects to sign-in when unauthenticated.
2. A first shop, marked ready with matching Shop D1 identity, has an approved Owner Gmail. That verified Gmail completes the one-time Owner setup and signs in on the **same host**; no link to an `owner.*` hostname.
3. The Owner sees the original ERP shell at `/app` with the correct shop name after refresh; session cookies remain host-only and HttpOnly. Logout revokes the D1 session and prevents access to the app.
4. A different Google account, disabled Owner, revoked session, mismatched shop marker, wrong host, or missing D1/rate limit cannot gain access. Verify server-side tenant isolation, not just UI hiding.
5. No financial posting is enabled by this candidate. Before accepting operational sales, separately test current-Owner current-Shop D1 Sale → Return → Cash/Party/Stock/Invoice readbacks, duplicate submit, rollback, two-shop denial and recovery.

## Test-first evidence / commands

The focused acceptance tests were added in a separate RED commit before the new generator was implemented. They exercise exact host reuse, configured Google and dashboard flags, D1 scoping, no financial-write flags, reject wrong URL/preview and private idempotent candidate output.

```bash
node --test tests/contract/port-p5-shop-user-login.test.mjs tests/contract/port-p1-instance.test.mjs
node scripts/port-p0-inventory.mjs --check
npm run build:owner-frontend
```

GitHub exact-head CI and independent review are still required; do not report this candidate as a verified live login until hosted browser/session tests pass.
