# SherERP M03: actual workerd/D1 adapter integration

**Owner approved continuation:** PR #15 internal read-only adapters merged. Begin M03 acceptance by testing real Workerd+D1 behavior in an isolated local Worker. Keep original app, public preview, and remote staging D1 unchanged.

## Tasks

- [x] Verify PR #15 merged and existing migrations/schema/Party source link contracts.
- [x] Read Cloudflare Workers' current `createTestHarness()` and D1 migration test documentation.
- [x] RED: add Node security policy tests; verify failure on missing `wrangler.m03-test.jsonc` and CI workflow.
- [x] GREEN: add test-only config + PR-only CI; verify Node policy tests passed **3/3**.
- [x] Add synthetic fixture Worker and Node integration tests that call the real adapters against actual local workerd/D1 via `createTestHarness()`.
- [x] Confirm default `node --test` excludes the explicit `.spec.mjs` harness file when Wrangler is not installed.
- [x] Node syntax checks on test Worker and integration spec; verify code byte hashes after GitHub upload.
- [ ] Verify new GitHub Actions workerd integration job passes (not available locally because pinned Wrangler is not installed).
- [ ] Verify full Foundation and preview safety jobs remain green and Cloudflare PR Preview is inert.
- [ ] Investigate and fix any real-D1 harness defects test-first before requesting merge.

**Not in scope:** production or remote staging writes, public Worker D1 binding, authenticated RPC activation, or M03 full acceptance.
