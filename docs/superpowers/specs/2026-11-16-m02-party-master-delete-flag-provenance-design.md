# M02-P — Preserve original Party master deletion-flag provenance

**Authority:** `AGENTS.md`, M02-P in `docs/WORKSTREAMS.md`, owner-approved ADR-007, immutable `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and original `legacy/source/Config.gs`. This is an offline-only validation safeguard.

## Root cause and source behavior

The original Config.gs describes `Is Deleted` as `'TRUE'` for a soft-deleted row and blank otherwise. Existing historical/export fixtures also allow boolean and textual `FALSE`. The current `src/party/export-column-coverage.js` checks these fields with a generic scalar predicate; finite numbers (`1`, `0`) and unknown text (`YES`, `DELETED`) pass as valid. Later `src/party/party-import-plan.js` marks a master as retired only when `String(row['Is Deleted']).trim().toLowerCase()==='true'`. Thus an ambiguous source flag can be silently treated as an *active* Party identity or role/link while source completeness incorrectly reports success.

## Intended behavior

For every original Party master group that actually has `Is Deleted`—`CUSTOMERS`, `SUPPLIERS`, `VENDORS`, `EXPENSE_PAYEES`—require null, literal boolean, blank string, or case/whitespace-insensitive `TRUE`/`FALSE` string. Reject numeric aliases, unexpected text, arrays, objects and undefined via existing fixed `UNSAFE_VALUE` report (one count per invalid source cell). Never coerce or rewrite the source row, infer a state, or change the original `inactive`/role/link planner. `FINANCE_PERSONS` intentionally lacks `Is Deleted` and is left unchanged.

## Acceptance criteria

- Each of the four deleted-capable source groups rejects `1`, `0`, `'YES'`, `'DELETED'` and other unrecognized flags despite otherwise complete headers/rows.
- Multiple invalid rows/groups produce accurate redacted `UNSAFE_VALUE` per group and count.
- Existing null/blank/true/false/case/whitespace TRUE/FALSE source formats remain valid.
- Source records are immutable; no Party link merging, role-account netting, financial posting, cash/bank activity, D1 import or production approval is generated.
- The composed offline import candidate validation refuses source-drift/identity-review clearance if deletion-flag source export coverage fails.
- No new D1 schema, Worker RPC, original GAS/Sheets/front-end changes or dependencies; all downstream Money, balance and authorization semantics remain independently reviewed.
- GitHub Superpowers TDD: commit tests before source, obtain observed RED, apply minimal GREEN, verify exact-head GitHub Foundation, original UI/source, Workerd/D1, browser and Cloudflare PR-only safety.

## Scope, risk and rollback

Exactly four files: `src/party/export-column-coverage.js` (small private predicate and existing unsafe-cell check), new `tests/m02-party-master-deletion-flag-provenance.test.mjs`, this design and implementation plan. No `src/db/**`, migrations, production or remote staging D1 writes, RPC/auth, financial posting, source GAS/Sheets or UI changes. This makes malformed historical flags fail closed during offline rehearsal; such flagged exports require independent source evidence review rather than automatic correction. Revert the PR for rollback; `PARALLEL-MODULE-READY=false`.
