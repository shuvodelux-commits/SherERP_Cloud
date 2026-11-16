# M06 write-once posting-child local D1 proof — Superpowers TDD

**Boundary:** one narrow M06 synthetic test-schema hardening; do not take M03 shared D1 transaction ownership. Original pinned source unchanged. KISS and GitHub-first.

1. **Inspect:** `AGENTS.md`, migration/workstreams/ADR-007, original M06/M07 contract, existing synthetic local D1 schema and posting tests.
2. **RED:** add a regression test that posts one split Bank+Cash+Customer-due invoice, attempts UPDATE and DELETE on each of six journal/item/movement/tender child tables, and verifies no post-commit state changes. Commit only docs/test; observe a failing GitHub Actions M03 real Workerd/D1 job.
3. **GREEN:** add minimal six-table immutable UPDATE/DELETE test-only DDL. The setup must drop the guards during deliberate fixture resets, and immediately restore them afterward. No business contract or source changes.
4. **VERIFY:** exact-head local Workerd/D1 aggregate, Foundation, original source hashes, M01 Chromium, M04 authentication and Cloudflare PR-safety CI. Confirm no new public Worker bindings.
5. **REVIEW:** compare branch to main, record RED/GREEN runs, preserve M07 separate audited reversal and production-writing gates. Do not merge without owner review.

**Definition of done:** all six posted child table UPDATE/DELETE operations fail at SQL boundary; posting/replay/rollback tests continue to pass with zero untracked mutations. This is a test-only proof, not production sale implementation.