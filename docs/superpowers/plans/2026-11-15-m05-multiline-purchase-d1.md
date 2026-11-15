# M05 — Multi-line purchase atomicity proof (2026-11-15)

## Scope, source and ownership

Follow `AGENTS.md` GitHub-first Superpowers RED → GREEN → retest, KISS and local-only Cloudflare previews. The oracle is pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Purchase.gs::createPurchase`. M05 owner is limited to nondeployed tests and synthetic `m05ml_*` fixtures. **M03 exclusively owns production D1 SQL, migrations, repository and posting core; M04 owns real staff authorization.**

The already merged #90 real D1 purchase proof is *single SKU only*. This PR supplies a small **test-only** extension for source purchase baskets with 2+ distinct products. It proves database-triggered per-SKU stock/version CAS and all-or-nothing header, items, supplier-specific lots, movements, supplier obligation and cash/bank book. No source edits, public RPC, live deploy, staging/production binding or real financial service.

## Acceptance and Superpowers execution

1. Plan first; new Workerd D1 tests written before fixture/contract and enrolled in existing M05 integration aggregator; commit RED. Observe **actual GitHub Actions failure** on missing fixture/schema for this test (no artificial test-only exception).
2. GREEN minimal nondeployed Workerd/D1 fixture and poster:
   - one purchase header; multiple distinct product lines; per-line original purchase date, own cost and selling price, own supplier-linked lot and movement; update original product stock, version and default selling price; integer paisa arithmetic and source-style paid-amount clamp.
   - valid reviewed original `SUPPLIERS` → Party legacy link; supplier AP is independent of the same Party's Customer AR; no hidden cross-role settlement.
   - enforce open session, active supplier, bank account, active standard SKU and expected SKU version in SQL; per-line SQL CAS must abort the entire claim if any product changes between validation and commit.
   - duplicate/missing/bundle/negative/over-precise lines rejected. Exact operation ID + canonical fingerprint guarantees idempotent replay and changed-intent conflict. Late child payment/ledger trigger failure must roll back all SKU writes. Two concurrent different operation IDs on same product versions commit no more than one.
   - test-only HTTP Worker stays 404, no privileged route.
3. Verify GREEN in **real Workerd+D1** and all affected GitHub Actions. Record exact RED run, GREEN run, files, known gaps, review and rollback. Keep PR unmerged until checks and preview safety are satisfied.

## File/RPC/schema impact

- Add `tests/integration/m05-purchase-multiline-workerd.spec.mjs`.
- Add `tests/fixtures/m05-purchase-multiline-schema.mjs` and `m05-purchase-multiline-contract.mjs`.
- Add `wrangler.m05-multiline-test.jsonc` for a fake local D1 binding; reuse existing inert test Worker.
- Enroll test with one additive import in `tests/integration/m05-purchase-posting-workerd.spec.mjs`.
- This plan. **No** `src/**`, `migrations/**`, production D1, authentication, `src/rpc/**`, UI, Cloudflare deployment or `legacy/**` changes.

## Explicit gaps and rollback

Synthetic one tenant, pretrusted actor context, two line items in tests (up to ten in contract). Not the final source import, backdating permissions, multi-unit, OVERSOLD, vendor, bundles, returns, purchase edits, physical reconciliation, or persistent production authorization. No source GAS lock emulation. Source holds a cash-session ambiguity on Bank purchases; this fixture requires an Open session conservatively. Final M03-approved posting interface must derive tenant/actor from real session and owner-authorized D1 schema; nothing in this PR enables production purchase writes.

Rollback: revert additive test-only files/import, no remote financial data or schema restoration. `PARALLEL-MODULE-READY=false`.
