# M06 — Source-parity Sales Draft List Read Projection

**Date:** 2026-11-15
**Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/DraftSales.gs::getSalesDraftList` and `Utils.gs::safeDateOnly_`.
**Status:** Internal pure preparatory slice. `PARALLEL-MODULE-READY=false`; not a public `getSalesDraftList` RPC.

## Problem and decision

Merged M06 #78 implements a **single draft's invoice preview** and existing source VM parity. It does not implement the POS Saved Drafts **list**, with its actor-specific visibility and owner/manager action flags. The source `getSalesDraftList` first authorizes `pos.add` OR `sales.edit`; `sales.edit` grants manager-wide draft visibility, otherwise only drafts created by the logged-in user are visible. Lists sort on `Updated At` descending and return a small source-shaped metadata object, not JSON items or private payment data.

Rejected: activate the original GAS function over the Worker RPC (no reviewed M04 D1 session+tenant+POS permissions), introduce draft SQL table/query or writer (M03/M06 posting ownership), reuse the draft invoice preview projector and expose payment JSON (unnecessary payload/privacy risk).

**Selected:** `projectSaleDraftList(draftRows, {actorId,manageAll})` is pure and can only be called *after* an M04-authorized server-side D1 repository read, with actor ID and `manageAll` derived from the authenticated trusted session and staff permissions. It does not authenticate a caller or access D1; the user ID and authorization flag are not browser inputs.

## Exact business contract

- `actorId` is required nonempty trusted source `User ID`; `manageAll` must be explicit boolean from `sales.edit`. Missing trusted context fails closed. Future entrypoint must additionally require `pos.add` OR `sales.edit` before fetching rows.
- Non-manager sees only rows with `String(row['Created By ID']) === String(actorId)`. Manager sees every already-tenant-scoped source row; `mine` marks exact source ownership; `canManage` is true for manager or own draft.
- Stable `Updated At` descending sort using source's Date-construction semantics. Source `Draft Date` arrives as reviewed canonical `YYYY-MM-DD` or timestamp text from D1; project `YYYY-MM-DD`, with empty text for blank input. D1 Date objects and timezone conversions must be handled by the M03 repository boundary, not by this pure read module.
- Preserve exact original list keys: `draftId,draftNo,draftDate,customerId,customerName,customerPhone,subtotal,discount,grandTotal,createdById,createdByName,updatedAt,version,mine,canManage`. Use original `Number(value)||0`, `Number(version)||1`, and `||''` semantics. Do not render saved items, payment JSON, notes or other-sensitive fields in the list.
- Never infer account identity from phone/name, escalate customer permissions from Party roles, change a draft, reserve stock, consume a version, or post financial state. The saved draft detail/posting owner continues to enforce D1 version/CAS rules.

## Source parity and risks

A test-only `node:vm` fixture loads pinned untouched `DraftSales.gs` with injected `getSessionUser_`, `hasPermission_`, `getAllRows_`, `safeDateOnly_`, source-format `ok_/fail_`; pure projection is checked against real source outputs across owners, manager visibility, sorting, default numeric shapes and empty lists.

**Important trust boundary:** because a pure function takes `actorId` and `manageAll`, it is **not authorization**. Do not wire a public RPC that uses these fields directly from request payload; M04 must validate the token and derive them server-side, while M03 enforces tenant context and supplies authoritative rows.

## Changed files and rollback

New `src/modules/sale-draft-list.js`, `tests/fixtures/m06-draft-list-oracle.mjs`, `tests/m06-draft-list.test.mjs`, this spec and the paired plan. **No existing file changes**. No D1 schema/SQL/migrations/Worker entry/authorization RPC, Cloudflare deployment, GAS source, original frontend or print changes. Roll back by reverting the single isolated PR; there are no data writes or migrations.

## Release gates

GitHub TDD RED (tests committed before module, CI fails with missing import), GREEN against source, full Node suite, 84 source verification, 36 frontend include build, Workerd/D1 unchanged regression and M01 browser QA. M02-P Party data mapping, M03 source-shaped D1 draft reader and permission owner, M04 trusted actor RBAC, M06 atomic draft consumption, M05 stock and M08 finance remain prerequisites for real ERP draft use. This helper alone is not production-ready.
