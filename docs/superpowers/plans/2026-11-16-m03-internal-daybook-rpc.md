# M03 Internal Day Book RPC Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, test-driven-development and verification-before-completion in this GitHub-first branch. Steps use checkbox (`- [ ]`) tracking.

**Goal:** Connect one original browser RPC to reviewed awaited D1/authorization internals without enabling any public business endpoint.

**Architecture:** Source-shaped `getDayBookBootstrap(token)` in an internal one-method dispatcher delegates to the existing `createM09AuthorizedDayBookBootstrapReader`, then returns the source `{success,data}` envelope. Server time is trusted, the token is validated, and all D1/authorization errors are normalized without disclosure.

**Tech Stack:** Cloudflare D1, Workers/Workerd test harness, ECMAScript modules, Node 22 test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-m03-internal-daybook-rpc-design.md`

## Global Constraints

- Source pin `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Original `daybook.html::dbLoad -> getDayBookBootstrap(authToken)`, `DayBook.gs`, `Utils.gs` shared envelope.
- No public `src/index.js`, `src/rpc/handler.js` or `src/rpc/registry.js` changes; no production D1 binding or staging writes.
- M04 D1 security remains authoritative, Party roles are not staff roles, no SQL schema or finance operation edited.
- Exclusive M03 module+test ownership; use existing vetted M09 D1 read instead of duplicated permission SQL.
- TDD: observed test-only failing GitHub run, minimal fix, full Node checks, local actual Workerd/D1, PR and owner-only merge.

## 14-sentence overview

1. M03 browser RPC discovery was verified and merged in PR #317.
2. The source Day Book page calls `getDayBookBootstrap` with a session bearer.
3. The original GAS function requires `daybook.view` and returns four data fields.
4. M09 has a verified internal D1 SELECT that checks the current M04 session and role in the same statement.
5. That reader returns the four fields but does not own the browser-facing envelope.
6. This task creates a narrow bridge that retains the original method name and argument shape.
7. The bridge is never imported by the public Worker entry or RPC registry.
8. The only accepted method is `getDayBookBootstrap`.
9. Its only accepted argument is the single lowercase 64-character session bearer.
10. A server-controlled clock supplies the timestamp, never client args.
11. The bridge awaits the existing authorized D1 reader before constructing `{success:true,data}`.
12. Denied sessions, malformed inputs and D1 failures return controlled error envelopes with no private details.
13. Node and real isolated Workerd/D1 tests verify source fields, no Promise leak, revocation, no SQL mutation and no exposed routes.
14. Completion is one internal read-only RPC contract increment, not ERP or public authentication readiness.

## Review Focus

1. Duplicate or extra fields in the input must be rejected, including accessors/symbols: Node test.
2. Wrong method, token or client timestamp/role must never reach D1: Node test.
3. A D1 rejection, corrupted binding or invalid server clock must not leak SQL and credentials: Node test/Workerd test.
4. Current session revoked, user disabled or role denied must not return a success envelope: real Workerd test.
5. A successful bootstrap must be awaited, JSON serializable, match the source four fields and exclude private Settings: real Workerd test.

---

### Task 1 — Freeze RPC adapter behavior (RED)

**Files**
- Create: `tests/m03-daybook-rpc.test.mjs`
- Create: `tests/integration/m03-daybook-rpc-workerd.spec.mjs`

**Interfaces**
- Expects `createM03DayBookRpcBridge(env,{now}={})` exported from `src/rpc/internal-daybook-bootstrap.js`.
- Expects `bridge.invoke({fnName:'getDayBookBootstrap',args:[token]})` Promise resolving source envelope, not a nested Promise.
- Uses existing real D1 fixture `wrangler.m09-daybook-authorized-test.jsonc` and original M02 Settings SQL.

- [ ] **Step 1:** Write Node failing tests: invalid fnName, extra fields, strange prototype/accessor, bad token, server clock errors and safe failures.
- [ ] **Step 2:** Write isolated real D1 tests: original success payload with Administrator/authorized clerk, denied user, revoked and expired tokens, hidden Settings not disclosed and no public endpoints.
- [ ] **Step 3:** Commit both tests alone and create draft PR.
- [ ] **Step 4:** Run Foundation `npm test` on test-only SHA via GitHub Actions; observe missing bridge failure RED. No production bridge before this evidence.

### Task 2 — Implement minimal read-only bridge (GREEN)

**Files**
- Create: `src/rpc/internal-daybook-bootstrap.js`

**Interfaces**
- `createM03DayBookRpcBridge(env,{now=Date.now}={})`
- `async invoke(request)` with exact own `fnName` and `args` fields; delegates to `createM09AuthorizedDayBookBootstrapReader(env).getBootstrap({token,nowMs})`.

- [ ] **Step 1:** Validate method/argument shape strictly, avoiding getter invocation or implicit auth policy.
- [ ] **Step 2:** Await vetted D1 reader, wrap four-field data; catch generic errors, preserve source envelope.
- [ ] **Step 3:** Commit only implementation after RED evidence.
- [ ] **Step 4:** Verify full Foundation suite on exact GREEN SHA, zero failures.

### Task 3 — Run actual Workerd D1 integration and PR checks

**Files**
- Modify: `.github/workflows/m03-d1-workerd.yml` — append a second, isolated `node --test tests/integration/m03-daybook-rpc-workerd.spec.mjs` after existing M03 test. Keep original suite and no remote writes.

- [ ] **Step 1:** Run local-only D1 job on exact GREEN SHA and verify all test cases and full existing M03 suite.
- [ ] **Step 2:** Confirm Workers Builds preview safety, M04 auth integration, browser QA and all existing branch checks.
- [ ] **Step 3:** Confirm only design, plan, new bridge, Node/Workerd tests and M03 test workflow were affected.
- [ ] **Step 4:** Update draft PR with RED/GREEN actual CI URLs, source contract, risks, remaining data and tenant gates; owner reviews/merges after all checks pass.
