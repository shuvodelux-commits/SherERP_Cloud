# M02-P Party Master Money Precision Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, with source-pinned tests RED before implementation GREEN.

**Goal:** Reject source master exports whose monetary fields cannot be represented as exact, safe two-decimal minor units before identity/import review, without altering valid historical credits or amounts.

**Architecture:** Extend the existing pure, offline \`validatePartyExportCompleteness\` with one narrow numeric string/number predicate, using the same exact two-decimal and safe-integer-minor-unit rule as merged \`src/party/gross-balance-preflight.js::toMinorUnits\`. Apply only to \`Opening Balance\`, \`Current Due\`, and \`Current Receivable\` in their source-pinned Customer, Supplier and Vendor groups. Do not change frontend, import plan, finance posting or D1. Return existing fixed-vocabulary \`UNSAFE_VALUE\` group counts; no sensitive amounts in diagnostic output.

**Tech Stack:** Node 22+, ESM, native \`node:test\`, GitHub Actions, frozen GAS source, Cloudflare Workers/D1 existing regressions.

**Spec:** \`docs/WORKSTREAMS.md\` M02-P, \`AGENTS.md\`, ADR-007, frozen \`Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2\`; existing exact-minor-unit source preflight \`src/party/gross-balance-preflight.js\`.

## Global Constraints

- All work GitHub branch/PR; no direct main commits or local-PC edits; TDD fail → implement → green CI.
- Preserve source row identifiers, seven separable roles and gross account signs; no auto-merges, netting or ledger writes.
- Preserve source NULL and blank amounts as zero/unspecified, positive/negative exact decimal values, \`0\`, and all original nonmoney fields.
- Do not introduce new exports, RPC, SQL, schema, financial posting or dependencies; no remote D1 or production import.
- Source export checker is a preflight; passing is **not** final accounting reconciliation or authorization.

## Review Focus

- Both identical unsafe snapshots must not pass \`validatePartyImportCandidate\` and skip into identity approval replay.
- Floating numbers such as \`12.345\`, decimal string \`-1.234\`, bool \`true\`, and representable but unsafe-cent amounts must fail closed.
- Valid source negatives (Customer/Supplier advance), independent Vendor receivable/payable, zero, blank, null and two-decimal strings must remain accepted.
- Boundary \`90071992547409.91\` minor units is safe, \`90071992547409.92\` is unsafe; no \`Number\` rounding to make unsafe amount look safe.
- Diagnostics must remain fixed-code per group with no raw original values, names, phones or field names.

### Task 1 — Test-first source money preflight

**Files:**
- Create: \`tests/m02-party-export-money-precision.test.mjs\`
- Modify after RED: \`src/party/export-column-coverage.js\`

**Interfaces:**
- Consumes: \`validatePartyExportCompleteness({sourceRows,sourceHeaders})\` and \`validatePartyImportCandidate({reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,approvedGroups})\`.
- Produces: no new exported API; only existing group-coded \`UNSAFE_VALUE\` count and \`offlineExportComplete=false\` for precision failures.

- [ ] Commit this plan on dedicated GitHub branch.
- [ ] Commit new tests before modifying source: construct complete pinned-source exports from \`docs/baseline/schema-inventory.json\`; cover invalid numeric/string precision, safe limit, booleans, previously legitimate amounts, and the combined validation gate.
- [ ] Verify **RED** in actual GitHub Foundation source-check workflow: expected failing assertions (current finite wrong-precision numeric and malformed money strings report \`offlineExportComplete=true\`). Ensure unaffected source cases pass.
- [ ] Implement minimal local predicate: for nonblank money value, only decimal strings or finite numbers with optional sign and at most 2 decimals; convert two-decimal cents and require \`Number.isSafeInteger\`; keep original general \`validCell\` for other fields.
- [ ] Verify **GREEN** in exact-head GitHub Foundation \`npm test\`, pinned source verification, original frontend, M02/M03/M04 actual Workerd+D1 and Cloudflare preview safety workflows.
- [ ] Review diff for exactly plan, test and one M02 source file. PR with RED/GREEN evidence, zero schema/financial/remote effect and remaining account reconciliation gates.

## Ruling / boundaries

No new \`UNSAFE_AMOUNT\` code: use the already published \`UNSAFE_VALUE\` counter to avoid changing downstream validation payload contracts. Distinguish this preflight from \`prepareGrossPartyBalances\` which remains the separately owned authoritative gross money checkpoint. Rollback: revert this PR, no data recovery. \`PARALLEL-MODULE-READY=false\`.
