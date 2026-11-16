# M07-B6 — Read-only Sales Return Edit Readback (local Workerd/D1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development. RED → verified failure → minimal GREEN → full GitHub Actions.

**Goal:** Prove a source-shaped, fail-closed **read-only** D1 projection for the original `getReturnForEdit` workflow without enabling mutation or exposing a public RPC.

**Architecture:** Existing M06 synthetic invoice and M07 Cash/Store Credit receipts plus their original source lot/stock/ledger are the authoritative rows; the merged M07 deletion correction receipts act as tombstone markers. A small test-only `m07_return_edit_versions` table models the original optimistic `Edit Version` read field, not version mutation. One tenant-parameterized D1 query resolves a unique return with exact invoice, item, source-hash, movement, refund/credit evidence. No historical cash-session policy is imposed on a read-only operation; real `returns:edit` RBAC remains an M04 gate.

**Tech:** Node 22 ESM tests, local Wrangler 4.161.0 Workerd with isolated D1; synthetic frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `SalesReturn.gs::getReturnForEdit`; `docs/M07_RETURNS_SOURCE_CONTRACT.md`.

## Scope overview (12 sentences)

1. The frozen ERP's `getReturnForEdit` requires `returns:edit` authorization and a unique active Sales Return.
2. It returns the existing return header and active line items plus an invoice snapshot, edit version and editable status.
3. A missing Return ID, duplicate Return ID, deleted header or missing active item must not appear editable.
4. A source invoice that was lost, deleted or changed must yield a fail-closed outcome rather than a fabricated edit form.
5. Cash and Store Credit returns must remain distinguishable, even when the original sale has an outstanding Customer due.
6. Store Credit identity and original Customer role must be checked against reviewed Party and source credit ledger evidence.
7. Any missing or inconsistent stock movement, lot provenance, refund amount or customer credit ledger requires manual review.
8. The original returned unit count must not exceed the exact originally sold lot quantity.
9. An audited delete/reversal marker must exclude the return from the editable active projection without removing historical records.
10. An optional source-shaped version counter defaults to zero and reads higher versions without incrementing anything.
11. Readback must use tenant-bound identifiers, reject unrecognized input fields, and make no D1 mutations or public Worker route.
12. This synthetic projection does not deliver native UI/API parity, live edit authority, price/quantity adjustment, or production M07 accounting writes.

## Files and ownership

- Add `docs/superpowers/plans/2026-11-16-m07-return-edit-readback.md` (this plan).
- Add `tests/fixtures/m07-return-edit-read-schema.mjs` (disposable version table and no writer).
- Add `wrangler.m07-return-edit-read-test.jsonc` (separate non-deployable D1 UUID).
- Add `tests/integration/m07-return-edit-read-workerd.spec.mjs` (real local D1 source Cash/Store Credit, tampering, delete tombstone, identity, version, no-writes).
- Add one-line import in `tests/integration/m03-workerd.spec.mjs`.
- Add `tests/fixtures/m07-return-edit-read-contract.mjs` **after RED**; export `createSyntheticD1ReturnEditReader(DB).getReturnForEdit({tenantId,returnId})` using one parameterized SELECT; return `{status:'OK',data:{header,items,invoice,version,editable:true}}` or `{status:'NOT_FOUND'|'DELETED'|'NEEDS_REVIEW'}`. Never claim this shape is a complete port of legacy sheet column names.

**Protected:** No `src/**`, `migrations/**`, `legacy/source/**`, `src/rpc/**`, production binding, original UI, real business data, or server auth.

## TDD sequence

### RED
- [ ] Commit plan + test-only version schema + local Wrangler test config.
- [ ] Commit integrated tests before reader exists and wire to consolidated real Workerd suite.
- [ ] Inspect actual GitHub Actions failure: only missing reader module, not bad import/test fixtures.
### GREEN
- [ ] Exact-shape validation before D1; SQL single-snapshot source join with tenant boundary.
- [ ] Distinguish missing/deleted/cross-method ambiguity and source/ledger/lot corruption; return source-shaped data for valid Cash/Store Credit.
- [ ] Run `npm test`, `npm run verify:source`, `npm run build:frontend`, all local Workerd/D1 tests and PR safety.
### Review
- [ ] Record RED and GREEN SHAs and exact-head CI URLs in draft PR.
- [ ] Leave PR unmerged for owner review; no authorization of source edit RPC.

## Review focus

Incomplete original historical stock lot provenance must fail closed even if the receipt appears well formed; read-only evidence from a synthetic fixture cannot replace source Sheets migration mapping. The original native `getReturnForEdit` uses full `getInvoiceForReturn` including returns/quantities; this slice returns only a verified subset of that shape. M04 session permission, M02 original ID linking, M05 lot/bundle/OVERSOLD history, M06 split-tender/source invoice, M08 settlements and M09 source readback remain separate gates. No automatic cross-role settlement. Revert six additive docs/test-only changes to roll back; zero production business data changes.
