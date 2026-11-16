# M08 — Cash explanation submission validator: execution plan

**Scope:** One read-only internal helper; exact source error-order parity to `saveCashReconciliationExplanation` before any writes. **Source SHA:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Spec:** `docs/superpowers/specs/2026-11-16-m08-reconciliation-explanation-validation-design.md`.

## Owner rules

GitHub branch/PR only. Superpowers test-first RED→GREEN→verify→review. KISS; no dependencies. No mutation of original GAS/sheets or production D1, no schema, RPC, frontend, auth, rollout or cash/account movement. Validate on loaded test fixtures, not a production financial database. Existing Party role balances remain gross and independent.

## Task 1: RED, frozen-source comparison

**Create** `tests/m08-reconciliation-explanation-validation.test.mjs`.

- Load selected `Utils.gs` and `CashReconciliation.gs` functions through the existing VM fixture, stubbing only GAS runtime functions and write effects. Record source-would-write calls for successful path; do **not** run original source against external services.
- Assert original outcomes for valid cash-in and cash-out/multiple entries, same-phase retry, cross-phase/other-session link reuse, invalid/missing/deleted/synthetic/wrong-sign IDs, duplicate IDs, partial/excess/rounding mismatch, no difference/baseline, empty selection, and invalid phase/session. Compare error strings and successful payloads.
- Add intentionally stricter malformed-import tests: duplicate Session/Entry IDs, prototype-shaped IDs, unresolved Promise, frozen arrays and absent timeZone; assert new validator does not modify rows and does not expose public RPC.
- Commit tests before production module. Open draft PR and inspect GitHub Actions logs to prove expected missing-import RED.

## Task 2: GREEN, minimal validation helper

**Create** `src/modules/m08-reconciliation-explanation-validation.js`.

- Expose `validateCashReconciliationExplanation(sessionRows,cashRows,{sessionId,phase,entryIds,timeZone})`.
- Reuse `evaluateCashExplanation` for parsing; `projectCashReconciliationCandidates` for source-shaped phase meta and duplicate-row guard; iterate the **full** raw Cash Book and linked-use map with `Map`/`Set`.
- Check all selected IDs in the frozen source's order; sign and amount must match exactly. Return a *validation result*, never persisted state.
- Run `npm test`, `npm run verify:source`, `npm run build:frontend` through GitHub CI and read actual logs.
- Verify final PR diff is only new module, new tests, spec and plan. Include exact RED/GREEN commits and CI evidence.

## Task 3: Review and release gate

PR is **not** financial write readiness. Real D1 tenant isolation, actor authorization, snapshot consistency, DB-enforced uniqueness/CAS, atomic posting, exactly-once replay, rollback and actual business-data migration still block production. Do not merge until all applicable checks are green and owner has reviewed.
