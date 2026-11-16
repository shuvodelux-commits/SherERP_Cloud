# SherERP Cloud — Staging D1 binding and local migration checks

**Scope:** GitHub configuration and local Wrangler/D1 testing only. **No remote database migration, live Worker deployment, or production access was performed.**

## Staging resource and separation

The owner reported creating a D1 database named `shererp-staging-db` with Database ID `aa04618e-1639-4cb9-bdf5-7b967d8b968b`. This ID is a resource locator, not an API credential; it has not been independently verified against their Cloudflare account.

`wrangler.staging.jsonc` assigns this database to binding `DB` for a **separate, reserved** Worker `shererp-cloud-staging`. The staging Worker deliberately has `workers_dev: false`, no custom route and no automatic deployment. The existing `shererp-cloud-preview` remains bound only to static assets, **not D1**.

Adding a Wrangler file to a Git repository does **not** by itself attach a binding to the deployed preview Worker or apply SQL to the remote database.

## Test-only GitHub workflow

`.github/workflows/staging-d1-local.yml` runs on PRs without Cloudflare credentials. It:
1. Runs source tests, validates the expected staging database identity and enforces Worker separation.
2. Builds the original static frontend and bundles the staging Worker via `wrangler deploy --dry-run`.
3. Applies `0001_core_catalog.sql`, `0002_party_identity.sql` and proposed `0003_auth_core.sql` and `0004_auth_staff_provenance.sql` via `wrangler d1 migrations apply shererp-staging-db --local` with isolated GitHub runner persistence.
4. Queries **local** SQLite/D1 and expects seven core tables, five auth tables, two source-provenance tables, four migration records, four Party history triggers, three auth session guards and six immutable provenance guards.

It contains no `--remote`, account/token secrets or actual Worker deploy step. CI creates only temporary local state.

## Local developer commands

Run from the repository root:

```bash
npm test
npm run build:frontend
node scripts/check-staging-d1.mjs wrangler.staging.jsonc wrangler.preview.jsonc
npx --yes wrangler@4.161.0 deploy --dry-run --config wrangler.staging.jsonc
npx --yes wrangler@4.161.0 d1 migrations apply shererp-staging-db --local --config wrangler.staging.jsonc --persist-to .wrangler/shererp-d1-local
npx --yes wrangler@4.161.0 d1 execute shererp-staging-db --local --config wrangler.staging.jsonc --persist-to .wrangler/shererp-d1-local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Seven existing core application tables (plus five separate auth and two source-provenance tables): `settings`, `product_categories`, `product_units`, `parties`, `party_roles`, `party_legacy_links`, `party_identity_review`. Other original legacy data/financial tables are not migrated.

## Future remote staging gate (M04 migration NOT authorized for remote apply)

After reviewing local-D1 CI, confirm the D1 database name/UUID from Cloudflare Dashboard, review backup and rollback, then separately approve a **remote staging-only** migration. Implement M03 D1 access and M04 authentication before deploying a publicly accessible staging Worker. Continue protecting cash/stock/ledger atomicity, Party role-account separation and optional manually approved noncash offsets.

Do not paste Cloudflare API tokens into chat, files, commits or build logs; do not run production migrations.

The proposed third and fourth M04 SQL migrations are exercised only in temporary local D1 and is not approved for remote application. The manual remote staging workflow refuses apply if the SQL count differs from the two previously approved core migrations; a separate owner review and staff-data cutover plan are required before that guard can be changed. The public Worker remains D1-free with no registered business RPCs.
