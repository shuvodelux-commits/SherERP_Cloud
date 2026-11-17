# M04 Run 2 — independently captured staff snapshot object graph

**Owner/scope:** M04 / issues #23 and #252; coordination #456; M03 integrator #22.
**Base:** `main@f3c1567a66d4e9df98dc1e8de211bd26c12871b2`.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Paths:** `src/auth/two-pass-source-freeze.js`, `tests/m04-two-pass-source-freeze.test.mjs`, this M04 plan, and M04-only handoff evidence.
**Dependencies:** M04 security PRs #502 and #514 confirmed merged to main; no active overlapping M04 PR.
**Excluded:** M03-owned `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, Worker bindings and shared SQL; remote D1; protected real staff export; source GAS/Sheets.

## 12-sentence implementation overview

1. A protected source-freeze pass must compare two independently captured USERS/ROLES exports.
2. The current helper requires different root objects and exact approved source keys.
3. It then validates source values and reports differences with fixed redacted codes.
4. However, two different root wrappers can still share the same USERS or ROLES arrays.
5. Even independently allocated arrays can contain the exact same user or role row objects.
6. Shared references make it possible to accidentally count one mutable source snapshot as two captures.
7. The downstream offline importer already rejects shared arrays and corresponding row aliases.
8. The standalone source-freeze audit must enforce that invariant itself before reporting success.
9. New RED tests will submit aliased arrays, shared user rows, and shared role rows with unchanged source values.
10. The smallest GREEN implementation will reject shared arrays and objects by reference without inspecting secrets or emitting them.
11. Truly separate but value-identical exports must still pass and all previously accepted source-change codes must remain unchanged.
12. The helper remains offline, read-only, and explicitly unable to attest independent acquisition or authorize real staff import by itself.

## Superpowers RED -> GREEN

- Add focused regression tests first on a branch containing no production fix and show the existing freeze audit incorrectly returning `freezeMatch:true` for aliased snapshots.
- Implement one small reference-sharing guard in the existing M04-only function, returning the already-approved fixed `SOURCE_PREFLIGHT_FAILED` response.
- Keep getter/proxy safety, unchanged historical values, counts, row ordering and source provenance checks intact.
- Run affected Node tests and full current-head GitHub PR CI (including existing M04 local Workerd/D1 and original Chromium as required).
- Separate review of M03 interface: a freeze success is **not** permission to provision a production Worker, import actual staff, or expose public login. Contract authority is SQL-current actor/session/role and M03-owned SQL writer; not a read-only JS preflight.

**Roll back:** revert this pure M04 comparator/test PR. No schema, database or deployment rollback.
