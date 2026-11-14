# SherERP Cloud — Automatic PR previews and main branch deployments

**Deployment owner: Cloudflare Workers Builds native GitHub integration (not GitHub Actions).**

Connected repository: `shuvodelux-commits/SherERP_Cloud`. Worker: `shererp-cloud-preview`. A successful deployment of the original frontend/Worker shell has been reported at [the Worker URL](https://shererp-cloud-preview.agnishuvo.workers.dev/). This is **not a production-ready ERP**: authentication and business RPCs remain deliberately unavailable and the Worker has no D1 binding.

## Desired automatic flow

1. Developer pushes to a feature branch or updates a GitHub PR. Cloudflare Workers Builds automatically runs the configured Build and Preview commands, creating or updating an isolated branch Preview.
2. Cloudflare posts its Preview URL to the GitHub PR where the integration supports it. Reviewers test the Preview and GitHub CI results.
3. Merge an approved PR into `main`. Cloudflare automatically builds that commit and runs the Deploy command, replacing the active Worker deployment.
4. No manual GitHub Actions release, Cloudflare dashboard deploy button, API token shared in GitHub, or duplicate deployment pipeline is required for ordinary frontend/Worker deployments.

**Important naming distinction:** `main` is the production *branch* for the currently named `shererp-cloud-preview` Worker. This does **not** deploy `shererp-cloud` or authorize real store transactions. A functioning ERP production release remains gated on M03–M11 testing, auth, accounting, reconciliation and cutover approval.

## Configure Cloudflare Workers Builds

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → `shererp-cloud-preview` → **Settings → Builds**.
2. Verify Git repository `shuvodelux-commits/SherERP_Cloud` is connected. Under **Branch control**, set **Production branch: `main`**, and turn **Enable Preview Builds** **ON**. This triggers a Preview for pushes to non-production branches.
3. Set the **Build command** to `npm run build:frontend`.
4. Set the **Deploy command** (for `main`) to `npx wrangler@4.161.0 deploy --config wrangler.preview.jsonc`.
5. Set the **Preview command** (non-main branches) to `npx wrangler@4.161.0 preview --config wrangler.preview.jsonc`.
6. Save. Ensure a Preview host is enabled in **Worker → Settings/Domains** (Workers.dev Preview URLs and/or a preview custom domain). The existing main Worker has Workers.dev enabled.
7. New Workers normally use **Worker Previews**. If this existing connected Worker instead displays a **Set up Worker Previews** banner under Settings → Builds, follow the one-time **Switch to Worker Previews** wizard and select the `wrangler preview` command. This switch cannot be reversed.
8. In the **Previews Base** bindings/secrets settings, do not import D1, cash, stock, production secrets, or other mutable resources. In this repository, `wrangler.preview.jsonc` deliberately contains `"previews": {}` and has no D1 binding.
9. Recommended GitHub repository Rulesets/Branch protection on `main`: require passing source/Worker tests and PR review before merge. Restrict direct pushes. Cloudflare still deploys a newly merged `main` commit automatically.

| Setting | Value |
| --- | --- |
| Cloudflare Worker | `shererp-cloud-preview` |
| GitHub repository | `shuvodelux-commits/SherERP_Cloud` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build:frontend` |
| Deploy command | `npx wrangler@4.161.0 deploy --config wrangler.preview.jsonc` |
| Preview command | `npx wrangler@4.161.0 preview --config wrangler.preview.jsonc` |
| Enable Preview Builds | **ON** |
| PR preview D1 bindings | **None** |

## Verify end-to-end with one harmless pull request

1. Create a small documentation-only branch and open a GitHub PR against `main`.
2. In Cloudflare → `shererp-cloud-preview` → **Builds**, check that the branch built and produced a Preview. Locate its Preview URL in Worker → **Previews** and in the GitHub PR comment.
3. Open the Preview URL, then `/api/health`: it should return `"status":"foundation"` and `"database":"not-connected"`.
4. Merge the reviewed PR. Verify Cloudflare creates a successful production-branch build for the new `main` commit and the existing `shererp-cloud-preview.agnishuvo.workers.dev` serves that active version.
5. If the PR comment says **No Preview URL**, ensure the Preview host is enabled and the Preview command uses `wrangler preview` (not `wrangler versions upload`); the latter uses production resources and is not recommended for PR branch isolation.

## GitHub Actions and D1 safeguards

`.github/workflows/cloudflare-preview.yml` runs **PR checks only**, with no credentials and **no deploy job**. Cloudflare's connected GitHub integration owns the Preview/deploy operations; do not configure a second GitHub Actions deploy to the same Worker.

The separate `.github/workflows/remote-d1-staging.yml` requires explicit authorization for **staging D1 database inspection or migration**; database schema writes should **not** run automatically on every application merge. Staging D1 is `shererp-staging-db` and belongs to separately reserved `shererp-cloud-staging`, not the publicly deployed Worker.

No GitHub commit alone can turn on Cloudflare dashboard's **Enable Preview Builds** control; the Cloudflare account owner must make this one-time dashboard change and verify the first real Preview URL.

## Cloudflare references

- [Build branches — enable Preview Builds and select `main`](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [Workers Builds configuration — Build/Deploy/Preview commands](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Worker Previews — isolated PR environments](https://developers.cloudflare.com/workers/previews/get-started/)
- [Troubleshooting missing Preview URL comments](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/)
