# M04 — Preserve frozen staff-role permissions at internal authentication HTTP boundary

Date: 2026-11-15  
Workstream: M04 authentication/authorization; M04 owns `src/rpc/handler.js` auth response validation  
Source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`RoleManagement.gs`, `UI.gs`, `Auth.gs`)  
Dependencies: merged #222; existing internal D1 compatibility adapter and local Workerd fixture

## Problem
`src/auth/d1-legacy-rpc.js::roleMetadata` accepts source-defined permission `backdate` (eight windows), non-management `delete` with `disabled`/`same` and Users/Roles management `delete` as Boolean. The internal HTTP auth envelope validation in `src/rpc/handler.js::validRoleMetadata` currently accepts neither `backdate` nor `disabled`/`same` delete and requires management deletes to be non-Boolean strings. If a valid D1 SourceRole logs in, the HTTP boundary returns 503 rather than passing through the source-shaped success envelope.

## Test-first (RED)
1. Extend the existing pure HTTP response guard regression with an exact source-shaped non-admin profile including `sales.delete='same'`, `sales.backdate='7'`, `roles.delete=false`, `users.delete=true` and edit-only `openingBalance.delete='disabled'` with `backdate='unlimited'`. Demand success for `login` and `validateSession`. Add malformed negative cases (management delete string, invalid backdate, non-management delete Boolean) that must fail without leaking payload.
2. In the **test-only** Workerd fixture add an explicit opt-in route flag to pass its real D1 `createD1LegacyAuthRpc` result through `handleRpc`. Reuse current seeded SourceRole and its test. Normal fixture RPC route remains unchanged; the deployed Worker and public registry remain inert.
3. Commit tests and verify GitHub RED evidence. The correct failure is HTTP 503 for a valid SourceRole profile, while existing negative requests stay denied.

## Minimal implementation (GREEN)
Only update `validRoleMetadata` in the internal `src/rpc/handler.js`: use the eight source windows; require Boolean management delete and a valid source window for other delete/backdate rights; keep unknown fields and types denied. No access-control grant based on display metadata, no public RPC, no change to token, staff identity, D1 schema, migrations or live Worker.

## Verification / review gate
- GitHub M04 actual Workerd D1, Foundation and Cloudflare safe-preview checks must pass; verify current-head CI and diff before review.
- Only source-contract parity at a **trusted internal opt-in HTTP response adapter** is affected. This does not implement permission checks on business RPCs or activate sign-in.
- Independent M03 schema owner retains production migration responsibility; original GAS/UI and stored sheets are untouched.
