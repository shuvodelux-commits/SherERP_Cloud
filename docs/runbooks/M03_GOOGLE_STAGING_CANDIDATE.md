# M03 Google Sign-In staging candidate

The candidate serves Google authentication, the Google-authenticated shell, and the previously reviewed password authentication RPCs. It does not serve business RPCs. The default preview and business deployment configurations do not mount this entry point or bind its database.

## Prepare the release

1. Use the approved staging origin. The checked-in candidate is pinned to the proposed `https://shererp-cloud-google-staging-candidate.agnishuvo.workers.dev` origin. Register that exact HTTPS origin on a Google OAuth Web application client. Keep the public client ID out of repository configuration so an ordinary build has Google sign-in disabled. A reviewed release configuration supplies it as `GOOGLE_CLIENT_ID`.
2. Complete and reconcile the separately approved historical staff import first. The protected importer requires the original auth-only 0001–0004 staging prefix. Applying the Google migration first would invalidate that preflight.
3. Confirm the target database, exclusive writer and reviewed recovery procedure. Capture and rehearse restoration of a fresh backup. The Google schema candidate is the single `staging-migrations/google-auth/0015_google_staging_auth.sql` file selected by `wrangler.m03-google-auth-staging.jsonc`. It depends on the core auth prefix. The root migration queue is outside this release.
4. After separate authorization for the Google schema change, record the migration and verify the original roster, credentials, sessions and business tables. The migration adds only Google links, challenges and sessions. It creates no staff or identity link.
5. Establish the Administrator’s Google subject through a reviewed reauthentication or account-recovery operation. Create the explicit link to the existing immutable staff user ID. A matching email cannot establish this link. Retain revocation records and spent challenges. Revoking a Google link is permanent for that staff ID under this schema. Changing the linked Google account requires a separately reviewed recovery procedure or migration. Define a reviewed retention policy before using this design for a broader rollout.

## Build and verify

```sh
npm run build:frontend
node scripts/build-staging-google-ui.mjs dist dist-google-staging
npx wrangler deploy --dry-run --config wrangler.m03-google-auth-staging.jsonc
```

The candidate configuration has `workers_dev:false`, `preview_urls:false`, and no routes. It pins the staging database and checks the configured origin on requests handled by the Worker. Cloudflare can serve static assets directly. Route attachment and deployment require separate approval. Before attaching a route, decide how to protect the shared challenge quota from exhaustion. Every unauthenticated requester counts against the same cap of 12 challenges per minute.

After approved release, verify the browser Google flow against the linked Administrator, including reload and logout. Check that an unlinked Google identity and legacy-token substitution are denied, an actively locked account cannot create a Google session, and unsupported business RPCs stay unavailable. Confirm the original password verifier and business records are intact. Measure the hosted flow against the selected Workers plan. To suspend the candidate, remove its route or unset the Google client binding under the approved release procedure. Do not clear or rewind a shared staging database to disable this feature.
