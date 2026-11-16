# M03 Internal Day Book HTTP-to-D1 Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development. Follow GitHub branch/PR, RED→GREEN, exact-head Workerd/CI.

**Goal:** Prove the original `getDayBookBootstrap(token)` HTTP transport through M04-authorized local D1 without activating public RPC.
**Architecture:** Reuse the existing `handleRpc` parser and opt-in a single trusted `dayBookBridge` for one source method, with strict reply schema. The M03/335 bridge still performs current D1 permission checks, and a fixture-only Worker exposes a synthetic private test path.
**Tech Stack:** Node 22 ESM, Cloudflare Workerd and D1 through Wrangler 4.161.0 test harness, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-16-m03-internal-daybook-http-design.md`.

## Global constraints

- Original source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, fixed browser `serverCall('getDayBookBootstrap',authToken)`.
- No original HTML modifications, public Worker/registry changes, SQL/D1 schema changes or data import; no production or staging database writes.
- No new dependencies, dynamic invocation by name, second HTTP parser, auth preflight race, role from client, D1 logic duplication or module cache.
- M04 auth transport and existing error schemas must remain unchanged; public RPC remains disabled.
- All work must be GitHub-only with RED test-only failure evidence → GREEN minimal implementation → exact-head verification.

## 14-sentence overview

1. The original Day Book requests its bootstrap using the `serverCall` helper.
2. The original GAS handler requires the current user's daybook.view permission.
3. The merged M03 #335 bridge already awaits the reviewed M04-authorized D1 reader.
4. The bridge is not yet exercised by the existing HTTP RPC parser.
5. The goal is a testable HTTP boundary, not a public ERP endpoint.
6. One trusted server-only `dayBookBridge` option is added to the existing handler.
7. Only an exact `getDayBookBootstrap` call may use it.
8. The handler rejects extra arguments and malformed session tokens before invoking the bridge.
9. The handler retains its original POST, same-origin, JSON and body size protections.
10. It validates the exact four-field source payload and frozen module names.
11. Invalid backend output or D1 errors cannot disclose private Settings, SQL, staff or bearer.
12. A dedicated local test Worker exercises HTTP to the reviewed real D1 reader.
13. The original public Worker, preview config and all business data remain untouched.
14. RED-first tests, exact-head Node and Workerd results are reviewed before any owner merge.

## Review focus

- Source-compatible HTTP `200` success and four exact fields, no nested Promise or private keys.
- Bad body format, origin, method, length, arity or token cannot dispatch D1 and retains safe headers.
- Internal opt-in never enables `login`, `completeSale`, `getSettingsMap_`, or other RPCs; public remains 501 with or without DB env.
- Malicious trusted bridge returning extra data/getters/Promise/unknown module is rejected rather than serialized.
- Real D1 revoked, idle-expired, unknown or disabled role sessions fail after previously successful HTTP requests.

---

### Task 1 — RED HTTP contract

**Files**
- Create `tests/m03-daybook-http.test.mjs`.
- Create `tests/integration/m03-daybook-http-workerd.spec.mjs`.
- Create `tests/fixtures/m03-daybook-http-worker.mjs` and `wrangler.m03-daybook-http-test.jsonc` (fixture-only infrastructure, never production).

**Interfaces**
- Existing `handleRpc(request,{dayBookBridge}={})`.
- Existing `createM03DayBookRpcBridge({DB},{now}).invoke({fnName,args})`.
- `src/rpc/handler.js` is sole HTTP parser and response serializer.

- [ ] Commit tests first with exact expected HTTP statuses/headers, response shape, current source fixture, public-worker disablement and D1 revocation.
- [ ] Execute Foundation `npm test` at test-only SHA through GitHub Actions; record the expected RED behavioral failure (not missing fixture or typo).
- [ ] Do not modify production handler before RED verification.

### Task 2 — GREEN internal dispatch

**Files**
- Modify `src/rpc/handler.js` only.

**Interfaces**
- `handleRpc(request,{authAdapter,dayBookBridge}={})`; preserve auth-only behavior and public fail-closed route.
- `dayBookBridge.invoke({fnName:'getDayBookBootstrap',args:[token]})` returns a Promise of an envelope.

- [ ] Add exact guarded branch for `getDayBookBootstrap` only when `dayBookBridge` explicitly supplied from trusted server context.
- [ ] Validate lowercase 64-hex bearer and arity, await bridge and own-field whitelist result, freeze allowed module names.
- [ ] Deny malformed or private results using a generic error with `no-store` and `nosniff`.
- [ ] Re-run full Node suite on exact GREEN SHA; preserve legacy auth behavior and public 501.

### Task 3 — Real Workerd/D1 and PR gate

**Files**
- Modify `.github/workflows/m03-d1-workerd.yml` to run the new isolated Workerd spec in its existing M03 local-only job, preserving old tests.

- [ ] Run local actual Workerd/D1 HTTP tests, Foundation and all relevant automatic PR checks on exact head.
- [ ] Verify only spec, plan, handler, tests, fixtures, nondeployable Wrangler and PR-only M03 workflow changed; no public/finance/data migration touched.
- [ ] Record RED→GREEN URLs, code/SQL/fixture impact, risks, pass/fail summary in draft PR.
- [ ] Leave PR unmerged for owner; parallel backend production readiness stays blocked.
