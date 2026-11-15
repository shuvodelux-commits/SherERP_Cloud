# Superpowers Plan: M02-P Dense Original Party Header Evidence

> REQUIRED: test-driven-development and executing-plans, with GitHub observed RED before source implementation. Preserve KISS.

**Goal:** Do not mark an incomplete sparse master header capture as source-complete.
**Design:** Iterate the pinned expected column arrays rather than the potentially sparse user-supplied captured arrays.
**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `docs/baseline/schema-inventory.json`.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-party-sparse-header-coverage-design.md`.

### Task 1 — Test-first Party master source header parity

Files: `src/party/export-column-coverage.js`, new `tests/m02-party-export-sparse-headers.test.mjs`, spec and this plan.

1. **RED:** Branch from latest `main`; commit new tests for sparse first/mid/last holes in all five original master sheet header lists, including `Current Due`, `Current Receivable`, `Roles`, `Payee ID`; positive dense-array and negative malformed/extra controls, fixed diagnostic counts, immutable source rows and metadata. Open draft PR; capture exactly which new tests fail on GitHub Foundation before changing source.
2. **GREEN:** Change one predicate from `supplied.some((name,index)=>name!==expected[index])` to `expected.some((name,index)=>supplied[index]!==name)`. Keep length check, no new abstraction/dependency.
3. **Verify:** GitHub full exact-head Node/Foundation frozen 84-file audit; 36 frontend includes, M02 local D1/Workerd identities/review/gross, M03 runtime D1, M04 auth D1, M01 Chromium, M09 where applicable, Cloudflare PR-only safety. Record pass/pending/fail precisely.
4. **Review:** Four-file diff and mergeability; PR body lists impact and TDD evidence. Do not merge without complete green verification and owner review. No production D1, finance posting, new RPC or migration approval; rollback by reverting this isolated PR.
