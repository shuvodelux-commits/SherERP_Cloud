# M08 real local D1 Cash Session positional read parity — TDD plan

**Issue:** #430. **Design:** `docs/superpowers/specs/2026-11-17-m08-d1-positional-cash-parity-design.md`.

1. **RED:** add `tests/integration/m08-d1-positional-cash-workerd.spec.mjs` first. Import missing `tests/fixtures/m08-d1-positional-cash-schema.mjs` and `tests/fixtures/m08-d1-positional-cash-preview.mjs`; create fake `wrangler.m08-positional-test.jsonc` and PR-only `.github/workflows/m08-positional-cash-d1.yml`. Commit test-only. Confirm GitHub job fails with the expected missing module.
2. **GREEN:** create two disposable `m08_positional_*` SQLite table DDL fixtures and a **read-only**, tenant-bound D1.batch adapter returning existing `recalculateClosedSessionCash` output. Preserve row order using `ORDER BY legacy_row`, not dates. Map deleted/synthetic flags and cents precisely; reject duplicated imported IDs and malformed tenant/session. Never use these files in production migrations or public Workers.
3. **Verification:** real GitHub Workerd/D1 job must show parity against the pinned GAS VM source and unchanged D1 snapshots. Also require full Foundation Node tests, source verification and frontend build; inspect all PR checks, actual changed files, latest main conflicts and recorded RED/GREEN evidence. Leave the PR ready/unmerged for owner review.
4. **Later M08 slices:** only after approved actual M02 schemas, establish opening explanation and full positional **atomic** posting guards with auth, idempotency, audit, rollback. This read-only proof is not a financial writer, production data import or completed ERP migration.

**KISS:** Reuse merged pure recalculation module; one read-only adapter, one isolated fixture schema, one real Workerd test file, no new UI feature/endpoint.
