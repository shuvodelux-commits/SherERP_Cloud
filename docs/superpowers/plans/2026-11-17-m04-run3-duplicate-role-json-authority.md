# M04 Run 3 — SQL/JS duplicate role-permission authority QA

**Workstream:** M04 Authentication, issues #23/#252, coordination #456.
**Base main:** `c989f93031d98e48a4f768623ce0d557e1b2c95c`.
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, source `RoleManagement.gs` creates/updates role Permissions using `JSON.stringify(permissions)`.
**Owner:** M04; `src/auth/d1-legacy-rpc.js`, `tests/m04-duplicate-role-json.test.mjs`, `tests/integration/m04-legacy-rpc-workerd.spec.mjs`, this scoped M04 plan.
**Upstream:** #502, #514 and #530 merged; M03 owns shared atomic SQL, D1 schema/migrations, RPC and Worker binding. No overlap with currently open M03 PR.
**Release effect:** internal authentication behavior and nondeployable tests only; no public auth, remote protected staff import, production binding or shared posting.

## 12-sentence implementation overview

1. The original GAS RoleManagement module stores sanitized permission objects with `JSON.stringify`.
2. Current M04 JavaScript reads `permissions_json` with `JSON.parse` and validates module actions.
3. The internal M03 authorization prototypes separately inspect JSON fields using SQLite JSON1.
4. JSON text with duplicate object keys can produce conflicting interpretations between these parsers.
5. For example, SQLite's first occurrence of `sales.add` may be true while JavaScript's surviving last occurrence is false.
6. A server permission grant must not depend on which parser happens to inspect the role.
7. Such duplicate-key text is not an unmodified canonical GAS `JSON.stringify` role value.
8. New RED tests will reproduce duplicate module and action keys in pure M04 JavaScript and real local Workerd/D1.
9. The safest small GREEN change is to reject noncanonical JSON text instead of inventing a second permission parser.
10. Canonical `JSON.stringify` objects with source-approved modules, types and windows must continue working.
11. A rejected role must not return a usable source-shaped login profile or activate an RPC route.
12. The fix belongs only to M04's local role parser; M03 must separately review all SQL-current mutation and tenant-clock authority contracts.

## Superpowers test sequence

1. Create tests only and preserve a RED commit SHA. The tests must require duplicate-property rejection while preserving canonical role behavior.
2. Check GitHub Foundation RED logs for the intended failed assertion; do not claim Workerd RED passed merely because a job is queued or cancelled.
3. Add a single fail-closed canonicality predicate to existing `roleMetadata`: compare input to `JSON.stringify`'s representation after safe parsing. Source roles are emitted through the same canonical serializer; unusual legacy manual edits require explicit review rather than silent authority.
4. Confirm Node and real local Workerd/D1 coverage, original login envelopes, direct SQL JSON1 discrepancy, protected original UI and all full exact-head CI.
5. Request security review; merge only if exact-head required checks pass, no conflicts and reviewer/owner gate is satisfied.
6. Record accepted LOCAL evidence in M04 issue #23, request M03 #22 to ensure duplicate JSON cannot authorize inside production SQL; **never promote AUTH-G1-v0.2 to approved writer-v1 based on this alone**.

**Rollback:** revert M04 module/test/plan PR; no database schema or data change.
