# M01 — Real Worker API parity in preserved-UI browser fixture

**Goal:** Remove a duplicate M01 HTTP error emulator so Chromium exercises the same inert Worker router as production code, without activating ERP access.

**Source of truth:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, pinned original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, and spec `docs/superpowers/specs/2026-11-15-m01-real-worker-api-fixture-design.md`.

## Superpowers TDD

1. **RED:** Commit a new `tests/m01-worker-api-fixture.test.mjs` before changing fixture code. Assert direct real `src/index.js.fetch` matches loopback HTTP for real method validation, content-type, invalid JSON, login unavailable, arbitrary RPC, unknown route and headers. Run GitHub Actions on test-only HEAD; record the expected observed failure (e.g. `/api/health POST` 200 vs 405, `/api/rpc GET` 501 vs 405).
2. **GREEN:** Replace M01 fixture's manually encoded API responses with a tiny Node HTTP-to-Fetch adapter delegating `/api*` requests to the public inert Worker entrypoint. Do not pass `authAdapter` or D1 to the Worker. Keep compiled HTML and loopback-only binding intact.
3. **Verification:** Re-run `npm test`, `npm run verify:source`, `npm run build:frontend`, PR-only `npm run test:m01:browser` on Chromium and all applicable GitHub workflows. Record exact-head pass/fail, no unsupported claims.
4. **Review:** Open one scoped draft PR describing RED/GREEN evidence, source/no-schema/no-RPC impact and remaining M04/M10 gates. Do not auto-merge.

## Impact / rollback

File inventory: `qa/serve-compiled-ui.mjs` one test fixture edit, `tests/m01-worker-api-fixture.test.mjs` new synthetic Node test, this plan and the design spec. No `src/**`, original `legacy/source/**`, SQL, deployment, accounts or data changes. Rollback is a PR revert. Do not claim fixture parity equals end-to-end deployed Workers/D1 or invoice print parity.
