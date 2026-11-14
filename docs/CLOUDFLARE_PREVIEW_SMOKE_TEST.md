# Cloudflare Workers Builds preview smoke test

This document provides an innocuous GitHub commit to exercise the Cloudflare native Git integration **without changing the original ERP interface or Worker runtime**.

Expected behavior:
1. GitHub emits a push for the feature branch `ci/cloudflare-native-pr-previews` and updates [PR #14](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/14).
2. Cloudflare Workers Builds detects the non-`main` branch and runs `npm run build:frontend`.
3. Cloudflare executes `npx wrangler@4.161.0 preview --config wrangler.preview.jsonc` in the isolated preview environment.
4. The Cloudflare dashboard shows a successful preview build and, if GitHub status integration is healthy, publishes a Preview URL to the PR.
5. `/api/health` on the preview continues returning `database: not-connected`, with **no D1 binding**.

If GitHub CI runs but Cloudflare does not register a build, investigate the **GitHub App user authorization**, Cloudflare build-trigger connection, or Cloudflare service errors. Do not interpret a green GitHub Actions check as a Cloudflare deployment success.

The Cloudflare setup and GitHub installation are separate from this documentation-only test commit; no production or staging database writes are permitted.
