# M01 — Reject repeated HTML includes before the static Worker build

**Scope:** The pinned original SherERP HTML include assembler only. No visual change, authentication change, RPC exposure, D1 binding, or deployment change.

**Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Keep `legacy/source` and original ERP unchanged.

## Problem

`docs/MIGRATION_PLAN.md` P1 requires rejecting missing, cyclic **and duplicate** HTML includes. The existing `buildFrontend` already rejects missing and cyclic includes but expands the same partial twice when it is referenced in two places. Repeated scripts/styles or DOM IDs could silently alter the preserved ERP UI.

The source `legacy/source/index.html` currently includes 36 distinct partials with no repeated names. This scope adds a fail-closed build guard for future accidental duplication without modifying those partials.

## RED → GREEN tasks

1. Extend `tests/build-frontend.test.mjs` using disposable source fixtures. Assert that (a) repeated sibling include references and (b) repeated references through separate nested partials fail with an explicit duplicate-include message. Confirm ordinary nested includes and cycle errors remain unaffected.
2. Run the new tests *before* production changes, record their expected failure.
3. Add one per-build `Set` in `scripts/build-frontend.mjs` to track expanded source partial names, preserving existing cycle checks and traversal guards; fail before writing output if a partial is expanded twice.
4. Run focused tests, `npm test`, `npm run verify:source`, `npm run build:frontend`, and M01 browser checks via GitHub CI. Do not assert success without evidence.
5. Open a scoped PR for review, with RED/GREEN evidence and remaining integrated browser/auth/D1 gates.

## Acceptance / impact

- Unique nested source includes assemble byte-for-byte as before; `includeCount` remains stable.
- Repeated fragments cannot duplicate script, style, or DOM markup; duplicate and cyclic errors remain distinguishable.
- **Files:** one builder, one test, this plan. **SQL tables:** none. **RPC contracts:** unchanged. **Stock/Party/cash/bank/accounting:** no impact.
- **Limit:** This is an M01 guard, not proof of authenticated end-to-end ERP readiness.
