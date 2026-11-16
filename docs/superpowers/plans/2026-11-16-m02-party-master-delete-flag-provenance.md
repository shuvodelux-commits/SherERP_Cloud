# Superpowers TDD Plan — Party Master Is Deleted Source Evidence

> Required: Superpowers test-driven-development, executing-plans, verification-before-completion, GitHub-first workflow, KISS. No production source edits before observed GitHub RED.

**Goal:** Prevent an ambiguous original Party master `Is Deleted` flag from being silently imported as an active identity after source-export completeness review.
**Design:** In `src/party/export-column-coverage.js`, use a small private explicit flag predicate inside existing unsafe-value validation only for fields named `Is Deleted`.
**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` Config.gs, ADR-007.
**Spec:** `docs/superpowers/specs/2026-11-16-m02-party-master-delete-flag-provenance-design.md`.

### Task 1 — RED source provenance regression

1. Create a GitHub branch from current `main`; commit synthetic tests before any production edit. Use five original group headers and rows, including four soft-delete-capable groups and the unchanged `FINANCE_PERSONS` table.
2. Test numeric and unknown textual deletion flags for each group, multi-group counts, valid blank/null/boolean/TRUE/FALSE flags, unchanged source snapshots, redacted issues, preserved exact signed BDT balance cells, and blocked composed Party import validation after source failure. Do not modify financial logic or Party linking.
3. Create draft PR and observe GitHub Node/Foundation RED tests on test-only commit. Record exact intended failures, distinguish independent runner failures from expected RED.

### Task 2 — Minimal GREEN and verification

4. Add one local `validDeletionFlag` private predicate and include `name==='Is Deleted'&&!validDeletionFlag(value)` in the existing source `UNSAFE_VALUE` branch. Do not alter `party-import-plan.js`, accounting, source snapshots or importer.
5. Run all exact-head GitHub CI: Foundation Node tests, pinned 84-file source audit, original 36 UI includes, Party/D1 real local Workerd tests, gross checkpoints, M03 runtime, M04 auth, M01 Chromium, M09 integration, Cloudflare PR-only safety.
6. Review patch/scope, merge conflicts against latest main, RED/GREEN evidence; keep draft until all CI and owner review. `PARALLEL-MODULE-READY=false`. Roll back with PR revert. No staging/production D1 import or finance/cash/ledger posting.
