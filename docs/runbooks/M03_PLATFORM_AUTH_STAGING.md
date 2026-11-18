# Platform Super Admin staging release candidate

## Candidate and local rehearsal

The platform sign-in page and API use `src/m03-private-platform-auth-worker.js` with the assets in `frontend/platform-auth`. The checked-in `wrangler.m03-platform-auth-local-test.jsonc` uses a synthetic D1 binding and disables both the workers.dev address and preview URLs. The two Control D1 migrations reproduce the tested bootstrap and session schema. They are a separate queue at `staging-migrations/platform-auth`.

## Access-protected workers.dev candidate

`wrangler.m03-platform-auth-access-staging.jsonc` is a separate, manual release candidate for the existing Worker `admin-hisabiq` at `https://admin-hisabiq.agnishuvo.workers.dev`. This is the only staging profile in this runbook that uses `workers_dev:true`. It has no custom routes and keeps previews disabled. The public `hisabiq` Worker remains on its database-free profile.

The host must remain protected by the existing Cloudflare Access application. All assets run through the Worker first. Because Static Assets does not forward `ctx.access`, the admin entry verifies `Cf-Access-Jwt-Assertion` using the pinned team issuer `https://agnishuvo.cloudflareaccess.com`, its signing keys, the exact expected application audience and the approved operator email. It refuses missing configuration, foreign origins, missing or invalid Access proofs, and non-human application credentials before serving assets or reaching D1. SherERP still verifies Google credentials and the authenticator code independently. The wrapper validates the assertion first, then validates one `CF_Authorization` browser cookie if the assertion is missing or rejected. Either proof must pass the same signature, issuer, audience, operator, application type, subject and time checks. Duplicate authorization cookies are rejected when the cookie is used as proof.

The profile refers only to the Control D1 `shererp-platform-control-staging`, UUID `957c0870-d58e-4efc-aea9-807f8fe18c56`. Use it for local verification and Wrangler dry run until separately approved. The profile does not supply any active OAuth, Access operator or MFA settings.

```sh
node --test tests/m03-platform-access-workers-dev.test.mjs
node --test tests/integration/m03-platform-access-release-local.spec.mjs
npx wrangler deploy --dry-run --config wrangler.m03-platform-auth-access-staging.jsonc
```

Before release, verify the existing Access application in the dashboard, including its exact audience, the exact host coverage, and a policy restricted to the intended human operator. Set `PLATFORM_ACCESS_AUDIENCE` and `PLATFORM_ACCESS_EMAIL` from that verified application in protected release settings. Verify the exact public `PLATFORM_CLIENT_ID` in Google Auth Platform beside the exact Authorized JavaScript origin. Keep any existing credentials and MFA settings in their protected store. Perform unauthenticated and unauthorized-identity checks on HTML, both asset URLs and API routes. Confirm no preview or alternate host can serve private content. Measure hosted CPU and latency with signed Access assertions because verification adds work to each request.

[Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) · [Access token validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

Run the rehearsal from the repository root with the CI-pinned Wrangler and Chromium.

```sh
node --test tests/integration/m03-platform-auth-release-local.spec.mjs
node --test qa/m01-platform-auth-page.spec.mjs
npx wrangler deploy --dry-run --config wrangler.m03-platform-auth-local-test.jsonc
```

## Release order

1. Approve the private HTTPS platform origin and admission control. That host must require private admission before traffic reaches the Worker. The Worker rate limit is a separate per-location protection and does not authenticate callers. Register the exact approved HTTPS origin on a Google OAuth Web client.
2. Verify the Cloudflare account and provision a dedicated staging **Control D1** under the approved change window. Check its name and UUID before use. The tenant D1, ERP staging D1, historical archive and public preview are outside this configuration. Capture the empty Control D1 backup and recovery point and rehearse restoration.
3. Prepare a protected copy of the local configuration for the release. Set a unique Worker name and rate-limit namespace, the approved Control D1 name and UUID, `PLATFORM_AUTH_ORIGIN` and `PLATFORM_CLIENT_ID`. Keep `preview_urls:false` and Worker-first asset routing. Keep `workers_dev:false` for a private custom-domain profile. Use the dedicated Access-protected profile above for the existing admin workers.dev host. Keep `PLATFORM_TOTP_SECRET` in Worker Secrets and match `PLATFORM_FACTOR_VERSION` to the operator-provisioned factor state. Do not add secrets to the configuration or repository. If the config is outside the repo, resolve the Worker entry, migration queue and assets to the checked-out release tree.
4. Preview and apply only the reviewed `staging-migrations/platform-auth` queue to the approved Control D1. Confirm the exact two migration names, no tenant data and no enrollment/session rows. Provision the short-lived enrollment ticket for the verified Google subject and the first MFA factor using a trusted, reviewed operator workflow. Never place a ticket or factor secret in a URL, GitHub, chat, logs or CLI arguments.
5. After release approval, deploy the dedicated Worker and attach only the private platform origin. Enroll the first Super Admin, verify Google plus authenticator login, reload, sign-out, stale-session denial and private admission. Test cold and warm requests against **5 ms Worker CPU** using Cloudflare invocation logs. Release evidence should report timings and results without identity data or credential material.
6. If needed, detach the private route and revoke its sessions. Engage recovery review before restoring any database. A backup or restoration step must never point at the operational or historical ERP D1.

This candidate does not include a remote admission policy, live account provisioning, an Owner invitation endpoint, or a deployed login. Keep the public preview and ordinary ERP login on their existing separate configuration.
