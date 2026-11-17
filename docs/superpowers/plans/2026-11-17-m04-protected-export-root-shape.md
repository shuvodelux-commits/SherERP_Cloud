# M04 — Fail closed on unreviewed protected staff export root fields

**Workstream:** M04 Authentication/RBAC/session preparation  
**Issues:** #23 (M04 owner), #456 (parallel coordination); independent of M03 #22 shared D1 integrator and #252 products.add write gate  
**Base:** `main@666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`  
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Config.gs` USERS/ROLES and `Auth.gs` session records  
**Primary owner:** M04; `src/auth/d1-offline-staff-import.js`; `tests/m04-provenance-import-required.test.mjs` (and this plan)  
**Scope:** internal offline export-shape validation and tests only. No src/db, migrations, posting, src/rpc, src/index, workflows or Cloudflare Worker bindings.

## Approved lane overview (12 sentences)
1. M04 is the single owner of this internal offline staff importer, subject to M03 integration for any eventual database deployment.
2. Original protected staff export is contracted to contain exactly `users` and `roles` arrays, not the source `SESSIONS` table.
3. The current offline importer validates exact approved fields inside each user and role row.
4. Its root parser currently extracts `users` and `roles` without rejecting additional root properties.
5. Extra root fields could silently accompany a protected snapshot into a trusted import rehearsal.
6. The acceptance test will reject `sessions`, unknown extra keys, hidden properties, symbols and accessor-based root properties before invoking a D1 query or batch.
7. The acceptance test will also reject non-ordinary root prototypes and hostile inspection traps without executing sensitive getters.
8. Plain and null-prototype snapshot roots with exactly two own enumerable data properties remain valid.
9. The smallest implementation is an exact `Reflect.ownKeys` root check with an ordinary-object/null-prototype guard before accessing any rows.
10. All rejected roots retain the generic `Offline staff import rejected` error, without logging or returning source identities, tokens or credential material.
11. The same `captureVerifiedSnapshot` helper protects import, reconciliation and two-pass rehearsal, so no new public API or storage path is needed.
12. RED evidence must show current import improperly accesses D1 for an unexpected root key, followed by GREEN code and the full required GitHub CI on the exact head.

## Superpowers TDD acceptance and merge sequence
- RED test-only commit: `tests/m04-provenance-import-required.test.mjs` requires malformed root objects fail before any D1 method, while ordinary exact roots pass the existing provenanced preflight.
- Confirm RED specifically because root extras are accepted and a mock D1 `prepare` call occurs, not because of invalid row fields.
- GREEN: modify only `captureVerifiedSnapshot` in `src/auth/d1-offline-staff-import.js`. Avoid SQL, schema, fresh dependencies and public Worker changes.
- Run the affected Node tests, preserve existing offline/import D1 integration, and demand complete same-head PR checks. Review all failing CI jobs, including long M03 if applicable. Do not merge until every required check is green.
- Merge after owner/M04 review and any integration-owner concerns. Verify final changed files on `main`; otherwise report draft/unmerged.
- No real USERS/ROLES export, SESSIONS tokens, private credentials, remote D1, staging/production migration, auth RPC activation or public deployment is permitted.
