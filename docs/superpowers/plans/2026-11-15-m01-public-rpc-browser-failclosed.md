# Superpowers plan — M01 public Worker RPC negative contract in Chromium

1. Inspect `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/architecture/ADR-007-unified-party-relationships.md`, `src/index.js`, `src/rpc/handler.js`, `src/rpc/registry.js`, `scripts/patch-rpc.mjs`, `qa/serve-compiled-ui.mjs`, and existing M01 login browser coverage. Pinned original: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
2. **Test first:** add `qa/m01-rpc-failclosed.spec.mjs` on its own GitHub branch. Exercise the actual Worker facade through Chromium same-origin `fetch`; validate explicit HTTP status/error/no-store; call compiled `serverCall` to prove Promise rejection and protect original shell.
3. **Minimal wiring:** only after committing the new tests, add the independent test suite to existing `package.json` `test:m01:browser`; do not alter API code or source UI. No new dependency.
4. **Evidence:** validate exact-head M01 browser, Foundation Node + source hash/build, M03 local Workerd/D1 and Cloudflare PR safety; record honest observed failures. No artificial RED on a coverage-only task.
5. Open a small draft GitHub PR, document changed file/RPC/table inventory and review/rollback constraints. Remain unmerged until full exact-head CI and owner approval.

**Impacts:** `qa/m01-rpc-failclosed.spec.mjs`, `package.json` script, two docs only. **None:** source code, RPC dispatch behavior, D1/SQL, auth, Party/accounts, Cloudflare deployment/bindings, source repo. **Approval:** test-only baseline regression; no production enabling.
