# M03 — Internal Day Book HTTP-to-D1 bridge (design)

**Date:** 2026-11-16 · **Owner:** M03-core #22 · **Original:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` · **Predecessor:** merged #335

## Problem and source contract

`legacy/source/daybook.html::dbLoad` invokes `serverCall('getDayBookBootstrap', authToken)`. `legacy/source/DayBook.gs::getDayBookBootstrap(token)` requires the current `daybook.view` permission and returns the four-field data payload inside `{success:true,data}`. PR #335 added an internal only, D1-authorized, awaited bridge `createM03DayBookRpcBridge(env,{now}).invoke({fnName,args})`. Its `invoke` method is presently called directly by tests and not through HTTP. `src/rpc/handler.js::handleRpc` already handles origin, POST, JSON type, body size, argument caps, explicit M04 auth opt-in and public blocked registry.

## Approaches

1. **Publicly register Day Book in `src/rpc/registry.js`**: rejected; original data, tenant isolation, M04 public session activation and cutover have not met release gates.
2. **Create a second HTTP body/parser implementation for Day Book**: rejected; duplicated origin/body/JSON limits drift and increase attack surface.
3. **Chosen:** add a narrowly named optional, trusted `dayBookBridge` dependency to `handleRpc(request,{authAdapter,dayBookBridge}={})`, used only for the exact method `getDayBookBootstrap`. The public Worker continues to call `handleRpc(request)` without trusted dependencies. The transport validates exact argument arity and 64-character bearer, awaits `dayBookBridge.invoke`, and validates a strict frozen four-field response before emitting HTTP; it strips private/malformed backend results. The test-only Worker binds a local D1 and uses the existing PR #335 bridge, not copied authorization SQL.

## Acceptance and security boundaries

- The trusted option is **server-only**; JSON fields `dayBookBridge`, `actor`, `nowMs`, `permissions` and `sql` never activate it. Public Worker still answers 501 and never touches D1, even if a DB-like environment is injected.
- HTTP follows existing checks: POST only, same origin, `application/json`, 65,536-byte body limit, syntactically valid JSON, bounded names/args.
- Only exactly `getDayBookBootstrap` with one lowercase 64-hex token may reach the injected bridge; other functions cannot be dispatched, and malformed or extra arguments are denied without D1 reads.
- Success allows exactly `success` and `data`, where `data` owns exactly `currencySymbol,editableDays,modules,isAdmin`, `modules` matches the 12 original Day Book labels in order, and no Promise, Symbol, getter, private D1 column or extra property is allowed.
- Failures allow only source-safe `success:false,message:'Day Book is unavailable or access denied.'`, never backend errors or SQL. All HTTP replies retain `no-store` and `nosniff` headers.
- Existing auth transport `login/validateSession/logout` must behave identically; `authAdapter` never implies Day Book access and `dayBookBridge` never implies auth method access.
- Test-only Worker uses `workers_dev:false`, no routes, synthetic auth/Settings schema; it mounts a *private test path*, never `/api/rpc`. Production `wrangler.preview.jsonc`, `src/index.js` and public registry stay unchanged.
- No changes to `src/db/**`, SQL migrations, Party accounts, stock, financial writes, original frontend, live GAS/Sheets or remote D1. No new packages or runtime caches.
- Verify Node RED (missing opt-in handler), minimal GREEN, actual local Workerd/D1 HTTP/authorization cases, Foundation, M04, UI QA and preview checks on exact head. Leave PR draft for owner review. This is internal single-business evidence only: **M03 incomplete / PARALLEL-MODULE-READY=false**.
