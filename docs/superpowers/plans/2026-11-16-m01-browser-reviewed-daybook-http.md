# M01 — Use the reviewed RPC HTTP parser in real Chromium→local D1 acceptance

> Superpowers workflow: inspect, plan, test RED, smallest GREEN, verify exact-head CI, owner-reviewed PR. All work in GitHub.

**Goal:** Make the original-frontend Chromium→local Workerd/D1 Day Book acceptance test exercise the same validated HTTP handler merged in M03 #348, rather than an ad-hoc QA parser that bypasses Origin and content-type protections.

**Source:** Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Follow `AGENTS.md`, `docs/WORKSTREAMS.md` M01, `docs/MIGRATION_PLAN.md` P1 and M03 #335/#348 internal Day Book contracts.

**Architecture:** The opt-in loopback QA fixture `qa/serve-compiled-ui.mjs` already accepts `internalDayBookRpc`. When the existing browser test explicitly supplies it, delegate the actual incoming `Request` and `{dayBookBridge:{invoke:internalDayBookRpc}}` to the merged `src/rpc/handler.js::handleRpc`. This reuses validated origin, POST, JSON, body cap, method allowlist and response shape. Without opt-in, continue forwarding all API calls to the actual inert public Worker.

**Boundaries:** No production API/Worker/auth/registry edits, no source HTML/CSS/JS edits, no UI redesign, no new dependencies, no Cloudflare D1 bindings/deploy changes, no financial writes, real data, schema or migrations. Preserve the existing M01 browser test's source-shaped Day Book payload and denied/revoked test. This is synthetic single-business local D1 proof, not public auth readiness.

## Task 1 — RED browser regression before implementation

**Modify:** `qa/m01-daybook-local-d1.spec.mjs`

1. Keep current approved synthetic clerk, blocked staff, session and Settings fixture.
2. Spy on the test-only internal bridge's `invoke` count, proving one legitimate browser `serverCall('getDayBookBootstrap',token)` reaches D1 exactly once.
3. Send real browser-context HTTP requests to the existing loopback `/api/rpc` using Playwright `page.request`. Assert foreign Origin gives `403 Cross-origin RPC forbidden`; text/plain gives `415 JSON request required`; extra JSON fields and extra args give `400 Invalid RPC arguments`; an oversized request gives `413 RPC request too large`; malformed JSON gives `400 Invalid JSON`. Assert `no-store` and `nosniff` on all responses.
4. After probes assert internal D1 callback count did not increase, no protected DOM was exposed and no session token persisted. Preserve source-compatible data and blocked/revoked assertions.
5. Commit test only, observe M01 Chromium CI RED at exact test-only SHA; expect foreign Origin 200 (bug: custom fixture bypasses handler), not unrelated environmental failure.

## Task 2 — Minimal GREEN QA-only delegation

**Modify:** `qa/serve-compiled-ui.mjs`

1. Import existing `handleRpc` from `../src/rpc/handler.js`.
2. For the test-only opt-in when path `/api/rpc`, forward complete unaltered `Request` to `handleRpc` with a fixed trusted `dayBookBridge.invoke` callback; do not decode/reparse JSON or bypass security.
3. Otherwise always forward to the same actual public Worker. The production `src/index.js` never supplies a Day Book bridge.
4. Recheck original browser success, denied/revoked sessions, unrelated RPC 501, all negative HTTP gates, no internal D1 calls on invalid requests, and existing M01 browser/print tests.

## Task 3 — Verify and deliver for review

1. Run GitHub Foundation Node/source-manifest/frontend-build checks, M01 Chromium/local D1, and all exact-head shared checks.
2. Inspect diff: only this plan, browser QA spec, and QA server; no production/DB/wrangler configuration changes.
3. Update draft PR with direct RED/GREEN Actions evidence, HTTP contract, SQL and data impact and outstanding gates. Never auto-merge.

## Impact inventory

- Original page `daybook.html` still calls `serverCall('getDayBookBootstrap', authToken)` and sees the same four-field data. No client transport or generated HTML changes.
- Existing real `src/rpc/handler.js` is **reused**, not modified; original public route stays nonfunctional.
- SQL: existing local-only synthetic D1 fixtures, no new migration, no remote D1 writes. Financial records/Party/stock/cash/bank/ledger untouched.
- Full `getDayBookTransactions` RPC remains an M03/M09 integration prerequisite and is outside this scope.
