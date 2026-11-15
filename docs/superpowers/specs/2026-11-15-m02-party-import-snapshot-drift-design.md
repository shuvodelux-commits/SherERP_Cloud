# M02-P Party Import — Reviewed Snapshot Drift Guard (2026-11-15)

**Authority:** `AGENTS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`, pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Existing foundations:** `src/party/party-import-plan.js`, `src/party/import-readback-reconciliation.js`, source provenance tests and synthetic Workerd/D1 import rehearsal.

## Problem

The existing offline planner validates identities/approval evidence for **one** explicit snapshot; D1 readback checks proposed-vs-stored identity rows. Neither compares the exact **reviewed export** with a **later candidate export**. An ID, original source position, name, phone, Finance Person role, active/deleted status, signed opening, vendor receivable/payable or other legacy field could change after a human review without being noticed by a later identity-only review.

## Decision

Implement independent, read-only `validatePartyImportSnapshot({reviewedSnapshot,candidateSnapshot,approvedGroups=[]})` that compares **all exact raw fields** of every original master row, not merely identifying columns. Return **only redacted counts and fixed vocabulary issue codes**, never names, phones, original source IDs, balances, approval refs or record digests.

- Require all five original groups exactly: `CUSTOMERS`, `SUPPLIERS`, `VENDORS`, `FINANCE_PERSONS`, `EXPENSE_PAYEES`; no unknown groups, no partially supplied exports.
- Stable per-row provenance: `_rowIndex` (integer >=2) when present, else original source ID; no name/phone matching, no inferred identity. Duplicate physical rows and unanchored ID-less rows fail closed. Keep original source IDs exactly, including leading zeros.
- Canonical comparison ignores JSON object key order and export row order, but preserves types/strings/values of **every field**, including signed balances, status and role fields. One changed cell or added/removed source record blocks offline rehearsal.
- Independently report missing/duplicate legacy IDs within each group, including duplicate IDs where one row has a blank name; do not rely solely on legacy planner filtering. Cross-group identical IDs are allowed.
- Validate reviewed approval claims against both snapshots by **reusing** `planPartyImport`, not by reimplementing an authorization or identity merge algorithm. Quarantine or pending source identity reviews also blocks the offline rehearsal check.
- `offlineRehearsalClear` is a **synthetic/offline validation signal**, NOT authorization to persist, run D1 migration, approve an actual identity, release ledger balances, or cut over production. Source approvalRef persistence in current D1 Party schema remains a separate blocker.
- Snapshot data are sensitive; never echo them in errors or output, never publish raw hashes as identifiers, and never write to logs or DB.

## No-write boundary and acceptance

Add exactly four **new** files: this spec, `docs/superpowers/plans/2026-11-15-m02-party-import-snapshot-drift.md`, `tests/m02-party-import-snapshot-drift.test.mjs`, `src/party/import-snapshot-guard.js`. No changes to `party-import-plan.js` (open PR #144 owns duplicate-ID fix), `src/db/**`, `src/auth/**`, `src/rpc/**`, migrations, tests/fixtures, Cloudflare configs, original GAS/UI, production D1 or financial ledgers. No new dependencies. Rollback is reverting this standalone PR.

Acceptance: RED failed Node/GitHub workflow before implementation; GREEN source-proven synthetic fixture tests, full Node/84 frozen files/36 original UI includes and M02 local real D1 CI. Explicit tests: unchanged reviewed pair, row/header reordering, ID/phone/roles/status/signed balance drift, added/removed row, duplicate ID with blank-name row, missing source IDs, invalid provenance, redaction, approval evidence, immutable inputs. Fail closed; do not auto-merge Parties or combine customer/supplier/vendor/owner/loan/borrower accounts. `PARALLEL-MODULE-READY=false`.
