# SherERP Cloud — Connect Cloudflare through GitHub Actions

**Status:** Configuration PR only; **Cloudflare account not connected and no deployment has occurred**. This guide configures a **manual preview** Worker, not production and not a functioning ERP backend.

## Chosen deployment model: GitHub Actions (one deploy owner)

Use **GitHub Actions** to compile, test and deploy the Worker. Do **not** simultaneously enable Cloudflare's native Workers Builds Git integration to deploy the same Worker: two independent deployment systems can overwrite each other.

| Environment | Name | Deployment | D1 database | Trigger |
| --- | --- | --- | --- | --- |
| Test/build CI | No Worker | No deploy; Wrangler bundling dry-run | None | Pull requests |
| **Preview** | `shererp-cloud-preview` | Cloudflare Workers `workers.dev` | **None** | Manual GitHub Actions run, `main` only, confirmation + GitHub Environment |
| Production | `shererp-cloud` | **Disabled** by this setup | **Not configured** | Future owner-approved release process |

The original `wrangler.jsonc` is **not** used by this deployment workflow. The new `wrangler.preview.jsonc` is checked by `scripts/check-cloudflare-preview.mjs`, which rejects unexpected settings, production Worker name, D1 bindings, custom routes, unsafe external resources, and missing API-first routing.

## Prerequisite: merge the deployment workflow into main

At authoring time, GitHub `main` contains only the bootstrap README; the existing planning, source, M01 Worker and M02 Party PRs are in **draft** state. The manual `workflow_dispatch` button is available only when the workflow file exists on the repository's **default branch**.

1. Review/merge prerequisite PRs in their dependency order: foundation documentation **#1**, source snapshot **#2**, frontend static build **#3**, Worker RPC shell **#5**.
2. Review/merge the Cloudflare GitHub preview PR stacked on #5, retargeting to `main` after its parent merges. Keep the Worker API fail-closed until auth/D1 work is verified.
3. **You do not need to merge the Party/finance PRs to test an inert Worker preview.** Never activate unreviewed finance handlers just to deploy this shell.

These review/merge steps are user-authorized GitHub repository actions; this document does not merge anything automatically.

## 1. Create a least-privilege Cloudflare API token

1. Visit <https://dash.cloudflare.com/>, select your Cloudflare account.
2. Open **Account API tokens → Create Token**; choose a custom scope / template labeled **Edit Cloudflare Workers** (wording may change).
3. Restrict the token to **only the Cloudflare account** hosting `shererp-cloud-preview`. Avoid broad zone/domain/D1 edit permissions. Worker deploy scopes must permit script and static asset deployment.
4. Copy the token securely *once*; **never commit it, paste it in chat, or add it to a code file**. Rotate if exposed.
5. Copy the **Cloudflare Account ID** from account settings/dashboard. It is an identifier, not an API token.

Official reference: <https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/>.

## 2. Configure GitHub Actions Environment

1. In <https://github.com/shuvodelux-commits/SherERP_Cloud/settings/environments> create the environment named **`cloudflare-preview`** (exact name).
2. In that environment add the two *environment secrets*:
   - `CLOUDFLARE_API_TOKEN` = the narrowly scoped token from Step 1.
   - `CLOUDFLARE_ACCOUNT_ID` = your Cloudflare account ID.
3. Configure **required reviewer / deployment protection** if available on your repo/plan. Optionally restrict deployments to the **`main`** branch.
4. Under repository Settings → Actions → General, ensure standard GitHub Actions and the trusted `cloudflare/wrangler-action@v4` can run. The workflow grants only `contents: read` GitHub permissions.

**Never store either secret in a GitHub PR comment, `wrangler.jsonc`, .env file committed to GitHub, or repository log.**

## 3. CI verification (safe without Cloudflare credentials)

Every PR runs `.github/workflows/cloudflare-preview.yml` validation, which:

1. Runs the existing Node tests and the 84-file source hash verification.
2. Assembles the unchanged legacy HTML partials and replaces only the central `google.script.run` transport in the **generated** output.
3. Rejects preview configuration with production Worker name, D1 or unsafe bindings.
4. Runs `wrangler@4.161.0 deploy --dry-run --config wrangler.preview.jsonc` to **bundle without publishing**.

Example local commands, from the repository root:

```bash
npm test
npm run verify:source
npm run build:frontend
node scripts/check-cloudflare-preview.mjs wrangler.preview.jsonc
npx --yes wrangler@4.161.0 deploy --dry-run --config wrangler.preview.jsonc
```

No Cloudflare account authentication is needed for the local preview-config check or bundling dry-run. A local Wrangler runtime/browser smoke test is separate and still pending.

## 4. Manually deploy the preview (only after merged + secrets)

1. Open <https://github.com/shuvodelux-commits/SherERP_Cloud/actions>.
2. Select **Cloudflare Preview (manual deploy only)**.
3. Select **Run workflow**, choose branch **main**.
4. Enter the exact confirmation string **`DEPLOY_PREVIEW_ONLY`**.
5. Approve the protected `cloudflare-preview` environment if prompted.
6. Inspect the job results. It runs validation first, builds from the exact checkout, deploys **only `shererp-cloud-preview`**, then verifies the deployment URL's `/api/health` endpoint.

Expected health payload:

```json
{"status":"foundation","service":"shererp-cloud","database":"not-connected"}
```

The page may show the original ERP interface, but **login, sales, purchases, balances and all other business RPCs are intentionally unavailable (501)**. It must not be advertised or used as a production ERP.

If the workflow does not appear, it has **not yet been merged to main**. If authentication fails, check environment secret names and token account scope. If no deployment URL is available, verify the Cloudflare account has an enabled `workers.dev` subdomain.

## 5. D1 staging and production are separately gated

- This workflow does **not** create a database, bind D1, run `wrangler d1 migrations apply --remote`, import Sheets or deploy `shererp-cloud` production.
- M02's SQLite schemas, approved Unified Party mapping, M04 authentication, finance postings, backups and reconciliation remain separate prerequisites for staging database setup.
- Never reuse a production D1 database ID in the preview Worker. Later staging D1 needs a distinct approved binding, database, secrets and real Wrangler/D1 tests.
- Production deployment needs a **separate reviewed release workflow**, protected environment, restore plan, transaction-parity tests and explicit owner approval.

## Alternative: Cloudflare's native GitHub integration

Cloudflare Workers **Builds** can connect directly to a GitHub repo via Cloudflare Dashboard → Workers & Pages → Create application → GitHub and automatically build/preview on pushes. It is a valid alternative to the workflow above; it does **not** use the GitHub Actions environment secrets described here. If you choose that method later, disable this GitHub Actions deploy path to prevent conflicting deploys. Native Builds allows build, deploy and preview commands in its dashboard. See:

- <https://developers.cloudflare.com/workers/ci-cd/builds/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/>
- <https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/>

**No claim of connection:** Until a real Cloudflare-authenticated deploy completes and a preview URL/health check is verified, the GitHub-to-Cloudflare connection is not established.
