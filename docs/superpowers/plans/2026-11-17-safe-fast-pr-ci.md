# M11 CI-0023 — Fast safe PR confidence gate, cancellation and lockfile caching

**Context:** `SherERP_Cloud` currently starts 42 pull-request workflows per head, with no per-PR superseded-run cancellation and essentially no npm cache. Cloudflare Workerd/D1, accounting, auth, stock, Party and data migration regressions remain mandatory; speed must not be achieved by waiver, skipping protected checks, or truncating suites.

## Superpowers scope (12-sentence review)
1. Create a fast PR-only confidence workflow for immediate source, Worker syntax and existing UI assembly feedback.
2. The fast lane uses only synthetic local fixtures, never remote Cloudflare D1 or production deployment.
3. Keep all existing 42 regression workflows and their required names, triggers, tests and branch protections unchanged.
4. Add concurrency groups isolated by workflow identity and PR number, so a new head cancels only superseded versions of the same workflow on the same PR.
5. Do not cancel manual, staging, push-to-main or other non-pull-request operations.
6. Apply npm download-tarball caching to each existing Node setup step, relying on the hash of the existing committed `package-lock.json`.
7. Continue `npm ci` on every job so no installed `node_modules` tree, stale binary, test state or D1 fixture crosses jobs.
8. Keep the six-shard fail-closed M03 Workerd matrix and all 42 focused regressions enabled.
9. Verify configuration changes through an independent Node contract test that scans every PR workflow and rejects missing cancellation or npm caches.
10. Commit the test alone first and demonstrate the expected failing RED in GitHub Actions.
11. Implement the smallest YAML-only change and obtain GREEN on the same commit, with fresh Cloudflare preview, full Node/source, UI, and local Workerd/D1 results.
12. Merge only after all exact-head workflows and repository protections pass; measure duration reduction from subsequent runs instead of claiming a speed figure without evidence.

**No direct-to-main changes, no production Writer/D1 migrations, no source or original UI edits.** If a workflow does not use Node or is manual-only, do not add a fictitious cache. Cancellation is deliberately conditioned on `github.event_name == 'pull_request'`.

This is an initial safe improvement. A separate future path-aware risk routing design may reduce the count of relevant D1 jobs, but only after a reviewed fail-closed source-to-test dependency map and branch protection audit; do not replace broad regression gates speculatively.