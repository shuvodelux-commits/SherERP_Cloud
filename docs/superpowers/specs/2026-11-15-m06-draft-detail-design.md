# M06 — Source-faithful Saved Draft detail read projection

**Date:** 2026-11-15. **Workstream:** M06. **Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/DraftSales.gs::getSalesDraft` / `requireSalesDraftFeatureAccess_` / `requireSalesDraftAccess_` / `parseSalesDraftRow_`. **Status:** internal pure preparation, `PARALLEL-MODULE-READY=false`.

## Problem and selected design

Merged M06 #103 covers **list metadata**, #78 covers **invoice-shaped draft preview**, and existing `src/modules/sale-draft-preview.js::parseSaleDraftRow` already parses saved items/payment JSON. None provides the original **load a saved draft for editing** access+detail shape. Implement a small pure helper `projectSaleDraftDetail(draftId, draftRows, {actorId, canAddPos, canViewPos, canEditSales})` that receives only M04-derived server-trusted actor and permissions and an M03-reviewed already-tenant-filtered active `SALES_DRAFTS` snapshot, then reuses `parseSaleDraftRow`; **do not create a second parser**.

Other approaches rejected: public `getSalesDraft` RPC (M04 tenant/session/permission and M03 D1 query not approved); duplicate JSON parsing (KISS); draft write/consume CAS (shared M03/M06 posting ownership).

## Exact source behavior and safety

- `getSalesDraft` requires `pos.add` OR `sales.edit` feature access, then exact source Draft ID ownership or `sales.edit` manager access, **and** `pos.view` to open details, even for managers. Nonmanagers cannot open other staff drafts based on same Customer/phone/name.
- The payload is the original parsed draft, including `items`, `payment`, explicit Customer ID, Father/Husband relation, saved notes, original `Version`, actor/updated metadata, and `mine` / `canManage`. Reuse the already-reviewed `parseSaleDraftRow` for malformed JSON fallbacks and amount defaults.
- `draftId` is trimmed via source `sanitizeInput_` behavior; empty/missing id fails `Draft not found.`. Reject ambiguous duplicate Draft IDs **fail-closed** instead of the original Sheets first-match behavior (intentional safety enhancement; never silently choose a row whose owner is uncertain).
- New module is a pure internal projection, **not itself an authorization boundary**. The eventual caller must validate M04 session/tenant/role identity and derive the booleans from trusted permissions; never accept `actorId` or permission booleans from user-controlled RPC parameters. M03 D1 repository must provide tenant-filtered rows and consistent version snapshots.
- Reject missing or nonsensical trusted input, never mutate rows, edit/consume drafts, reserve inventory, allocate payments, create Parties for cash buyers, or touch Cash/Bank/customer/supplier ledgers.
- Date parsing assumes source-shaped canonical D1 strings; GAS object/timezone conversion belongs to M03.

## Files and tests

Exactly five new files: `src/modules/sale-draft-detail.js`, `tests/m06-draft-detail.test.mjs`, `tests/fixtures/m06-draft-detail-oracle.mjs`, this spec and `docs/superpowers/plans/2026-11-15-m06-draft-detail-read.md`. Test-only VM executes frozen source `DraftSales.gs::getSalesDraft` and compares successful and denied responses to pure implementation; duplicate protection is a separately documented stricter check. Test owner vs manager, `pos.view` mandatory, `pos.add OR sales.edit` gate, exact Customer ID and Father/Husband, payment and item JSON, malformed JSON, empty/duplicate ID, immutability and trusted caller preconditions.

## RPC/table/release inventory

No changes to any existing file, `src/db/**`, `src/rpc/**`, `src/auth/**`, `legacy/**`, frontend/print templates, migrations, Wrangler, Cloudflare deployments, remote D1, financial SQL or account state. **Zero SQL, network or financial writes.** Source code is an adapted pure wrapper reusing existing ported parser, not byte-copied GAS; original source loads only in test VM. Revert PR to roll back, no data recovery.

Full source-first RED→GREEN via GitHub Actions, all Node tests, original 84 source manifest, 36 original frontend includes, M03 actual local Workerd/D1 regression, M01 Chromium QA, Cloudflare no-secret preview safety required. Draft detail production activation blocked by M02-P, M03 D1 adapter/schema, M04 authenticated RBAC and M06 posting/stock/finance coordination.
