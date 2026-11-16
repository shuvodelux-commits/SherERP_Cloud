# M01 — Explicit RPC success flag type guard (generated frontend only)

> Apply Superpowers GitHub-first plan → test-first RED → minimal implementation GREEN → Node and Chromium exact-head CI → owner PR review. Never auto-merge.

**Source authority:** Original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `AGENTS.md`; `docs/MIGRATION_PLAN.md`; `docs/WORKSTREAMS.md` M01; existing `legacy/source/javascript.html::serverCall`.

**Goal:** A successful HTTP 200 must not treat malformed explicit `success` values such as `"false"`, `0`, `1` or `null` as legitimate business success. Preserve the original GAS helper's compatibility with source methods returning raw data objects that **omit** `success`.

**Architecture:** Modify only the existing `scripts/patch-rpc.mjs::patchServerCall` generated same-origin fetch adapter; when JSON has an **own** `success` property, validate its value is strictly Boolean before checking `false` or extracting `data`. If invalid, throw generic `Error('Server error')` without displaying malformed backend payloads. No blanket requirement for `{success:true,data}` because the frozen original helper also accepts raw values and legacy calls must keep working. No new backend methods, dependencies or UI styling changes.

## 13-sentence impact and test overview

1. The frozen frontend uses a common `serverCall(fnName,...args)` helper for all pages.
2. The original helper rejects `success === false` and otherwise unwraps `data` when present.
3. The compiled fetch replacement currently follows that behavior but fails to validate the type of an explicitly supplied `success` property.
4. A malformed 200 reply with `success: "false"` can therefore resolve as if a business operation succeeded.
5. This change adds one narrow type check before the existing reject/unwrap logic.
6. The check applies only when a JSON response owns the `success` field.
7. Proper `success:true` data and `success:false` errors retain their prior behavior.
8. A legacy raw object with no `success` still resolves unchanged.
9. Malformed explicit flags reject with generic `Server error`, not raw backend data.
10. The unit regression executes the generated wrapper in an isolated Node VM.
11. The Chromium regression intercepts synthetic RPC responses while the actual original protected UI remains locked.
12. Test-only commits must fail on the current code before the generated adapter fix is committed.
13. The PR must show exact-head Foundation, Chromium desktop/mobile/print, source-byte and no-secret preview results before owner merge.

## RED
1. Extend `tests/rpc-patch.test.mjs` to require malformed own `success` values `"false"`, `0`, `1`, `null`, `[]` to reject with `Error('Server error')`; require proper success true, failure false and raw legacy object to retain existing semantics.
2. Extend `qa/m01-rpc-failclosed.spec.mjs` with a real Chromium test using a **test-only intercepted** 200 RPC response, assert malformed success rejects, no storage token, no protected shell open, and legacy raw data still passes.
3. Commit tests separately, open draft PR, inspect exact-head Node Foundation and Chromium RED logs and confirm failure is the expected malformed-status regression.

## GREEN
1. Change the generated replacement string in `scripts/patch-rpc.mjs` only: add a strict own-Boolean `success` check before the existing condition `!response.ok || !res || res.success === false`.
2. Keep `legacy/source` byte identical, original include/build, login pending guard, POS, invoice and print flows unchanged.
3. Rerun full Foundation source/build checks, Chromium+print and all other exact-head CI checks. Verify only plan, two tests and generated adapter changed.
4. Update draft PR with true RED/GREEN GitHub URLs, reproducible test counts, security boundaries and release blockers; leave owner-controlled merge.

## Exclusions
No public auth activation, no D1 binding or remote SQL, no original Sheets/Apps Script writes, no financial posting/cash/ledger/stock/Party changes, no M03/M09 Day Book transaction registration, no Cloudflare production or preview deployment changes, no redesign. The inert Worker remains 501 for unregistered methods and 503 for login. This increment is a client response-safety regression, not proof of full ERP migration readiness.
