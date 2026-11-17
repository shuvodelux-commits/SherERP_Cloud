# M11-14 — Block alternate Wrangler publishing commands in GitHub Actions

Date: 2026-11-17. Workstream M11 / issue #306, coordinator #456. Base main `1f068fc3c30c625446c560364fb872ae68cb8bc1`. Pinned original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Twelve-sentence execution overview

1. The project's only authorized automatic public preview deployment owner is Cloudflare Workers Builds.
2. M11-12 and M11-13 have already introduced a GitHub Actions source audit and a strict integrity seal on the approved manual staging D1 workflow.
3. The audit currently rejects a non-dry-run `wrangler deploy` command but does not explicitly recognize other Wrangler publication verbs.
4. Those alternate verbs could publish Cloudflare Pages or Worker versions from GitHub Actions and violate the single-deployment-owner boundary.
5. M11-14 adds the smallest possible read-only scanner check for `wrangler pages deploy`, `wrangler pages publish`, `wrangler versions upload`, `wrangler versions deploy`, and `wrangler publish`.
6. It covers invocations prefixed with `npx --yes`, `pnpm exec`, and optionally a pinned `wrangler@<version>` without needing additional dependencies.
7. It must reject those publication verbs even if another `wrangler deploy --dry-run` appears on the same workflow line or an alternate verb itself claims `--dry-run`.
8. It must preserve the existing explicit `wrangler deploy --dry-run` exception for local bundle verification, with no relaxation of its options.
9. The existing manual `remote-d1-staging.yml` identity seal and all remote-D1 and secret checks remain unchanged.
10. Regression tests will first reproduce the concrete publishing bypass, commit RED to a dedicated branch, and use GitHub Actions as the observed test failure source.
11. A minimal scanner update will follow, requiring successful full exact-head GitHub CI, mergeability and owner review before integration.
12. This is a static repository guard only and never authorizes a Worker production deployment, D1 migration, private data export, write resumption or M10/M11 cutover.

## File ownership and interface impact

- **M11-owned changed files:** `scripts/m11-ci-deployment-ownership.mjs`, `tests/m11-ci-deployment-ownership.test.mjs`, this plan.
- **Inputs read only:** `.github/workflows/*.yml`/`*.yaml`, `wrangler.preview.jsonc` via existing audit; no workflow/config edits.
- **Owned behavior:** fixed blocker code `M11_CI_DEPLOY_COMMAND_BLOCKED`, existing `safe:false` and no authorization flags.
- **Shared M03 owner surface untouched:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, `wrangler*.jsonc`, invoice/stock IDs, Cash Session, posting/reversal kernel.
- **Source functions, RPCs, SQL tables, original business IDs:** none; input is CI source text, not actual business data.
- **Dependency:** PR #470 merged to main at `458566f4ac5e668e88bbfe4a5b7b330ab5b8197c`, already confirmed; coordination #455 and #456.
- **RED:** failing Node test on alternative publishing verbs against old implementation, separate test commit.
- **GREEN:** existing local audit pass, negative mutations blocked, full GitHub Actions including real Workerd/D1/browser passes on exact head.
- **Merge sequence:** new M11 branch from fresh main, one PR to main, no merge until full CI/reviews. Rollback: revert these M11 files only.
- **Production boundary:** parallel preparation only; M10 #312 and M11 #306 must retain NO-GO.
