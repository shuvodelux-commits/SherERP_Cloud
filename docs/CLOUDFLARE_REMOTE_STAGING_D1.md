# SherERP Cloud — Gated remote staging D1 schema migration

**Status:** GitHub workflow preparation only. **No remote SQL has been executed**, no staging Worker has been deployed, and the public preview remains D1-free.

## Target and scope

- Staging D1: `shererp-staging-db`, database ID `aa04618e-1639-4cb9-bdf5-7b967d8b968b`.
- Config: `wrangler.staging.jsonc`, which names the separate `shererp-cloud-staging` Worker and has `workers_dev: false`.
- Only existing migrations `0001_core_catalog.sql` and `0002_party_identity.sql` are eligible. No source data, ledgers, stock, finance, production transactions or cross-role settlement.

Cloudflare's native GitHub Builds already owns `shererp-cloud-preview` deployment. This new GitHub Action is solely for staging **D1 inspection and migration**. It has no deploy command, no push trigger, and does not reuse the existing preview Worker.

## Configure GitHub Environment (owner action)

1. In Cloudflare Account API Tokens, create an account-scoped token with **D1 Edit/Write** permissions for the account holding this staging database. Do not grant Workers deployment permissions if unnecessary; never paste the token in chat or commit it.
2. Open [GitHub Environments](https://github.com/shuvodelux-commits/SherERP_Cloud/settings/environments). Create the exact environment `cloudflare-staging-db`.
3. Add two **environment secrets**: `CLOUDFLARE_D1_STAGING_TOKEN` (your D1 token) and `CLOUDFLARE_ACCOUNT_ID` (your Cloudflare **account** ID, not the database UUID).
4. Configure required reviewers and restrict deployment branches to `main` if supported by the repository plan. Do not use the existing Workers deployment environment for this action.

## Stage A — inspect remote D1 (read-only)

After the workflow PR is reviewed and merged, open [Actions](https://github.com/shuvodelux-commits/SherERP_Cloud/actions) → **SherERP staging D1 — manual inspect or apply** → Run workflow → select `main`, operation `inspect`, confirmation blank.

The job authenticates to Cloudflare, runs tests, checks the **exact database name and UUID** using `d1 list --json`, and executes only a remote `SELECT` counting non-system tables. A newly created empty staging D1 should show **0** user tables. Any other count requires review before schema application.

## Stage B — apply two migrations (explicit separate action)

Only after the inspection is successful and the exact database is confirmed, run the same workflow on `main` with:

- Operation: `apply`
- Confirmation: `APPLY_STAGING_D1_SCHEMA_ONLY`

It revalidates the resource and **refuses to apply if any non-system user table already exists**. Then it captures the current D1 Time Travel bookmark and executes:

```bash
npx --yes wrangler@4.161.0 d1 migrations apply shererp-staging-db --remote --config wrangler.staging.jsonc
```

Wrangler records migration state and Cloudflare captures the migration backup. A read-only post-check requires **7 application tables, 2 applied migrations, 4 historical Party protection triggers**. If any check fails, stop and investigate; **do not blindly rerun apply**.

## Recovery limitations

Time Travel makes it possible to restore the staging D1 to a recorded pre-migration bookmark while it is retained. A restore **overwrites the live database**, cancels in-flight work and is not automatically executed by this workflow. The pre-migration bookmark is printed in the protected workflow log. Restore requires a separate authorized decision and post-restore validation. Cloudflare's Time Travel retention differs by plan (typically 7 days Free and up to 30 days Paid).

## Next development milestone

After remote staging schema verification, build M03 read-only `env.DB` access and M04 authentication behind a private staging boundary. Do not bind the unfinished application to the public `shererp-cloud-preview`, enable unported business RPCs, or import production Sheets.

References: https://developers.cloudflare.com/d1/reference/migrations/ and https://developers.cloudflare.com/d1/reference/time-travel/
