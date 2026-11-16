# M01 — Preserve Promise rejection for unserializable RPC arguments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, test-driven-development and verification-before-completion; follow RED → GREEN.

**Goal:** Ensure the generated SherERP `serverCall(fnName, ...args)` always returns a Promise, even if JSON serialization of arguments fails.

**Architecture:** Keep the source-owned original `legacy/source/javascript.html` unchanged. Change only the generated transport in `scripts/patch-rpc.mjs` so argument serialization and the same-origin fetch execute in a Promise chain; the existing HTTP response parsing and valid JSON error/data behavior remains unchanged.

**Tech stack:** Node.js ESM, node:test, existing build and Chromium browser regressions.

**Spec:** `docs/MIGRATION_PLAN.md` P1 and `docs/WORKSTREAMS.md` M01. Pinned frozen source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Why this is needed

The original source helper returns `new Promise(...)`, whose executor converts thrown errors into promise rejections. The current generated fetch bridge constructs `JSON.stringify({fnName,args})` as a synchronous argument to `fetch()`. A circular object or BigInt causes a synchronous `TypeError` before `serverCall()` returns, unexpectedly bypassing callers' `.catch()`. This is a compatibility/error-boundary regression, not an invitation to expose additional RPCs.

## Global constraints
- No edits to frozen UI source, styling, navigation, printing, Wrangler config, Worker handlers or authentication.
- Same `POST /api/rpc`, `{fnName,args}`, `credentials:'same-origin'`, valid-success unwrapping, JSON error handling, and current invalid-response guard.
- No auto-retry, no fabricated successful response, no swallowing of original serialization errors.
- No D1 bindings, migrations, original GAS changes or financial operations.

## Task 1 — RED test before implementation
**Modify:** `tests/rpc-patch.test.mjs`

- [ ] Build the real generated wrapper through `patchServerCall(legacy)` and `runInNewContext`.
- [ ] Call with cyclic array and BigInt arguments. Assert `serverCall()` does not throw synchronously, returns a thenable, and that its Promise rejects with a `TypeError`; `fetch` must never be called for invalid JSON arguments.
- [ ] Run exact test in GitHub Actions and record expected RED: synchronous `TypeError: Converting circular structure to JSON`.
- [ ] Commit test first.

## Task 2 — Minimal GREEN change
**Modify:** `scripts/patch-rpc.mjs`

- [ ] Wrap the generated fetch request construction in a `Promise.resolve().then(function () { return fetch(...); })` chain.
- [ ] Run full `npm test`, `npm run verify:source`, `npm run build:frontend` (via foundation CI), plus M01 Chromium tests. Review exact-head CI checks.
- [ ] Scope review, document RED/GREEN evidence, open PR for owner merge (no automatic merge).

## Review focus
- Circular objects and BigInt reject asynchronously without an HTTP request.
- Valid serializable arguments preserve order and same-origin credential behavior.
- Valid JSON server errors are not changed; malformed server JSON still gives `Server error`.
- Fetch rejection is not converted into a false success or repeated request.
- Frozen source remains byte-identical and the compiled UI still boots.

## Interfaces / impact
- **RPC method and request envelope:** unchanged `serverCall(fnName,...args)` → `POST /api/rpc` `{fnName,args}`.
- **Promise contract:** serialize errors change from synchronous throws to Promise rejections, matching the original source helper.
- **Files:** this plan, `tests/rpc-patch.test.mjs`, `scripts/patch-rpc.mjs`. **Schema/RPC registry/Party/stock/cash/bank/ledger:** unchanged.
- Integrated authenticated D1 POS/browser/printing parity remains a separate M03/M04 gate.
