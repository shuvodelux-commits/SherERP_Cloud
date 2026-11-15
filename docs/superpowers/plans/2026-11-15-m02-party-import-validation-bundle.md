# Superpowers TDD plan — M02-P Party Import Validation Bundle

**Date:** 2026-11-15. **Spec:** docs/superpowers/specs/2026-11-15-m02-party-import-validation-bundle-design.md.
**Pinned source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## Task 1: RED first
Create this plan, spec and `tests/m02-party-import-validation-bundle.test.mjs` only, then commit. Test independently approved unchanged complete exports; missing reviewed/candidate header and row field; both identically truncated but unchanged exports; complete changed phone/name/original ID, signed balance, roles; pending reviews without evidence; corrupted approvalRef; source row provenance; malformed snapshots; redacted fixed-diagnostic output; no mutation and zero-row groups. Confirm actual GitHub Foundation RED on absent `src/party/import-validation-bundle.js`; do not add code before RED.

## Task 2: GREEN minimal
Create only `src/party/import-validation-bundle.js`, importing existing `export-column-coverage.js` and `import-snapshot-guard.js`. Validate reviewed + candidate headers/rows separately; skip identity stage if incomplete and expose null status, never silently report clear. Otherwise run reviewed-source-drift/approval check; relay **only** known redacted diagnostics with fixed stage, codes and counts, sort. Any source exception becomes one fixed generic failure. No extra normalization, matching, settlement or data I/O.

## Task 3: Verification
Run exact-head GitHub Foundation suite, frozen 84 GAS sources, 36 source UI includes, M01 Chromium, M02 Party real local Workerd/D1 and synthetic rehearsal/staging, M03 real local Workerd/D1, M04 auth, Cloudflare no-secrets PR safety. Record actual RED and GREEN GitHub workflow IDs and test counts. Check diff exactly four new files and current main mergeability. Leave PR draft/unmerged for owner. No remote D1 or production code activation.

**Rollback:** revert PR, no database migration. Parallel transaction-module readiness remains false.
