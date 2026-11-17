# M04 AUTH-G1-v0.2 — Authentication authority contract and release acceptance

**Status: REVIEW PROPOSAL / NO RELEASE APPROVAL.** This is an M04-owned, testable security handoff for M03 integration. It is **not** a deployable login API, a production D1 migration, permission to import staff, or authorization to post business transactions. The `G1-writer-v1` interface has **not** been frozen by M03.

**Owners:** M04 for login/session/RBAC/original staff contracts (#23, #252); M03 sole integrator for shared SQL, migrations, D1, RPC and posting (#22); cross-module board #456.
**Audited main:** `bcd2d3adbd03f35612c50c1a144a472b1683b412`. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`, `Config.gs`.
**Rules:** `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, `docs/M03_PARALLEL_READINESS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`, `docs/M03_G1_INTEGRATION_HANDOFF.md`.

## 1. Verified implementation inventory versus release scope

| Evidence on main | Actual internal capability | Explicitly **not** proven |
| --- | --- | --- |
| `src/auth/d1-auth-core.js`; `tests/integration/m04-auth-workerd.spec.mjs`, `m04-session-workerd.spec.mjs` | Local D1-backed random bearer issuance, decoded-byte token digest, password KDF/legacy upgrade, current-session validation, revocation, idle/absolute expiry, user/role/credential versions | Public RPC authorization, real imported staff, private production D1 schema migration or approved tenant isolation |
| `src/auth/d1-legacy-rpc.js`; `tests/integration/m04-legacy-rpc-workerd.spec.mjs` | Original-shaped private login/validate/logout profile and strict role metadata | Production login availability, complete original method allowlist or frontend E2E |
| `src/auth/d1-offline-staff-import.js`; `tests/integration/m04-offline-staff-import-workerd.spec.mjs`; merged #479 | Offline source-provenance, two-pass comparison and protected export structural/array-key checks using synthetic records | Authorized export from real GAS/Sheets, privacy-safe encrypted custody, consistent source freeze or remote staff import |
| M03/M04 merged #261, `src/modules/m04-authorized-product-master-create.js` | Local **synthetic** PCAT/PUNT claim with SQL-checked `products.add`, original ID/intent and actor-bound receipts | Deployable catalog mutation, complete source imports, protected public route |
| M03 merged #483, `src/db/m04-atomic-g1-sale-proof.js`; `tests/fixtures/m03-m04-g1-post-workerd-suite.mjs` | One-business-per-D1 **synthetic** `sales.add` session checks in same `INSERT ... SELECT` as receipt, single-SKU stock decrement and balanced two-leg journal; replay/revoke/late rollback/last-unit tests | Real POS, FIFO lots, unit conversions/Tiles, multiple payments, Cash Session, per-Party independent ledgers, reversal or integrated production posting |
| Merged #421, #436; `tests/m04-login-staging-evidence-gate.test.mjs` | Private opt-in login-to-shell contract and read-only aggregate staging-readiness checker | Live staff migration, private Worker deployment, credentials, public sign-in or approved cutover |

**Current public boundary:** `src/rpc/registry.js` deliberately has no entries; `src/index.js` reports `database: "not-connected"` and does not import the M04 adapters. No implementation listed here may be turned into a route merely because a synthetic Workerd test passes.

## 2. Interface for M03 review — authority is SQL-current, not JS-preflight

The following is a **minimum contract sketch**, not a new function to expose or a promise that the exact named schema is deployed.

| Contract element | Required trust source / invariant |
| --- | --- |
| `businessId` or tenant context | Trusted server-side Worker/D1 binding and owner-approved tenant layout; **not** submitted POS/customer/Party data |
| `token` | Opaque 64-character lowercase hex bearer supplied over an authenticated transport; store only SHA-256 of the **decoded 32 bytes**, never SHA-256 of the 64 UTF-8 characters |
| `nowMs` | Server-created integer epoch milliseconds at operation execution; a browser-provided clock must never extend expiration or idle timeout |
| `operationId` | Stable, validated idempotency key in approved per-business/per-operation namespace; same key with a different canonical intent must conflict |
| `actorId` | From current D1 `auth_users` JOINed to the session **inside the claim statement**; never from client, Party, checkout cashier label or earlier JS preflight |
| `permission` | Fixed server operation-family → source staff module/action mapping, e.g. PCAT/PUNT `products.add`, synthetic sale `sales.add`. Staff `ROLES` and Unified Party roles are distinct. |
| `resultReceipt` | Immutable tenant/business, operation ID, original source IDs, actor ID, operation type, payload hash and outcome, inserted atomically with any stock/journal effects |
| `outcome` | Commit once, same-current-actor/same-intent replay, conflict/denial, or **NEEDS_REVIEW** for ambiguous SQL/network outcome; never blindly regenerate a new ID |

### Required authorization predicate in the **same** SQL statement as every protected write

1. Select one active `auth_sessions` row by the decoded-bearer SHA-256 digest, with `revoked_at_ms IS NULL`, `created_at_ms <= trusted_now`, `expires_at_ms > trusted_now`, `last_activity_at_ms > trusted_now - 30 minutes`, and `last_activity_at_ms <= trusted_now`.
2. Join the **current** `auth_users` row: exact session user ID, `status='Active'`, `credential_state='Modern'`, and equality of current `auth_version` and `credential_version` to the session snapshot.
3. Permit built-in `Administrator` only under the reviewed source admin rule and null role epoch. For other staff, JOIN an active `auth_roles` record with current role epoch equal to the session snapshot.
4. For custom roles, require bounded, valid JSON and literal SQL JSON boolean **true** for the exact action, e.g. `json_type(r.permissions_json,'$.sales.add')='true'`. A missing grant, string `"true"`, malformed JSON, disabled/stale role or UI `allowedModules` **cannot** authorize.
5. Combine these predicates with trusted business scope, source inventory/ledger preimage and version-fenced compare-and-swap, immutable operation receipt and DB-generated source IDs, so failed authorization cannot leave a counter increment, partial ledger, stock movement or future-replay receipt.
6. Reread/reconcile a receipt **only for the still-authorized current actor**. An older successful session, same token after revocation, cross-actor operation ID, changed payload or stale credential/role epoch may never disclose an existing receipt.
7. A prior JS `validateSession`, UI route check, read-only preview or role navigation display is **not** transaction authorization; never separate the current SQL authority check from the financial claim.
8. A zero-row CAS, SQL trigger `ABORT`, database timeout, unknown commit response or receipt mismatch must be treated as denied/conflict/**NEEDS_REVIEW** according to an explicitly reviewed idempotency policy, not translated into success or automatic new-ID retry.

**Current architectural caveat:** #483's `auth_sessions` fixture has no tenant column and is one business per D1. That is **not** a multi-tenant production contract. Its internal `post_(request)` accepts `nowMs` as an input for testing; the eventual server dispatcher must derive the clock internally and use a private DB binding. M03 must choose and review tenant layout, clock source and RPC transport before freezing any deployable G1 interface.

## 3. Security acceptance matrix (release gate)

Statuses: **LOCAL** = covered in narrowly scoped synthetic/private test suites listed above; **BLOCKED** = no approved integrated production-compatible evidence; **OWNER** = separate protected data/deployment approval. A LOCAL cell is **never** equivalent to production-ready.

| ID | Required test / decision | Current evidence category | Sign-off needed |
| --- | --- | --- | --- |
| A01 | Opaque bearer digest is based on decoded bytes; token not persisted or logged | LOCAL M04 auth | M04 runtime security review |
| A02 | Fresh active Modern user, no stale credential or role epoch | LOCAL M04 / #483 narrow SQL | M03 current-write gate review |
| A03 | Disabled user/role and old login never regain authority on reenable | LOCAL M04 + #483 narrow SQL | Approved deployable D1 constraint/trigger |
| A04 | Logout, explicit revocation, exact absolute expiry, idle threshold and future activity deny | LOCAL M04, partial #483 | M03 real commit-time negative matrix |
| A05 | Missing/false/string/malformed permission JSON denies at action-specific claim | LOCAL #261/#483 narrow SQL | Full original source role-shape and SQL consistency review |
| A06 | Server-owned clock cannot be replaced by client `nowMs`, including future timestamps | **BLOCKED** public/private dispatcher absent | M03+M04 reviewed trusted transport |
| A07 | Actor, operation family and business scope cannot be forged through request values | LOCAL one-business synthetic | M03 approved tenancy/operation schema |
| A08 | Two simultaneous last-unit writes: exactly one can commit with balanced journal | LOCAL #483 single SKU | M05/M06 real lot, units and split-payment posting |
| A09 | Revocation concurrent with claim: only SQL-serializable pre-revocation write may commit | LOCAL #483 synthetic | M03 actual source transaction writer |
| A10 | Same actor/same intent replay; cross-actor disclosure and changed-intent conflict | LOCAL #261/#483 synthetic | M03 versioned receipt/ID and source ledger policy |
| A11 | Late journal failure rolls back receipt, inventory and all money effects | LOCAL #483 two-leg journal | Real Party/Cash/Bank/Cash Session, FIFO and reversal |
| A12 | Last active Administrator cannot be disabled, demoted, deleted or overwritten by a concurrency race | LOCAL fixture and M04 guard tests | M03 reviewed deployable auth SQL triggers |
| A13 | Two independently acquired source USERS/ROLES exports, verified date/ID/role provenance | Synthetic preflight only; **OWNER** | Explicit operator/export/backup approval |
| A14 | Original legacy `Never` sessions never migrate as unlimited Internet bearers | Design and local expiry policy; **OWNER** | M04 security and owner cutover sign-off |
| A15 | Private Worker has protected D1 binding and exact RBAC allowlist; public preview stays inert | **BLOCKED**; current public registry empty | M03/M11 transport/deployment review |
| A16 | Original login→restore→logout and unauthorized actions pass Chromium mobile/tablet/desktop | Private test-only coverage; **BLOCKED** live staging | M01/M04 real private staging E2E |
| A17 | Complete original user/role counts, source IDs and historical provenance reconcile postimport | Synthetic only; **OWNER** | Protected staff import with signed discrepancy report |
| A18 | No public writer until M02/M03/M04 and M05–M08 exact source accounting contracts are jointly satisfied | **BLOCKED** per current readiness board | M03 integrator + module owners + owner GO/NO-GO |

Use actual exact-head GitHub Actions URLs, current commit, per-test assertions and a signed review for any row being promoted from LOCAL/BLOCKED to an approved integration gate. Do not tick an entire family green because a narrow synthetic test passed.

## 4. Concrete next work by ownership (no concurrent shared-path edits)

**M04 lane (#23, #252):**
- Verify M04 real Workerd auth tests cover A01–A05 and A12 with source-shaped permission cases, last-admin SQL constraints, password rotation, revocation and session expiry; add M04-only negative tests when a *specific* gap is reproduced.
- Publish a reviewed, minimal `AUTH-G1-v1` server-authority contract only after M03 accepts its session field names, trusted clock, exact permission JSON handling and one-business-per-D1 versus multi-tenant decision. A proposal is not a frozen version.
- Retain `src/auth/**` source-correct password, session, role import and provenance; never independently edit M03-owned migrations, Worker API registration, posting or real data.
- Owner approval and protected private staff export/reconciliation are prerequisites, not tasks an agent can perform unilaterally.

**M03 sole integrator (#22):**
- Resolve A06 and A07; choose a trusted server clock, isolation model, `auth_sessions` deployment migration and exact operation receipt interface.
- Advance G1 posting beyond one synthetic SKU via a small reviewed atomic SQL contract PR, with complete stock/Party/Cash Session/reversal evidence and source-ID compatibility. Never enable public RPC simply to exercise a local proof.
- Own `src/db/**`, migrations, `src/rpc/**`, `src/index.js` and Worker bindings. Request M04 sign-off for changes to authentication semantics.

**M02/M05–M08/M01/M10/M11 dependencies:**
- M02 reviews original staff/source ID and Party role-account separation, gross balances and import correspondence. M05–M08 own FIFO/POS/returns/finance domain parity, *not* shared posting SQL.
- M01 verifies source-faithful original UI and real Chromium, including login/restore/logout once a sanctioned private auth environment exists.
- M10 owns protected rehearsal and discrepancy/restore evidence; M11 owns D1-binding isolation, rollout, monitoring and rollback plans. None can approve activation by a synthetic test count.

## 5. Reviewer decision record — intentionally not signed

- [ ] M04 security reviewer accepts exact authority predicate and action map, including `Never` session retirement.
- [ ] M03 integrator accepts tenant/business and trusted-clock interface, D1 schema/versioning and SQL-current authorization boundary.
- [ ] M03 verifies receipt owner, full atomicity, replay and unknown-outcome contracts against actual source-shaped ledgers.
- [ ] M02 source/Party role-account and original IDs reviewed and fully reconciled.
- [ ] Protected source staff export, backup, encrypted custody, two-pass freeze and import separately authorized by owner.
- [ ] Private staging D1 authenticated Worker, reviewed allowlist, secrets and real sign-in E2E authorized.
- [ ] M01/M10/M11 security, browser, disaster recovery and production cutover gates independently signed.
- [ ] Dedicated reviewed integration PR proves every required real Workerd/D1 gate on its **exact current head**.
- [ ] Separate release approval granted. Until then, **PUBLIC AUTH 501/503, SHARED TRANSACTION WRITES BLOCKED, PRODUCTION CUTOVER BLOCKED**.

**Rollback:** This document creates no schema, runtime dependency, staff data, endpoint or Worker binding. Revert this M04-only review artifact if the source/contract review supersedes it. Do not change any historical source data on that basis.
