# M06 — Atomic draft-to-sale consumption (Superpowers plan)

Status: TEST-ONLY synthetic Workerd/D1 follow-on to merged PR #71. The original GAS source is preserved at Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## Goal / source contract

The original DraftSales.gs prepares a saved draft using a specific Draft ID, owner and expected Version. Sales.gs::completeSale checks that the saved payment format is unchanged, and may already have written an invoice when the browser retries. A stranded invoice is not evidence of successful posting; a committed posting receipt and matching children are required. A current preview sale must not accidentally consume a stale draft or post it twice.

Prove the narrow transaction property in the existing nondeployed M06 test-only D1 contract: posting a draft consumes exactly its matching version and content in the same D1 transaction as invoice, owned stock, tender, customer due and one audit record. A retry with the original operation ID reuses the original invoice even after the draft is consumed. A different operation ID against that draft must decline. No draft cleanup may happen outside the atomic write boundary.

## Test-first implementation tasks

1. RED: Add real Workerd/D1 tests to the existing M06 test-only suite before changing its code. Cover matched draft consumption, stale version/content/owner, payment-format mismatch, two concurrent submitters of one draft, exact-ID replay, forced draft-audit failure rollback, and a concurrent draft update after preflight.
2. GREEN: Extend only M06 synthetic SQL fixture and contract with optional sourceDraftId/sourceDraftVersion and source snapshot columns. Enforce active owner/version/payment-format and saved SKU/quantity/pricing/customer/tender snapshot **inside SQL**; consume with SQL CAS and write an audit row from the sale trigger. Keep the original no-draft path unchanged.
3. REFACTOR: Keep the existing original split-payment calculator and M03 canonical fingerprint. Avoid duplicate financial engines, public RPCs and shared production migration/auth/stock files.
4. VERIFY: source-pinned tests, full Node suite, focused and aggregate real Workerd/D1, original frontend build, GitHub Actions, no deployment binding and check the PR diff against latest main.

## Boundaries

Files owned in this PR: tests/integration/m06-sale-posting-workerd.spec.mjs; tests/fixtures/m06-sale-posting-contract.mjs; tests/fixtures/m06-sale-posting-schema.mjs; this M06 plan. No src/, migrations/, wrangler production/staging/preview configs, original source or user data changes. The existing test Worker has only synthetic D1 and returns 404.

This proof is not full draft RPC migration: it covers one standard SKU with integer units, synthetic trusted actor (owner-only), split payments, and synthetic draft rows. Real staff permissions, multi-user manager override, original bundle/vendor/OVERSOLD/FIFO, invoice numbers and the durable real Party/Cash schema remain M03/M04/M05/M08 dependencies. No cutover or live checkout approval. Rollback is reverting this test-only PR.
