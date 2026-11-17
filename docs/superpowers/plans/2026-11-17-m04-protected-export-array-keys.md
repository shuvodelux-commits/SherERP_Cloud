# M04 — Reject unreviewed properties on protected staff export arrays

**Workstream:** M04 Authentication/RBAC internal import safety
**Coordination issues:** #23; #456
**Main base SHA:** `1f068fc3c30c625446c560364fb872ae68cb8bc1`
**Depends on:** #464 merged into main; internal M04 offline importer only; no M03 integration files
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` Config.gs USERS and ROLES headers, Auth.gs SESSIONS excluded
**Exclusive M04 paths:** `src/auth/d1-offline-staff-import.js`, `tests/m04-provenance-import-required.test.mjs`, this plan. No edits to M03 src/db, migration SQL, src/rpc, Worker entry or public bindings.

## Overview (12 sentences)

1. The original protected-export contract contains exactly two arrays, users and roles.
2. Their individual source rows are already checked against approved Config.gs field names.
3. The #464 guard prevents extra fields on the export root but does not inspect the arrays' own keys.
4. JavaScript arrays can hold custom string properties, hidden fields, symbols or accessors without affecting length.
5. The current captureRows loop could silently ignore those unreviewed properties and proceed toward D1.
6. A RED regression will place one extra property on either users or roles and assert that no D1 call occurs.
7. The regression will cover enumerable and nonenumerable keys, symbols, accessors and a throwing key-enumeration trap.
8. Both ordinary dense arrays and empty valid roles arrays must retain their existing accepted behavior.
9. The minimal GREEN implementation will require exactly the array indices and the built-in length property.
10. This check must run before source row capture or any D1 query and must not access custom property values or execute getters.
11. All rejected snapshots retain the original generic Offline staff import rejected message.
12. Exact-head PR CI, including Foundation and real local Workerd/D1 checks, is required before owner-reviewed merge.

## Test-first steps and acceptance

- RED: add tests on `tests/m04-provenance-import-required.test.mjs`, use synthetic protected snapshot and a counting D1 mock, assert no database query on extra array keys and one query on valid arrays (with error redaction preserved).
- Verify an assertion fails because D1 is called for an unreviewed array property. Do not commit production changes before RED proof.
- GREEN: in existing `captureRows`, enumerate `Reflect.ownKeys(rows)`, require exactly `rows.length + 1` keys (every index is separately required by existing loop; the one extra key is built-in length). Cap remains 10,000, exceptions fail closed. No dependency or new API.
- Refactor only if needed and ensure original importer, reconciliation and two-pass freeze tests remain unchanged.
- Full GitHub checks required on final commit; no stale green / fast feedback substitutes.
- **Risk/rollback:** stricter offline export validation, revert M04-only guard if original source evidence disproves contract. No real customer/staff data, no remote/staging/production D1 mutation, no finance/posting change or public login activation.
- **Merge order:** one independent M04 PR to main after owner review, complete exact-head CI, no overlapping file claims or conflicts. Verify main after merge, update #23.
