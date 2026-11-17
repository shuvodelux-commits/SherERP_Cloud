# M04 — Full-module security QA, final local acceptance and cross-lane handoff

**Decision (2026-11-17): LOCAL AUTHENTICATION IMPLEMENTATION ACCEPTED FOR INTEGRATION REVIEW; PRODUCTION RELEASE = NO-GO.** This report does not grant deployment, live source export, staff import, any RPC enablement, private Worker deployment or financial mutation authority. It also does not claim M03 accepted AUTH-G1-writer-v1.

**Repository:** `shuvodelux-commits/SherERP_Cloud` · **Audited main:** `ac966954928feb26d526d1fa9b5bc094283fadec` · **Frozen behavioral source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`, `Config.gs`) · **Owners:** M04 issues [#23](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/23), [#252](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/252); M03 integrator [#22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22); coordination [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).

## Scope and execution overview (12 sentences)

1. The M04 source target is the original `login(mobile,password)`, `validateSession(token)` and `logout(token)` result shapes, together with staff USERS/ROLES management and permissions.
2. The project uses staff RBAC independently from the seven descriptive Unified Party relationship roles.
3. M04 now has private local Workerd/D1 login, source-shaped profile, revoked/idle/absolute-expiry session and current authority-version tests.
4. It has a separate one-time SHA-256 legacy-credential to PBKDF2 upgrade with current D1 compare-and-swap and legacy-verifier purge.
5. Source-faithful identity/role import, source provenance and independent dual-snapshot verification exist only as offline synthetic proofs.
6. Run 1 merged the exact protected export shape and Modern-only session validation improvements.
7. Run 2 merged the rejection of aliased USERS/ROLES source captures.
8. Run 3 merged canonical role-permission JSON rejection after proving a SQLite JSON1 and JavaScript duplicate-key interpretation mismatch.
9. The same SQL-versus-JavaScript ambiguity must still be rejected inside any real M03-owned atomic mutation, not merely during M04 login parsing.
10. The current public RPC registry is empty and the deployed Worker entry has no authenticated D1 binding or public adapter.
11. No protected source staff export, production-capable auth schema/cutover or reviewed tenancy/clock authority has been approved.
12. Therefore the current QA result is a traceable local-only security checkpoint with a strict NO-GO for production and a versioned integration handoff, not a declaration that all M04 release obligations are done.

## 1. Verified implementation and regression evidence

| M04 capability | Specific source and/or executed test | Finding / limitation |
| --- | --- | --- |
| Opaque tokens and hashes | `src/auth/d1-auth-core.js`; `tests/integration/m04-auth-workerd.spec.mjs` | LOCAL: random bearer, stored SHA-256 of decoded 32 bytes; no plaintext bearer in D1 |
| Login throttling | same real Workerd spec | LOCAL: 5 concurrent failures/15-minute lock proof; private endpoint abuse review remains |
| Revocation, idle and absolute expiry | `m04-auth-workerd.spec.mjs`, `m04-auth-authority-version-workerd.spec.mjs`, `m04-session-workerd.spec.mjs` | LOCAL: current D1 checks, no stale role/account/credential epoch resurrection |
| Legacy password upgrade | `tests/integration/m04-legacy-upgrade-workerd.spec.mjs` | LOCAL: one-time salted source SHA256 verification, PBKDF2 conversion, concurrent CAS, failed upgrade remains locked |
| Source-shaped RPC payloads | `src/auth/d1-legacy-rpc.js`, `tests/integration/m04-legacy-rpc-workerd.spec.mjs`, test-only login-shell bridge | LOCAL: original envelope; production public adapter still disabled |
| Last Administrator protection | `migrations/0003_auth_core.sql`; `tests/integration/m04-admin-identity-replace-workerd.spec.mjs` | LOCAL: D1 constraints/triggers in test schema; remote deployment/retention review not approved |
| Offline staff source provenance | `src/auth/staff-provenance-preflight.js`, `src/auth/d1-offline-staff-import.js`, corresponding real local Workerd suites | LOCAL: strict source IDs, source Created By/At/Last Login and role permissions; **no real protected source export** |
| Two independent source captures | `src/auth/two-pass-source-freeze.js`, `tests/m04-two-pass-source-freeze.test.mjs` | LOCAL: exact reviewed shape and nonaliased root/array/row graph; cannot attest operator performed independent real reads |
| Duplicate JSON permission ambiguity | `src/auth/d1-legacy-rpc.js`, `tests/m04-duplicate-role-json.test.mjs`, `tests/integration/m04-legacy-rpc-workerd.spec.mjs` | LOCAL M04: canonical source `JSON.stringify` required; **M03 real SQL claim still requires matching authority proof** |
| Opt-in transport and public fail-closed | `src/rpc/handler.js`, `src/rpc/registry.js`, `src/index.js` | LOCAL / release BLOCKED: test-only trusted adapter; production registry empty and health `database:'not-connected'` |
| Private staging inventory readiness | `scripts/check-m04-login-staging.mjs`, `tests/m04-login-staging-evidence-gate.test.mjs` | DOCUMENTARY ONLY; aggregate evidence never authorizes an import or deployment |

Merged M04 security PRs on audited `main`:

- [#502](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/502): exact protected USERS/ROLES export shape, no unreviewed root/array/row extras.
- [#514](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/514): `credential_state='Modern'` required at both validation heartbeat and final actor lookup.
- [#530](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/530): source-freeze denies aliased source arrays and row objects.
- [#536](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/536): canonical role permission JSON, preventing duplicate-key SQL/JS mismatch at private profile access.

**Exact-head CI anchor:** #536 GREEN `56c69fed48f8800b34d564c759e0db5349bc29be` passed **44/44** GitHub workflows before merging into `main@ac966954928feb26d526d1fa9b5bc094283fadec`. Relevant successful Actions: [Foundation #44071695255](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44071695255), [M04 real Workerd/D1 #44071695280](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44071695280), [M04 login-to-shell #44071694878](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44071694878), [M03 six-shard integration #44071695144](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44071695144), [M01 Chromium smoke #44071695213](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44071695213). These are **local/synthetic and public-inert** runs, not production staging evidence.

**Superpowers RED→GREEN provenance:** #530 RED [Foundation #44069256541](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44069256541) recorded one intended aliased-snapshot failure; #536 RED [M04 Workerd #44071440642](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44071440642) recorded 89 passing tests and one intended duplicate-key login failure; both security fixes were then verified at GREEN. #514 test-only CI was superseded/cancelled and is **not** represented as a confirmed real Workerd RED run; only the isolated SQLite RED proof and merged GREEN coverage are claimed.

## 2. AUTH-G1-v0.2 acceptance matrix (current QA, not certification)

`LOCAL` = demonstrated in isolated synthetic/local tests; `PARTIAL` = narrower evidence than production requirement; `BLOCKED` = no approved integrated proof; `OWNER` = separate protected/source/deployment authorization. No local result can by itself be promoted to release authorization.

| ID | Requirement | Current status | Required next owner/action |
| --- | --- | --- | --- |
| A01 | Decoded-byte bearer digest; no raw token persisted | LOCAL | M04 security reviewer acceptance |
| A02 | Active Modern user + current credential/user/role epochs | LOCAL / PARTIAL | M03 same-claim SQL-current authority verification |
| A03 | Disabled user/role, no reenable resurrection | LOCAL / PARTIAL | M03 deployable D1 triggers and mutation-race proof |
| A04 | Logout/revoke, exact absolute/idle time, future timestamps | LOCAL / PARTIAL | M03 trusted execution clock and same-claim expiry |
| A05 | Literal action grant, malformed/false/string JSON and duplicate keys | **PARTIAL — HIGH** | M03 SQL-level canonical/duplicate-key rejection on the atomic claim; no `json_valid`-only assumption |
| A06 | Client cannot forge clock | BLOCKED | M03/04 private trusted dispatcher and test |
| A07 | Client cannot forge business, tenant or actor | BLOCKED | M03 reviewed one-business D1 or tenant-scoped contract and negative tests |
| A08 | Concurrent last-unit stock claim + balanced journal | LOCAL SYNTHETIC | M03/M05/M06 original FIFO, units, POS/split-payment writer |
| A09 | Revocation race with claim | LOCAL SYNTHETIC | M03 real source posting in one SQL authority boundary |
| A10 | Idempotent actor/intent replay and receipt confidentiality | LOCAL SYNTHETIC | M03 approved receipt/ID namespace with source IDs |
| A11 | Late posting failure rolls back all ledger/stock effects | LOCAL SYNTHETIC | M03/M05–M08 actual Cash/Bank/Party/Cash Session and returns |
| A12 | Concurrent last-active-Administrator protections | LOCAL | M03 reviewed production DDL and protected staff data |
| A13 | Two independently acquired actual USERS/ROLES exports | OWNER / BLOCKED | Protected authorized export/custody/operator/backup attestation |
| A14 | Original `Never` sessions retired rather than eternal bearers | PARTIAL / OWNER | M04 session-retention policy + owner cutover sign-off |
| A15 | Protected private D1 Worker/RPC allowlist; public preview inert | BLOCKED | M03+M11 transport, migration, secrets and binding review |
| A16 | Original sign-in, restore, logout and deny paths in private real staging | PARTIAL / BLOCKED | M01/M04 real authorized Chromium staging proof |
| A17 | Original user/role IDs, counts and historical fields reconcile after protected import | LOCAL SYNTHETIC / OWNER | M02/M04/M10 reviewed source freeze + signed discrepancy report |
| A18 | No public writer before source accounting and auth integration | BLOCKED; SAFE PUBLIC INERT | M03 single integrator + M05–M11 sign-off + owner GO |

### Security finding to hand off — HIGH: SQLite JSON1 duplicate permission keys

Test data `{"sales":{"view":true,"add":true},"sales":{"view":true,"add":false}}` is interpreted differently by SQLite JSON1 `json_type(...,'$.sales.add')` and JavaScript `JSON.parse` (first versus last duplicate key). M04 #536 rejects such noncanonical text at source-shaped login/profile parsing. **That protection is not in the actual M03 posting boundary merely because M04's parser is safe.** M03 must either implement SQL-level canonical/unique-key enforcement at role storage and exact atomic permission claim, or demonstrate an equally strong explicitly reviewed constraint using real local Workerd/D1. See M03 [#22 handoff comment](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22#issuecomment-6946362669). Recheck nested duplicated actions, duplicate top-level modules, and SQL JSON boolean type versus strings/numbers.

## 3. Minimal critical path and file ownership

| Gate / order | Owner | Evidence needed to unblock |
| --- | --- | --- |
| 1. Source staff/export authorization | Owner, M02/M04/M10 | Authorized operator, encrypted custody, two independent protected reads, approved source time conversion, frozen source IDs and two-pass match, signed readback reconciliation |
| 2. Trusted business/clock/SQL claim contract | **M03 integrator** with M04 security reviewer | Business/tenant isolation decision, server-only time, current session/credential/role/permission and canonical role JSON in the **same** SQL claim |
| 3. Safe shared private adapter and schema | **M03** with M11 | Reviewed deployable schema, D1 migration/rollback, private Worker binding, explicit RPC allowlist, no public preview data binding |
| 4. True source operation integration | M03 plus M05–M08 | Source-shaped stock FIFO, multi-unit/Tiles, split payments, Cash Session, Party separated accounts, idempotent receipt/reversal, concurrent Workerd/D1 proof |
| 5. Authorized full staging QA | M01/M04/M10/M11 | Login/restore/logout/disable/role edits, browser sizes, no public auth, backup/restore, source discrepancy and abuse/security acceptance |
| 6. Separate production cutover decision | Owner + all critical lanes | Signed GO/NO-GO, traffic rollback, source integrity, active monitoring and explicit release authorization |

**Hard boundary:** M04 may update `src/auth/**`, M04-owned tests/fixtures and its QA docs only. Shared `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, Worker binding/config, invoice/stock ID issuing and atomic posting belong to M03; all production deployment steps remain separately gated.

## 4. Release decision and rollback

- **M04 internal local-security acceptance:** Evidence sufficient for review and controlled integration work, subject to explicit security approval, not a production deployable completion claim.
- **M04 production-ready:** **NO-GO** — A05 SQL-current mismatch needs M03 proof; A06/A07/A13/A15/A16/A17/A18 are not approved/complete, and original ledger cutover is not accepted.
- **No real private data was read, exported, imported or written** for this QA. No source GAS/Sheets or remote Cloudflare database was changed. No public route was exposed.
- **Rollback for this report:** revert a documentation-only PR; there is no runtime, schema, data or session effect.
- **Review checklist (intentionally unsigned):** M04 security [ ]; M03 tenant/time/role SQL [ ]; M02 source identities [ ]; owner staff export [ ]; M01/M10 private staging [ ]; M11 safe deploy/rollback [ ]; final owner production GO [ ].

**Until the above approvals are recorded, keep the public registry empty and current deployable Worker DB-free. The correct M04 report is LOCAL QA complete / INTEGRATION BLOCKED / PRODUCTION NO-GO, not "ERP authentication launched."**


## 5. CI regression correction and post-merge revalidation (17 November 2026)

The first documentation-only QA PR #540 head `eff46a82a77d8536663a1a4ed23ef1ff5cdd861e` failed 12 of 44 project workflows after an upstream M03 Workerd suite gained an intentional fifth 1,001-row historical readback test. This did **not** represent a new M04 runtime regression: M11's CI membership oracle still required exactly four cases, despite the M03 suite containing five. The failure was visible in [Dashboard #44073655455](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44073655455) and [Day Book #44073655679](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44073655679), with 3,175 other Node tests passing.

M11-owned [PR #541](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/541), head `67e1c722f3223d7b62ddd0d8e483d89ea2068da8`, updated that fail-closed oracle to five cases while retaining the suite exactly once in a required six-shard local Workerd/D1 CI job. Its **44/44** required workflows passed and it merged as `a4e763feea7de9d93440192084d180e1ad6ddc95`. This M04 documentation appendix is a **new-head, full-CI revalidation request** against corrected `main`, not an override or waiver of prior failed results. No authentication endpoint, source data, storage, D1 binding, runtime code or production gate changes. Until #540's own new exact-head CI and reviews pass, keep it unmerged.
