# Platform Super Admin staging release candidate

## Candidate and local rehearsal

The platform sign-in page and API use `src/m03-private-platform-auth-worker.js` with the assets in `frontend/platform-auth`. The checked-in `wrangler.m03-platform-auth-local-test.jsonc` uses a synthetic D1 binding and disables both the workers.dev address and preview URLs. The two Control D1 migrations reproduce the tested bootstrap and session schema. They are a separate queue at `staging-migrations/platform-auth`.

## Access-protected workers.dev candidate

`wrangler.m03-platform-auth-access-staging.jsonc` is a separate, manual release candidate for the existing Worker `admin-hisabiq` at `https://admin-hisabiq.agnishuvo.workers.dev`. This is the only staging profile in this runbook that uses `workers_dev:true`. It has no custom routes and keeps previews disabled. The public `hisabiq` Worker remains on its database-free profile.

The host must remain protected by the existing Worker-wide Cloudflare Access application. The admin Worker requires Cloudflare's runtime-provided `ctx.access`, the configured application audience, and the approved operator email from `getIdentity()` before serving the page, its files, or any API route. A missing or failed identity lookup denies the request. The three unchanged sign-in files are bundled as text modules so the Static Assets router cannot drop the native Access context. SherERP separately verifies Google credentials and the authenticator code.

The profile refers only to the Control D1 `shererp-platform-control-staging`, UUID `957c0870-d58e-4efc-aea9-807f8fe18c56`. Use it for local verification and Wrangler dry run until separately approved. The profile does not supply any active OAuth, Access operator or MFA settings.

```sh
node --test tests/m03-platform-access-workers-dev.test.mjs
node --test tests/integration/m03-platform-access-release-local.spec.mjs
npx wrangler deploy --dry-run --config wrangler.m03-platform-auth-access-staging.jsonc
```

Before release, verify the existing Access application in the dashboard, including its exact audience, Worker-wide host coverage and an operator-only human sign-in policy. Check that there is no Bypass or Service Auth policy for this application. Do not set `access.dev` in the release configuration. Set `PLATFORM_ACCESS_AUDIENCE` and `PLATFORM_ACCESS_EMAIL` from that verified application in protected release settings. Verify the exact public `PLATFORM_CLIENT_ID` in Google Auth Platform beside the exact Authorized JavaScript origin. Keep any existing credentials and MFA settings in their protected store. Perform unauthenticated and unauthorized-identity checks on HTML, both asset URLs and API routes. If enrollment returns a generic 401 after Google account selection, filter the Worker log for the fixed `platform_enrollment_denied` label and its single reason. Do not retain request metadata, cookies, credential bodies, or raw verifier errors. Confirm no preview or alternate host can serve private content. In a real authorized browser, confirm that the page, both files, and the session API reach the SherERP authentication boundary. Record hosted CPU and latency, including native identity resolution. Retain the previous deployment version for rollback.

[Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) · [Access token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

Run the rehearsal from the repository root with the CI-pinned Wrangler and Chromium.

```sh
node --test tests/integration/m03-platform-auth-release-local.spec.mjs
node --test qa/m01-platform-auth-page.spec.mjs
npx wrangler deploy --dry-run --config wrangler.m03-platform-auth-local-test.jsonc
```

## Private business reservation candidate

The private Worker has a disabled-by-default `POST /api/platform/shops` candidate. The exact configured platform origin and a current Super Admin session are required. The JSON request has exactly `operationId` (UUID v4) and `displayName`. The successful response contains `shopId`, `displayName` and `status: "reserved"`. Retry the same operation ID and name to recover the same shop ID. A changed name with the same operation ID returns HTTP 409. A reservation allocates a business identity in Control D1. A later release handles actual database provisioning, binding verification and Owner invitation.

When enabled, the existing signed-in platform card shows **Create business**. If the browser cannot confirm a result, retry in the same tab. The tab retains the operation ID and business name across reloads until the reservation is confirmed. Copy the resulting shop ID for the binding verification step. Before retrying from a different tab after a lost response, reconcile the reservation in Control D1 to avoid submitting a new operation.

The additive migration is isolated in `staging-migrations/platform-onboarding` and is outside the active authentication migration queue. It requires the platform authentication schema. The existing release configuration has no `PLATFORM_SHOP_RESERVATION_ENABLED` variable. Keep it disabled until the onboarding migration and activation get their own approval, verified Control D1 backup, recovery plan and hosted checks. To roll back an activation, disable the flag or restore the previous Worker version. Keep reservation records for audit and reconcile them before any database-level recovery.

```sh
node --test tests/integration/m04-platform-browser-auth-workerd.spec.mjs
```

## Private pilot shop binding verification candidate

A separate disabled-by-default `POST /api/platform/shops/verify-binding` accepts only `shopId`. The Worker uses one trusted pilot binding (`PLATFORM_PILOT_DB`) and release values `PLATFORM_PILOT_SHOP_ID`, `PLATFORM_PILOT_D1_ID` and `PLATFORM_PILOT_MARKER`. The Shop D1 singleton identity must match all three values. The Control D1 write rechecks the Super Admin session and matching reservation, and records the identity match once. HTTP 201 records a new receipt and HTTP 200 returns the existing result only after checking the binding again.

Before a separate activation approval, verify the approved Cloudflare account, reserved shop ID, distinct Shop D1 identity, exact database UUID in the binding, and the database's applied migrations. Apply the reviewed Control D1 onboarding migration and Shop D1 identity migration to their separately verified targets after backups and recovery review. Seed the Shop D1 identity with the audited tuple using operator tooling. Only then consider configuring `PLATFORM_SHOP_BINDING_ENABLED=true` on the dedicated private release.

The stored shop UUID is an operator attestation and can be copied with a database export. The Worker cannot independently discover the remote D1 UUID from this row. The receipt records a point-in-time identity match and does not establish that the ERP schema is ready. Recheck the current mapping and marker before granting tenant access. Roll back by disabling the route or restoring the previous Worker and retain both records for reconciliation.

## Private first Owner invitation candidate

The disabled-by-default `POST /api/platform/shops/invite-owner` accepts one field, `googleSubject`, from the Super Admin. Obtain the intended Owner's subject from a trusted Google account verification flow. The server chooses the configured pilot shop, checks the live Shop D1 identity and matching Control D1 binding receipt, and rechecks the current Super Admin session in the same SQL statement as issuance. Only one code can be active for the shop. It expires after ten minutes, and Control D1 stores its digest. The browser shows the code on issuance and clears it on sign-out. Treat it like a password and share it only through an approved private channel.

The third migration in the isolated onboarding queue creates the invitation audit table. Keep `PLATFORM_OWNER_INVITATION_ENABLED` unset until the separate Owner acceptance flow is reviewed, including Google signature, issuer, nonce and stable subject verification, immutable invite consumption, atomic first Owner membership, and signed-in two-shop isolation. The release must prevent issuing another first-Owner invitation once a membership has been created, even after the invite expires. After an interrupted issuance, check the active invitation before retrying. The code cannot be recovered from D1. A lost code expires naturally in this candidate. Obtain separate approval for the migration, activation and delivery to any recipient.

## First Owner acceptance service

The fourth onboarding migration creates the immutable first-Owner record. The internal service uses the invite code to derive a distinct Google nonce, verifies the configured `PLATFORM_OWNER_CLIENT_ID`, signature and invited subject, checks the pilot binding again, and consumes the invite in the same statement as the first Owner record. Issuance checks that record independently of given invite expiry.

The service provides no HTTP route, cookie or ERP access. Before activation, use a separately reviewed client origin and OAuth setup, implement browser redemption and revocable shop sessions, and verify routing and two-shop isolation. Existing invitation issuance must remain disabled until these controls and the reviewed migrations are in place.

## Pilot Owner sessions

The fifth onboarding migration adds an enabled access record and one current session per shop. First Owner acceptance creates the access record atomically. A session stores only a token digest and has no server-side timeout. A new login replaces the previous session. Sign-out removes that session, and disabling Owner access removes any active session. Re-enabling access requires a fresh sign-in. Session validation rechecks the current Shop D1 marker and matching Control D1 receipt.

This service expects freshly verified Google credentials at its future transport boundary. It exposes no route and sets no cookie. Before enabling issuance or Owner sign-in, apply migrations in order during a separately approved release, verify the client origin and Google OAuth registration, and review the browser challenge, cookie and logout flows. This migration does not automatically enable access for prior first-Owner audit rows. The invitation still expires after ten minutes.

## Release order

1. Approve the private HTTPS platform origin and admission control. That host must require private admission before traffic reaches the Worker. The Worker rate limit is a separate per-location protection and does not authenticate callers. Register the exact approved HTTPS origin on a Google OAuth Web client.
2. Verify the Cloudflare account and provision a dedicated staging **Control D1** under the approved change window. Check its name and UUID before use. The tenant D1, ERP staging D1, historical archive and public preview are outside this configuration. Capture the empty Control D1 backup and recovery point and rehearse restoration.
3. Prepare a protected copy of the local configuration for the release. Set a unique Worker name and rate-limit namespace, the approved Control D1 name and UUID, `PLATFORM_AUTH_ORIGIN` and `PLATFORM_CLIENT_ID`. Keep `preview_urls:false`. Use Worker-first asset routing for the custom-domain profile and bundled text modules for the native Access profile. Keep `workers_dev:false` for a private custom-domain profile. Use the dedicated Access-protected profile above for the existing admin workers.dev host. Keep `PLATFORM_TOTP_SECRET` in Worker Secrets and match `PLATFORM_FACTOR_VERSION` to the operator-provisioned factor state. Do not add secrets to the configuration or repository. If the config is outside the repo, resolve the Worker entry, migration queue and assets to the checked-out release tree.
4. Preview and apply only the reviewed `staging-migrations/platform-auth` queue to the approved Control D1. Confirm the exact two migration names, no tenant data and no enrollment/session rows. Provision the short-lived enrollment ticket for the verified Google subject and the first MFA factor using a trusted, reviewed operator workflow. Never place a ticket or factor secret in a URL, GitHub, chat, logs or CLI arguments.
5. After release approval, deploy the dedicated Worker and attach only the private platform origin. Enroll the first Super Admin, verify Google plus authenticator login, reload, sign-out, stale-session denial and private admission. Test cold and warm requests against **5 ms Worker CPU** using Cloudflare invocation logs. Release evidence should report timings and results without identity data or credential material.
6. If needed, detach the private route and revoke its sessions. Engage recovery review before restoring any database. A backup or restoration step must never point at the operational or historical ERP D1.

This candidate does not include a remote admission policy, live account provisioning, an Owner invitation endpoint, or a deployed login. Keep the public preview and ordinary ERP login on their existing separate configuration.
