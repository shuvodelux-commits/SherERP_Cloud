# Superpowers M01 — login rejection lifecycle test-first plan

**Goal:** Add actual preserved-UI Chromium coverage for rejected login retry and rejected persisted session rehydration. **Pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

1. Inspect `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007 (non-impact), `qa/serve-compiled-ui.mjs`, `src/rpc/handler.js`, `scripts/patch-rpc.mjs` and original `bootstrapSession_` / `doLogin_`.
2. Add two independent real Chromium tests in `qa/m01-browser.spec.mjs` on a dedicated GitHub M01 branch **before** implementation. Assert exact network method/payload/status and source DOM/session changes without emulating a successful API.
3. Execute test-first commit through PR-only GitHub Chromium and Foundation. If RED, identify a real source/fixture gap and seek review for the smallest compatible change; no artificial failures. If green first try, document that the task is test-only, and no behavior change is necessary.
4. Require exact-head `npm test`, frozen source hashes, frontend compilation, Chromium tests and relevant local-only Workerd/D1/Cloudflare PR safety checks. Record actual outputs and limitations.
5. Open/maintain draft PR for owner review. No automatic merge.

**Impact:** one QA script, two documentation files. **New production files:** none. **RPC:** test-only existing `login`, `validateSession` calls, no registry implementation. **SQL/D1/tenancy/Party/finance:** none. **Cloudflare config/deploy:** none. **Source frontend:** untouched. **Rollback:** revert PR.
