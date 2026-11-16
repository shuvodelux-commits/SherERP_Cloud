# M09 — Authorized Day Book bootstrap read (internal, local D1)

**Date:** 2026-11-16  
**Source:** frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2; `legacy/source/DayBook.gs::getDayBookBootstrap`, `legacy/source/daybook.html`, merged `src/modules/daybook-bootstrap-read.js`.  
**Owner intent:** preserve original UI/permissions while migrating the ERP to Workers + D1. PR #302 already verified the pure Day Book response shape.

## Approaches and decision

1. **Enable the public Day Book RPC now:** rejected. Transactions, native edit/delete and M05/M07/M08 reconciliation are not all active in D1; the existing public registry must remain fail-closed.
2. **Read Settings and role in separate auth and data queries:** rejected. A role/session could be revoked between checks and the Settings read.
3. **Chosen: isolated single-statement M04-authorized read model.** Read the authenticated user's `u.role_name` and only `Currency Symbol` / `Day Book Editable Days` settings inside one D1 statement gated on current session and literal `daybook.view` grant; feed those trusted values to the merged pure M09 projection. No public RPC or writes.

## Contract

Export `createM09AuthorizedDayBookBootstrapReader(env)` returning an object with `getBootstrap(request)`. Request is a strict plain own-data object of exactly `{token,nowMs}` supplied by a trusted server transport. Token is a 64-character lowercase hexadecimal bearer, hashed from the 32 decoded token bytes with SHA-256; `nowMs` is a finite safe server-supplied timestamp. No client-specified actor, role, permission, tenant, date or extras are accepted.

One D1 SELECT must enforce unrevoked and nonexpired/nonidle session, active modern user, unchanged user and credential epochs, matching active custom-role version, and literal JSON `daybook.view === true` (Administrator intrinsic with null role snapshot). `allowed_modules`, `reports.view` and `settings.view` are not sufficient. The same statement returns role_name plus an allowlist of just two Settings keys. Zero Settings rows for a valid actor is legal; unauthorized rows are not. Reject malformed, duplicate, unexpected and inconsistent rows rather than returning a partial/false-success result. Project into the **exact** `{currencySymbol,editableDays,modules,isAdmin}` source contract, and do not leak private Settings or return untrusted user fields.

## Safety / non-goals

This uses only the existing single-business M04 D1 test schema and does **not** claim tenant isolation. No migration, financial balance, posting, session heartbeat, new user/role permission, frontend redesign, Cloudflare binding or legacy GAS change. The public Worker registry remains empty and preview D1-free. Workerd/D1 tests prove staff authorization, role/version revocation, settings visibility, missing-settings fallback, invalid bearer/clock, unchanged SQL rows and 404 public HTTP. Production activation awaits independently reviewed M04 public transport and tenant/financial data gates.

**Rollback:** revert only the new M09 spec, plan, tests, isolated config/workflow and reader; no business data changes.
