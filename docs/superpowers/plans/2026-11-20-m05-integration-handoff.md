# M05 Private Purchase and FIFO Integration Handoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task; the manifest test must RED before adding the artifact.

**Goal:** Provide M03 with a machine-verified, source-pinned inventory of existing M05 private interfaces and the specific acceptance gates that still block live purchase/stock/supplier accounting.

**Architecture:** Add a compact declarative `docs/m05/contracts.json` linking actual M05 ESM exports, existing unit tests and local Workerd/D1 suites. Add one concise human-readable `docs/m05/INTEGRATION_HANDOFF.md` explaining the G1 boundary, immutable purchase source and integration sequencing. Test the manifest against the current real code and public Worker isolation without adding any production runtime implementation.

**Tech Stack:** Node.js ESM and native node:test, GitHub-hosted CI, existing synthetic local Workerd/D1 tests; no new dependencies.

**Spec:** `docs/m05/G1_SOURCE_CONTRACT_CANDIDATE.md`; `docs/M03_G1_INTEGRATION_HANDOFF.md`; `docs/PARALLEL_EXECUTION.md`; M05 issue #314 and coordination #456. Frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, approved optional multi-unit `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.

## Twelve-sentence implementation overview

1. M05 already provides source-oriented inventory, purchase, mixed-unit, Tiles and FIFO preflight functions.
2. The recent merged #739 and #750 established a historical unit-to-original-lot consistency gate and independent-receipt alias refusal.
3. Their successful tests do not authenticate private historical receipt custody or authorize a D1 stock mutation.
4. An existing M05 G1 document outlines business rules but does not provide a complete machine-checked export and test inventory for the M03 integrator.
5. This slice creates exactly that narrow handoff inventory rather than another purchase writer.
6. Every listed implementation export and its primary unit test must exist in current GitHub code.
7. The exact four synthetic M05 Workerd/D1 suites must be recorded as preparatory evidence, never production posting certification.
8. The acceptance gate lists M02 original identities, M03 atomic posting and receipts, M04 inside-SQL staff/Cash Session authority and M08 exact money accounting as separate blockers.
9. M07 original-lot reversal, M10 archive provenance/reconciliation and M11 owner-approved cutover remain blocked.
10. A 145 Pcs, 730 BDT mixed-unit purchase must remain the example of historical conversion and price retention, not a statement that today’s conversion rates apply to old lots.
11. No source transaction, legacy Apps Script, shared DB, Cloudflare binding, public RPC, UI or original source database will change.
12. A green manifest can close only the documentation/test handoff task, not M05 production readiness.

## Global constraints

- Base GitHub `main@9591444b105af09487fc251a583b0f007bf74645`; own branch `m05/private-contract-integration-handoff-20261120`.
- Exclusive M05 new paths: `docs/superpowers/plans/2026-11-20-m05-integration-handoff.md`, `tests/m05-integration-handoff.test.mjs`, `docs/m05/contracts.json`, `docs/m05/INTEGRATION_HANDOFF.md`.
- No `src/**`, `migrations/**`, shared `tests/fixtures`, `src/db`, `src/rpc`, Cloudflare deployment, private backups, remote D1 or workers changes.
- Do not invent source schema or falsely bless financial amounts; canonical stock units and supplier account signs remain source-specific. Rounding/minor-unit and real source ID links are M08/M02/M03 gates.
- Do not merge before an actual independent review and explicit user approval.

## Review Focus — adverse conditions

1. Missing/renamed ESM export must fail the handoff test rather than pass on file existence.
2. Missing/renamed M05 test must fail, not be replaced by a synthetic declarative claim.
3. Duplicate or non-M05 module paths and duplicate surface IDs must fail.
4. Any release flag changed to true prematurely must fail while public RPC stays intentionally empty.
5. A source file falsely listed as operational D1 writer, or one of the four test-only Workerd suites falsely claimed production, must fail.

## Task 1: RED — one machine-checkable contract test

**Create:** `tests/m05-integration-handoff.test.mjs`.

- [ ] Write native Node tests requiring `docs/m05/contracts.json` to exist, parse and include actual source-pinned nonwriter surface inventory; verify each ESM import export resolves and each unit and Workerd test path exists.
- [ ] Add guard for production-gate booleans, source SHAs, original Worker no-DB / empty RPC state and one 145-Pcs source price calculation.
- [ ] Commit RED test first; run actual GitHub Foundation exact-head CI and verify the expected missing-manifest assertion (not syntax/test dependency error).

## Task 2: GREEN — manifest and concise integration owner handoff

**Create:** `docs/m05/contracts.json`, `docs/m05/INTEGRATION_HANDOFF.md`.

- [ ] Author precisely 14 existing primary M05 read-only contracts with source oracles, direct unit test owners, `productionWriter:false`, `publicRpc:false`.
- [ ] Record four synthetic local Workerd/D1 suite filenames, each tagged `productionPostingProof:false`.
- [ ] Describe exact dependency/owner matrix and next M03 integration order; unchanged original Cash Session check at purchase entry (even zero tender), SQL-time source ID/actor/lot/Party CAS/receipt/rollback.
- [ ] Commit GREEN artifacts and run all current-head GitHub CI (Foundation, M01 Chromium, M03 local Workerd/D1, M05 Tiles synthetic D1 and Cloudflare PR safety).

## Task 3: Independent QA/review handoff

- [ ] Inspect changed paths against active M02/M03/M10 PRs (no conflicts).
- [ ] Record actual RED/GREEN SHA, Foundation summary and full GitHub checks in PR and coordination #456.
- [ ] Separate valid read-only preparation from archived receipt custody and live-data reconciliation; maintain `productionIntegrationReady:false`.
- [ ] Leave the PR DRAFT for independent `/super qa → /super review` and owner-approved merge.
