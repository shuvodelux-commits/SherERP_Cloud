# M11-12 — Static single-deployment-owner and PR secret/remote-D1 guard

Date: 2026-11-17. Workstream **M11** / issue **#306**, coordination **#456**. Base: `main@666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`. Source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Superpowers design and acceptance (12 sentences)

1. Cloudflare Workers Builds, not GitHub Actions, owns the existing public inert preview deployment from `main`.
2. The repository currently contains 43 Actions workflows, including many nondeployable local Workerd/D1 regression jobs and one explicitly manual staging-only D1 workflow.
3. Accidental addition of a live `wrangler deploy` to any CI workflow could establish a second deployment owner and undermine the preview isolation rule.
4. A PR-triggered remote `wrangler d1` operation or new secret-bearing workflow would also bypass the intended data and authorization boundaries.
5. M11-12 adds a read-only, dependency-free static repository audit of **all** workflow `.yml`/`.yaml` files and the existing preview Wrangler configuration.
6. Every ordinary workflow must avoid credential expressions, remote D1 operations, Wrangler publish commands, and unreviewed Cloudflare deployment actions.
7. The one allowed remote staging workflow must remain manual-only, pinned to the protected `main` ref, environment-scoped, and explicitly confirmed for the existing limited migration-only operation.
8. Existing local D1 commands and `wrangler deploy --dry-run` are allowed as test and bundle checks, not as release authority.
9. The public preview configuration must still satisfy the already-approved DB-free validator; this task will not duplicate or relax its rules.
10. Tests will first introduce the missing audit contract, establish the expected RED in GitHub Actions, then verify GREEN on real repository workflow files and malicious synthetic workflow mutations.
11. The implementation must report only fixed non-sensitive blocker codes and filenames of affected repo workflow files, never secrets or credential values.
12. Passing this repository audit is only a source-code safety check; production D1 binding, remote migration, live RPC, source write freeze, actual deployment ownership and M10/M11 GO remain separately blocked.

## Ownership / dependency handshake

- **Lane owner:** M11 ops/CI safety; prior M11 PRs #423 and #414 are merged into main.
- **Owned exact changed files:** new `scripts/m11-ci-deployment-ownership.mjs`, new `tests/m11-ci-deployment-ownership.test.mjs`, this plan; optional M11 runbook appendix `docs/runbooks/M11_PRODUCTION_CUTOVER.md` (single M11 lane reservation).
- **Read-only inputs:** `.github/workflows/*.{yml,yaml}`, `wrangler.preview.jsonc`, `scripts/check-cloudflare-preview.mjs`. No workflow/config writes.
- **RPC methods:** none. **Source functions:** none. **SQL tables or IDs:** none. **Runtime read/write scope:** local repo files only, no DB, API, cloud network or business-data access.
- **Allowed manual exception:** existing `.github/workflows/remote-d1-staging.yml` only; no expansion of its permissions.
- **Dependency heads:** AGENTS.md and PARALLEL_EXECUTION.md merged via coordination PR #455; M03 readiness gate remains blocked.
- **RED acceptance:** `npm test` discovers the new file and fails on the expected missing module; no staged infrastructure changed.
- **GREEN acceptance:** actual 43-workflow repository scan succeeds; new PR/push-based remote D1, direct deploy, preview binding, missing manual confirmation, unapproved actions and injected credential expression mutants fail closed.
- **Integration:** branch -> one draft PR targeting `main` -> full exact-head GitHub Actions, review and conflicts -> owner merge -> verify files exist on main.
- **Rollback:** revert the M11-only test/audit/runbook files; no production database or business-data rollback.
