# M06 — Saved Draft update preflight design

**Date:** 2026-11-15. **Source of truth:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/DraftSales.gs::updateSalesDraft`, `requireSalesDraftFeatureAccess_`, `requireSalesDraftAccess_`, and `appendSalesDraftAudit_`.
**Status:** internal pure operation planning only; `docs/M03_PARALLEL_READINESS.md` still says transaction-module parallel implementation NOT READY.

## Background and chosen design

M06 #103 lists drafts, #109 reads authorized draft details, and #116 validates save/update payloads. The original `updateSalesDraft` additionally checks ownership, `pos.view`, optimistic `Version`, and a backwards-compatible customer relationship fallback, before writing an updated row and one audit record. Implement a **pure** `planSaleDraftUpdate(draftId, expectedVersion, payload, draftRows, trusted)`, reusing the existing `projectSaleDraftDetail` and `validateSaleDraftPayload` functions rather than duplicating security or item/payment validation. Return proposed source-shaped `fields`, `reply` and **audit metadata** (NOT a posted/allocated audit ID).

Alternatives rejected: calling public RPC or modifying `src/db/**` / SQL, since M03/M04 shared authorization and tenant-scoped CAS are not approved; rebuilding saved payment and owner checks, since M06 already has reviewed pure modules; source code byte copying, because the GAS function directly mutates Sheets.

## Exact native contract

- `pos.add OR sales.edit` permits draft feature access; `pos.view` is mandatory for editing; owner or manager (`sales.edit`) only. Manager without `pos.add` may edit other staff drafts if `pos.view` is granted. Source owner IDs are exact; Customer Name, phone and Customer ID are **not** draft owner IDs.
- Source reads the selected `Draft ID` and compares `Number(row['Version']) === Number(expectedVersion)`, errors with exact stale version text if mismatch, then validates source cart/payment and projects `Version=Number(row['Version'])+1`. No writer is invoked by this helper.
- Legacy POS tabs omitting `customerRelationType` must preserve the saved `Husband`/Father relationship even though the new payload validator defaults to Father. An **explicit** empty/unknown relationship value intentionally resets to Father, as in frozen source. Never look up or auto-merge by customer phone/name; keep selected Customer ID.
- Write field plan has exactly the native `updateRowFields_` keys, not Created By/At, invoice or any accounting ledger. Actor ID/name and UTC Updated At are **server-derived**, not browser payload. Audit metadata corresponds to native `UPDATED` actor, owner, ID/No, Version, blank invoice/note. An actual Audit ID, audit timestamp allocation and update + audit atomicity belong to reviewed M03.
- Reject missing trusted actor/permission/settings/account inputs and unsafe non-UTC timestamp as explicit Worker boundary constraints, regardless of what loose GAS stubs might accept. Imported duplicate active Draft IDs fail closed instead of GAS's first-hit behavior. A successful pure preflight is NOT authority to persist, and stale/concurrent writes require a DB-enforced CAS and same-transaction audit insert.

## Scope and acceptance

Add exactly five new files: this spec, `docs/superpowers/plans/2026-11-15-m06-draft-update-preflight.md`, `tests/fixtures/m06-draft-update-oracle.mjs`, `tests/m06-draft-update.test.mjs`, `src/modules/sale-draft-update-plan.js`. Test VM runs frozen original `updateSalesDraft` against synthetic Sheets/lock/auth stubs; compares success reply, changed fields, and audit metadata, plus stale/unauthorized paths. Assert zero SQL/Writes/RPC in port and no input mutation.

No changes to existing modules, `legacy/**`, `src/db/**`, `src/rpc/**`, `src/auth/**`, D1 migrations, frontend, Wrangler/Cloudflare config, remote D1, Cash, Bank, stock or Party accounts. No production deployment beyond existing inert preview. Revert this standalone PR as rollback (no migrated data).

**Gates:** M02-P authoritative Party mapping, M03 authorized tenant-scoped D1 SQL CAS and audit transaction, M04 session-derived RBAC and explicit allowed RPC, M05 stock/transaction review, M06 posting & M08 accounting reviews. Only after those gates could a separate PR activate update writes. Never claim that local Workerd/D1 regression tests validate this pure function as a live D1 endpoint.
