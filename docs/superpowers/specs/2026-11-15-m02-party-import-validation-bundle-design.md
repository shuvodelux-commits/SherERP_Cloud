# M02-P — Fail-closed Party Import Validation Bundle (2026-11-15)

**Frozen source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. **Policy:** AGENTS.md, ADR-007 unified identities/separate role accounts and docs/M03_PARALLEL_READINESS.md. The current project is parallel preparation READY, not transaction-module live migration ready.

## Problem

Merged #154 `validatePartyExportCompleteness` and merged #146 `validatePartyImportSnapshot` work separately. An operator or future migration caller could check only one: **two identically truncated exports pass drift**, while two individually complete but different exports pass column coverage. An incomplete or unsafe source export must never be treated as reviewed identity data.

## Decision

Add `validatePartyImportCandidate({reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,approvedGroups})` in **one new pure** `src/party/import-validation-bundle.js`. It composes the two already-reviewed functions without modifying either.

1. Require explicit two snapshots, two **captured** original source header sets, and an explicit approval decision array (empty is permitted and typically leaves matching-name/phone identity reviews pending). No data is loaded from Sheets or D1. Header metadata must originate from trusted offline export tooling; passing validation cannot authenticate it.
2. Run pinned legacy Party-master **header and row-field completeness** on *both* reviewed and candidate exports first. Collect only fixed-code, stage-labeled, group-level diagnostics. If either fails, do not execute snapshot matching or importer-based approval projection; mark those fields `null` (not implicitly clear), add fixed `VALIDATION_SKIPPED` diagnostic, and block rehearsal. Missing metadata, malformed data or unsafe exceptions fail closed with a fixed generic error string.
3. Only if both original-master exports are complete, run existing `validatePartyImportSnapshot` with the **same** explicit human-reviewed groups. This checks exact original IDs/row position, source phone/name, signed opening, Vendor AP/AR, Finance Person roles, status and all original raw fields. Existing planner validates approval claims and pending/duplicate/blank-name identity reviews. No auto-merge by name/phone, no role/account netting.
4. Report exact fields: `{formatVersion:1,reviewedExportComplete,candidateExportComplete,sourceUnchanged,identityReviewClear,offlineValidationClear,counts,issues}`. The latter three flags are **not** authorization to import, insert, merge, settle or deploy. Counts combine two exports and preserve `null` if later stage skipped. Issue entries only `{stage,sourceGroup,code,count}` with fixed stage/keys and deterministic ordering. No source values, source IDs, names, phone numbers, balance values, reviewer IDs or approval references, or hashes appear in output/errors.
5. No new database/tenant/session schema. No D1 queries or writes. Reviewed real balance reconciliation and authenticated approvalRef persistence stay separate release gates. `offlineValidationClear` means **only** that these supplied input structures satisfy two synthetic offline checks.

## Alternative and scope

Do **not** modify shared import planners or add public RPC (M03/M04 ownership, release gates). Prefer 45–70 lines of readable composition over another identity algorithm. No new dependencies. Exactly four new files: this spec, Superpowers plan, one Node regression test and the pure module. No edits to existing source, tests, original UI or GAS, Worker/config/SQL migrations, DB or ledger files, Cloudflare, staging/production D1. Rollback: revert standalone PR; no data recovery. `PARALLEL-MODULE-READY=false`.
