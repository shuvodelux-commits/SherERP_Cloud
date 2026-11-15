# M02-P — Canonical Party Review Evidence Identifiers

**Authority:** SherERP Cloud `AGENTS.md`, `docs/WORKSTREAMS.md` M02-P and ADR-007; original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Defect
Offline `planPartyImport(sourceRows,approvedGroups)` checks reviewer identifiers and approval references for nonempty strings and leading/trailing whitespace only. Embedded ASCII control or invisible Unicode formatting characters can therefore survive as apparently valid human-review evidence (e.g. newline in `approvalRef`, bidi override or zero-width spaces in `reviewedBy`). Those values are not safely distinguishable in logs, exported approval lists or human review screens.

## Design
The offline-only `canonicalReviewId` must reject ASCII C0/DEL controls and invisible Unicode direction/zero-width format characters in `reviewedBy` and `approvalRef`. Preserve existing exact-string semantics: no trimming, normalization, renamed IDs or automatic merging. Valid visible Unicode, internal ordinary spaces, reviewer IDs and approval references remain accepted unchanged. Retain distinct existing sanitized evidence validation errors and original source IDs.

## Acceptance
- Embedded newline, NUL, DEL, bidi controls and zero-width format characters in either evidence identifier are rejected.
- Existing blank/padded checks, UTC timestamps, duplicated evidence reference protection, legitimate visible identifiers and deterministic Party link formation remain unchanged.
- Direct tests exercise the actual planner on synthetic Party masters and reviewed links; RED before minimal GREEN and full GitHub CI.
- No real staff authorization, approval persistence, D1 schema, SQL migration, authenticated RPC or financial changes. `PARALLEL-MODULE-READY=false`.

## Scope
Existing pure `src/party/party-import-plan.js` (one predicate), new focused Node test, this spec and one execution plan. Original SherERP UI/GAS and all D1 environments remain untouched. Separate from current M02 PRs #154/#155/#158.
