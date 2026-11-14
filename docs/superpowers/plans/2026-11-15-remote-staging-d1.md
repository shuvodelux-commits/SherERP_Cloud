# M02 — Protected remote D1 staging schema application plan

**Goal:** Provide a manual GitHub Actions mechanism to inspect and, with a separate explicit owner confirmation, apply two previously tested SQL migrations to the owner's isolated remote staging D1.

**Architecture:** Keep the live `shererp-cloud-preview` Worker DB-free and native Cloudflare Builds unchanged. Use `workflow_dispatch` restricted to `main` with protected `cloudflare-staging-db` environment credentials. Inspect remote target and its schema before any write, capture Time Travel recovery bookmark, then apply existing migrations only to an empty database. Never auto-restore.

## Test-first implementation

- [x] Wrote validation tests for exact name/UUID, empty remote schema, recovery bookmark and 7/2/4 post-migration checks.
- [x] Observed missing-feature failures (RED) before adding the guard and workflow.
- [x] Added `scripts/guard-remote-staging.mjs` and `.github/workflows/remote-d1-staging.yml`.
- [x] Local Node 22 test suite for this slice passed: **6 tests, 0 failures**.
- [x] Verified exact GitHub blob hashes of four technical files against locally tested versions.
- [ ] GitHub Actions full-suite verification and PR review.
- [ ] Owner configures GitHub Environment secrets + any supported protection rules.
- [ ] Owner runs read-only `inspect` and reviews real Cloudflare target/schema.
- [ ] Owner authorizes and dispatches `apply`; verify remote D1 migration evidence.
- [ ] Implement M03/M04 separately and retain accounting/Party safeguards.

## Release blockers

This PR does not authenticate to the owner's Cloudflare account and does not write any remote D1 schema. Remote SQL requires a separate manual workflow dispatch after the environment has been securely configured. Any pre-existing tables, unverified UUID, missing backup bookmark, or remote schema mismatch must stop migration.
