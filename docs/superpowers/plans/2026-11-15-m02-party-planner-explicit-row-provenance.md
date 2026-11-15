# M02-P Explicit Original Row Provenance in Direct Party Planner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development; commit plan and failing test before changing production source.

**Goal:** Reject an explicitly supplied malformed `_rowIndex` in `planPartyImport()` while continuing to support a genuinely absent optional row position.

**Architecture:** Today the direct offline Party planner maps `source._rowIndex===undefined` to `null`; it also treats an explicitly supplied `null` as the absence sentinel. Earlier merged export completeness and snapshot drift guards reject any present `_rowIndex` that is not a safe integer ≥ 2, so direct planner entry should enforce the same structural invariant. Use `Object.hasOwn(source,'_rowIndex')` to distinguish absence from a present `null` or `undefined`, then preserve `null` internally only for genuinely absent row provenance. No output shape or generated Party IDs change for valid input.

**Tech Stack:** ESM JavaScript; Node 22 native `node:test`; existing GitHub Actions real Workerd/D1 and original UI checks.

**Spec/authority:** `AGENTS.md`, `docs/WORKSTREAMS.md` M02-P, ADR-007, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; previously merged #197 safe export position, and direct snapshot guard #209 still pending merge.

## Global Constraints

- GitHub-only dedicated branch, test-first failing Foundation CI, minimal implementation, passing exact-head Node and Workers/D1 GitHub CI. KISS.
- Original source IDs, including whitespace differences, remain byte-exact. Never infer a legal Party from name or phone, or authorize cross-role financial offsets.
- `_rowIndex` is optional synthetic physical Sheet provenance, not an original GAS column. Missing property remains allowed; a present property must be a safe integer ≥ 2.
- Reject present `null`, `undefined`, `NaN`, noninteger or unsafe values as existing `Invalid legacy row position in <group>`. Keep valid row 2 and `Number.MAX_SAFE_INTEGER`, original ID, review evidence and no-data-mutating behavior.
- No new SQL, D1 schema, public Worker/RPC, frontend, approval, cash/bank/finance posting or production import.

## Task 1 — Direct planner fail-closed physical locator
**Files:** new `tests/m02-party-plan-explicit-rowindex.test.mjs`; modify only `src/party/party-import-plan.js` after RED; this plan.

- [ ] Write/commit this plan.
- [ ] Commit seven synthetic tests against the **real exported planner** proving explicit `null` and `undefined` (across all five source groups) are rejected, that malformed values preserve the existing error, that omitted provenance and safe upper bound remain valid, and that source data and Party/link IDs are stable.
- [ ] Verify actual GitHub Foundation RED failures for present missing-value row fields, with preservation tests passing.
- [ ] Change one localized section: define `const hasRowIndex=Object.hasOwn(source,'_rowIndex')`; map `legacySheetRow=hasRowIndex?source._rowIndex:null`; validate if `hasRowIndex` rather than if nonnull. Do not touch ID normalization, reviewed-group logic, role mapping or receipt generation.
- [ ] Exact-head GREEN Foundation full tests plus M02 local real Workerd/D1 Party proof, M03 combined Workerd/D1, M04 auth, M01 Chromium, Cloudflare preview safety and original-source checks.
- [ ] Review diff for **exactly three scoped files**; PR with RED/GREEN evidence, actual CI run IDs, rollback, and cutover blockers. Owner merges only after successful CI.

## Review Focus
- Literal presence of malformed `_rowIndex` is never mistaken for omitted provenance, even with a valid name and ID.
- An absent provenance property stays backward-compatible; no artificial physical row is assigned.
- Real positive provenance and duplicate physical-row detection behave identically to pre-change.
- No leaked source identifiers, balances or reviewer references in new diagnostic outputs.
- Zero live Party imports, account netting or financial writes.

**Rollback:** revert PR; no D1 data recovery. `PARALLEL-MODULE-READY=false`.
