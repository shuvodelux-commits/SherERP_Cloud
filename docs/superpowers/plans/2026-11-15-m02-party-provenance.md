# M02-P3 Party Provenance Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with TDD.

**Goal:** Fail closed on conflicting legacy row provenance and duplicate identity-review IDs during offline Party import planning.

**Architecture:** Extend input validation within the existing pure `planPartyImport`; keep contracts, output, and CLI unchanged for valid exports. No new D1 write path.

**Tech Stack:** Node.js >=22, `node:test`, ESM JavaScript.

**Spec:** `docs/superpowers/specs/2026-11-15-m02-party-provenance-design.md`

## Global Constraints
- Source `legacy/source` immutable and pinned.
- No Party auto-merges by phone/name, no account netting or cross-role settlement.
- No shared SQL/runtime/RPC/Cloudflare changes; this is an offline, no-write preparation lane.

## Review Focus
- Two distinct IDs claim the same physical row within one source group: reject.
- A missing-ID quarantine row reuses a valid row's position: reject.
- Same row number in two different groups: accept.
- Party snapshot has gaps from deleted rows or reordered JSON: accept unchanged output.
- Identical missing-ID rows without provenance generate duplicate review IDs: reject.

### Task 1: Prove invalid provenance fails closed

**Files:**
- Create: `tests/contract/party-provenance.test.mjs`
- Modify: `src/party/party-import-plan.js`

**Interfaces:**
- Consumes: `planPartyImport(sourceRows, approvedGroups=[])` and `tests/fixtures/party-import.synthetic.json`.
- Produces: same public signature and successful result shape; added validation errors.

- [ ] **Step 1 RED:** Add focused tests for conflicting same-group row positions, collision with quarantined row, repeated missing-ID unpositioned records. Add positive cross-group same index, gaps, reordering/nonmutation cases.
- [ ] **Step 2 RED check:** `node --test tests/contract/party-provenance.test.mjs` must fail for all three new invalid-input cases, with the tests' asserted throws not firing.
- [ ] **Step 3 GREEN:** Track seen physical positions separately for each source group before missing-ID/name quarantine. After review-item generation, reject duplicate `reviewId` values.
- [ ] **Step 4 GREEN check:** Targeted tests pass and existing `tests/contract/party-import.test.mjs` stays green.
- [ ] **Step 5 verify:** Run full `npm test`, `npm run verify:source`, `npm run build:frontend`, `node --check src/party/party-import-plan.js`, `git diff --check`.
- [ ] **Step 6 commit:** One isolated M02-safe commit; prepare source/contract/impact PR evidence; never merge automatically.

## Completion contract
Evidence must distinguish offline synthetic tests from real D1 integration; remaining M02/M03/M04 parallel-module gates stay blocked.
