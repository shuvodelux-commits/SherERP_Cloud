# M04 — Internally guarded staff directory projection (partial, local D1 only)

**Date:** 2026-11-15  
**Workstream:** M04 authentication and authorization. **Dependency:** merged #238 (D1 staff read gate)  
**Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`UserManagement.gs::getUsersBootstrap`, `Auth.gs::requirePermission_`)  
**Branch:** `m04/d1-staff-directory-projection-20261115`

## Problem and implementation boundary
The frozen Users bootstrap maps User ID, Full Name, Mobile Number, Role, Status, Created By, Created At and Last Login, plus active role names, and requires `users.view`. The M04 **nondeployable** local D1 schema contains only the first five user fields and active role names. It deliberately has no Created By/At/Last Login source reconciliation or source role IDs. Do not pretend an incomplete local projection is the original full browser contract.

Introduce `src/auth/d1-staff-directory.js::readStaffDirectoryPreviewWithD1(db,{token,nowMs})`. The method returns `{authorized:false}` unless the merged `authorizeStaffReadWithD1` proves `users.view` for a real D1 session, or an active D1 Administrator. If authorized, it returns `{authorized:true,partial:true,users:[{id,name,mobile,role,status}],roles:[{name}]}` with a deterministic user and role ordering and nothing else. SQL selects only these literal allowlisted columns; never `SELECT *`, password/salt, legacy hashes, epochs, or authority metadata.

**Read revocation behavior:** Recheck the merged D1 gate after the two read queries and before returning to avoid returning a snapshot after a known intervening role/session disable. This is still a non-atomic read and not a future authorization mechanism for business writes. Reject missing D1, stale/revoked bearer and malformed tokens; no client identity/permission flags accepted.

## Superpowers test-first
1. Commit RED local real Workerd/D1 integration tests through a new `/__m04_test__/staff-directory` fixture endpoint that is absent in the baseline: Administrator can read the five-field projection, roles include active custom role names, non-admin with only `roles.view` gets no users; a newly granted `users.view` role can read after fresh login; disabled accounts and revoked/old role epochs fail closed. Assert returned JSON and response text contain no `password_hash`, `password_salt`, `credential_version`, `legacy_hash`, `auth_version`, or synthetic secret password. Unknown client `actor`/`permissions` claims grant nothing.
2. Confirm GitHub Actions M04 RED failure from the missing fixture route.
3. Implement one narrow internal auth module and wire **only** the nondeployable M04 test Worker fixture. No public `src/index.js`, `src/rpc/registry.js`, production `migrations/**`, `src/db/**`, Cloudflare config, or live D1 writes.
4. Confirm real M04 Workerd/D1 GREEN and all current-head CI, attach RED/GREEN evidence in a draft PR, inspect final file inventory and mergeability.

## Release boundary
The partial read model must NOT be registered as `getUsersBootstrap` or substituted into the original frontend until M03 schema owner provides and reconciles missing provenance fields and full privacy/contract parity is approved. No staff-management mutations, import, financial operations or public auth enablement. Document that any separate staff-table change between D1 read statements may alter the snapshot; no transaction or business write authorization is claimed.
