# M03 — Internal Day Book RPC contract bridge (design)

**Date:** 2026-11-16
**Authority:** `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007, merged M03 audit #317, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Intent and source contract

The original `daybook.html::dbLoad` calls `serverCall('getDayBookBootstrap', authToken)` and expects the resolved **data** `{currencySymbol,editableDays,modules,isAdmin}`. The original `DayBook.gs::getDayBookBootstrap(token)` checks `daybook.view`, loads `Currency Symbol` and `Day Book Editable Days`, then responds with the shared `{success,data}` / `{success:false,message}` envelope. The already merged internal `createM09AuthorizedDayBookBootstrapReader({DB}).getBootstrap({token,nowMs})` runs an auth-session/role-version/permission-authorized single D1 SELECT, then returns exactly those four data fields. **It does not own a source-compatible method-name/argument envelope**. This increment connects those previously reviewed pieces without creating a public endpoint.

## Alternatives considered

1. **Register `getDayBookBootstrap` immediately in public `src/rpc/registry.js`.** Rejected: M04 public login/permission, tenant boundary and production D1 cutover remain blocked.
2. **Copy the existing SQL/authorization logic into an RPC adapter.** Rejected: duplicates the verified security query; future drift would be dangerous.
3. **Chosen:** a narrow internal-only RPC bridge. It allowlists only `getDayBookBootstrap`, validates `{fnName,args:[token]}` as a plain own-data record with a single 64-hex-character bearer, reads server time from a trusted clock, `await`s the reviewed M09 authorized D1 reader and wraps the four-field result in the source envelope. It catches failures and emits one generic error without SQL details. The public Worker and RPC handler remain unchanged.

## Explicit boundaries

- The bridge is `createM03DayBookRpcBridge(env,{now}={})` in `src/rpc/internal-daybook-bootstrap.js`. The optional `now` function is trusted **server-side clock injection for deterministic tests** and is never read from the RPC payload.
- One method `invoke({fnName:'getDayBookBootstrap',args:[token]})`; only this exact allowlisted call is supported. Unknown or malformed calls always fail closed before any D1 read.
- Success: `{success:true,data:{currencySymbol,editableDays,modules,isAdmin}}`. Failure: `{success:false,message:'...'}`. No raw reader error, auth token, Settings keys or extra fields in responses.
- No role, permission, actor, tenant, SQL, client timestamp or table identifier is accepted as an RPC field. M04 staff auth is checked by existing D1 SQL, not presentation module metadata.
- No `src/index.js`, `src/rpc/handler.js`, public registry, HTML, `src/db/**`, migrations, worker bindings, staging/production D1, finance posting, import or cash session edits. No mutation of source spreadsheets/GAS.
- Local Workerd test uses the existing nondeployable M09 Day Book fixture and actual D1; validate authorized, disabled/unauthorized/stale/revoked actors, source field shape and zero private Settings leak; public Worker remains 501 or test Worker 404.
- Run source contract + Node RED/GREEN and actual Workerd/D1 CI. Do not mark M03 done or turn on PARALLEL-MODULE-READY. This internal single-business proof has no tenant isolation and is **not** a production security sign-off.
