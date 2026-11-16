# M01 Generated RPC Invalid-JSON Boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, test-driven-development and verification-before-completion. Checkboxes track RED → GREEN.

**Goal:** Keep the original UI's central `serverCall(fnName, ...args)` transport fail-closed with a stable error when an HTTP RPC response is empty or not JSON.

**Architecture:** Change only the generated-page transport patcher, not any original HTML/JS. Catch JSON body parsing failures at the HTTP response boundary and reject with `Error('Server error')`; retain existing JSON success/data unwrapping and explicit error-message handling.

**Tech Stack:** Node.js test runner, JavaScript ESM, existing build script, existing Chromium UI test suite.

**Spec:** `docs/MIGRATION_PLAN.md` P1, `docs/WORKSTREAMS.md` M01 and pinned `legacy/source/javascript.html` at `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Global constraints

- Frozen `legacy/source` and original GAS/Sheets remain byte-identical and untouched.
- Keep function name, argument order, same-origin credentials, request body, existing success/data unwrapping, and valid JSON error messages unchanged.
- No changes to `src/rpc`, D1, security policy, schema, UI markup, style, printing, deployment or public authentication.
- Preserve legacy direct-return values without inventing a mandatory `success: true` field.

## Review focus

- HTTP 200 with malformed JSON must not resolve as a successful business operation or reveal a raw parser diagnostic.
- HTTP 503 with an empty or HTML body must reject using a controlled application error.
- Structured JSON `success:false` must still surface its supplied safe server message.
- Structured JSON `success:true,data` must still unwrap the data.
- Network-level fetch rejection must remain a rejection (no automatic retry or false success).

## Task 1 — RED: prove malformed HTTP responses leak a parsing error

**File:** `tests/rpc-patch.test.mjs`.

- [ ] Add a test executing the *real generated wrapper* via the existing `runInNewContext` helper with a response whose `json()` rejects as `SyntaxError`.
- [ ] Cover both HTTP 200 malformed JSON and HTTP 503 empty/non-JSON body; assert the `serverCall()` promise rejects with `{name:'Error',message:'Server error'}`.
- [ ] Commit tests before production changes, open a draft PR, read the failing GitHub Actions test output. Expected RED: a `SyntaxError` escapes unnormalized.

## Task 2 — GREEN: normalize only the HTTP JSON decoding failure

**File:** `scripts/patch-rpc.mjs`.

- [ ] Attach one Promise rejection handler to `response.json()` that throws `new Error('Server error')` without catching or replacing the subsequent valid-JSON business error.
- [ ] Preserve all other patch boundaries and generated code unchanged.
- [ ] Confirm `npm test`, source checksum verification, frontend assembly, M01 Chromium browser/printing checks and complete PR CI from exact-head GitHub Actions.
- [ ] Update the PR with RED/GREEN evidence, impact and still-open M03/M04 integration gates; leave merge to the owner.

## Contract / impact inventory

- **RPC request:** same `POST /api/rpc` with JSON `{fnName,args}`; same-origin credentials preserved.
- **RPC response:** valid JSON success/error unchanged; malformed/empty response now gives controlled `Server error` rejection.
- **Files:** plan, one test and one generated-code patcher. **SQL and financial impact:** none.
- **Remaining gate:** this regression is not authenticated, integrated D1 ERP/POS/browser parity evidence.
