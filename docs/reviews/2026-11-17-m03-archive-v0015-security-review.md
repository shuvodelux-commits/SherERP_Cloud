# M03 — Proposed archive v0015: security, ownership, and migration decision review

**Date:** 17 November 2026 · **Workstream:** M03 #22 · **Board:** #456 · **Candidate:** `docs/schema/m03-archive-v0015.review.sql` · **Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Starting main:** `40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`, following merged archive proof PRs #544 and #546.
**Disposition:** **DESIGN/TEST CANDIDATE ONLY. DO NOT PROMOTE TO `migrations/0015_*.sql` OR APPLY TO REMOTE D1.** This review does not approve real private exports, Worker binding, authenticated financial posting, staging D1 writes or production traffic.

## Why a new versioned design is required

The previously merged `m03_private_source_seals` and `m03_private_source_rows` proposal is a deliberately synthetic **single unscoped archive** keyed by pinned source commit + group + original row. Local Workerd D1 already proved its trigger behavior and 1,001+ row readback. It has **no explicit business tenant or import-batch key**, so blindly turning it into a shared D1 migration would permit provenance collisions or one import replacing another. The original unscoped `createFrozenSourceReadback()` API cannot safely select a tenant and must not be exposed publicly or reinterpreted as a production reader.

The proposed new schema therefore uses a separate namespace `m03_archive_*` and composites `(tenant_id,batch_id,...)` throughout. It is not a silent alteration of existing private tests or migrations 0001–0014. The candidate number **v0015 is provisional** and must be re-reserved against the latest `main` immediately before any future actual migration PR.

## Data-flow and isolation contract

| Area | Proposed control | Remaining application-level trust requirement |
|---|---|---|
| Batch | `(tenant_id,batch_id)`, pinned source SHA, opaque `evidence_ref`, 64-lowercase-hex `source_manifest_digest`, immutable status | Trusted M04/M03 actor and tenant resolution **before** D1 access; caller-supplied tenant IDs must never authorize their own data |
| Group seal | `(tenant_id,batch_id,source_group)` composite key/FK, allowlist of exactly 49 original source groups, original headers/digest/count | M02 independent original header/canonical-hash evidence; M10 separately verified counts and reconciliation |
| Original row | `(tenant_id,batch_id,source_group,legacy_sheet_row)` composite key/FK; original JSON array cells remain TEXT | Byte-for-byte type/header/ID/text validation in a **new tenant-scoped reader**; preserve physical sheet-row gaps and original deletion history |
| Staging | New batch/group starts STAGING; SQL rejects cross-batch writes and direct SEALED inserts | Imports must require owner approval, private actor, safe operation IDs, staging transaction budget, idempotent retry and deliberate abort |
| Group seal | SQL-atomic COUNT(source rows)=expected_rows, evidence immutability and one-way STAGING→SEALED | Check expected canonical SHA-256 vs independently obtained source witness **before** sealing, not self-supplied candidate copy |
| Batch seal | SQL counts exactly **49 SEALED group manifests** in tenant/batch before one-way finalization | Do not treat SEALED as M10-certified: add a separately owned reconciliation receipt/approval with independent source-to-D1 parity |
| Rewrite protection | Strict DDL, explicit INSERT OR REPLACE duplicate checks, UPDATE/DELETE triggers and no staging-row UPDATE | Privileged DDL actors can disable/drop guards; access policy, backup encryption, immutable external audit and managed schema control required |
| Size/time bounds | Candidate does not change the prior bounded private reader (256-row pages, 250k total, 8 MiB, 20s) | Approved large-export streaming/reconciliation for histories beyond those limits; zero silent truncation |

### One original source row, many business roles

An original `CUSTOMERS`, `SUPPLIERS`, `VENDORS`, `FINANCE_PERSONS`, or `EXPENSE_PAYEES` identity remains attached to its *original source group and row*; nothing in this archive may merge people by name/phone or net balances. Party links, obligations and allowed cross-role settlements remain governed by [ADR-007](../architecture/ADR-007-unified-party-relationships.md), M02 source mapping and M08 independent gross ledgers. Historic opening balances must not create current cash-session turnover; FIFO, lot source IDs and Box/Pcs/Sqft quantities must remain reconcilable from native source records.

## Security threat review (fail closed)

| Severity | Threat | Current candidate result | Required mitigation before runtime promotion |
|---|---|---|---|
| **P0** | Tenant A reading or writing Tenant B's archive | Composite keys and FKs prevent accidental cross-tenant inserts, but **do not implement authorization or SELECT isolation** | M04 trusted actor/tenant from session; parameter-bound `WHERE tenant_id=? AND batch_id=?` on every private SQL, negative cross-tenant Workerd tests; no public route |
| **P0** | A forged or missing original Sheets group appears reconciled | SQL count and self-supplied digest **cannot prove original data authenticity** | M02 independently captured exact headers, row counts and group digests; M10 independently read both sources and sign review; 49/49 real groups required |
| **P0** | Source secrets/PII copied into preview or logs | Raw source-shaped `SETTINGS`, `USERS`, `SESSIONS`, `LOGS`, Bank/Party data are sensitive; candidate TEXT rows are not a privacy solution | Approved field classification, redacted logs, restricted encrypted private export storage, source credential rotation/migration strategy and retention/deletion policy; **never public Worker D1 binding** |
| **P0** | Privileged DDL actor drops triggers or overwrites seals | Triggers protect ordinary DML, **not privileged DDL/operators** | Least-privilege secrets, deploy approval, independent write-protected source manifest/backup, immutable audit outside D1, restore verification |
| **P0** | Parallel financial mutations use a stale authorization preflight | Archive readback is not a posting authority | M03+M04 live session revocation/current role checked inside the single SQL-atomic financial write, plus M05–M08 receipts, stock, ledger and reversal tests |
| **P1** | `INSERT OR REPLACE` deletes a sealed row without firing delete trigger | Candidate checks for duplicate PKs in BEFORE INSERT as well as SQL UNIQUE | Maintain mutation and conflict-mode tests for REPLACE, UPSERT, failed CAS and transaction rollback in real Workerd/D1 |
| **P1** | Partial import marked complete | Each group must have exact staged row count; batch requires 49 SEALED groups | Receipt-based importer resumption, canonical group hash before sealing, atomic receipt/commit and separately signed reconciliation |
| **P1** | Unknown group, corrupted headers, bogus source identifiers | SQL source-group allowlist; original header/cell width **not** checked by schema | Tenant-aware reader validates exact frozen 659 header definitions, original text cell types, physical row identity and hash; independent manual review on ambiguous links |
| **P1** | Oversized exports, D1 operation limits, or source exports larger than 8 MiB | No silent partial success authorized | M03+M10 separately approve encrypted chunk/object-store stream (if needed), page integrity, time/byte budgets, backup, retry |
| **P1** | Migration partially creates tables/triggers | Nothing executed remotely; candidate is standalone | M11 local Workerd apply/reapply/rollback tests; deliberate recovery (prefer new batch, not tampering sealed source); explicit owner backup and restore receipt |

## Trust boundaries that SQL cannot implement

**Source witness:** `source_manifest_digest` and `evidence_ref` are *references supplied by an importer*, not proofs of a separate Google Sheets export. M10 must verify an independently captured original export and D1 readback; the result must be stored in a separate immutable/reviewed evidence packet inaccessible to an untrusted web client. A count-matched malicious `cells_json` payload could seal in SQL: that is expected, so do **not** claim a SQL trigger authenticates original data.

**Tenant authorization:** a client may send `tenant_id` as input but it can never choose the effective D1 authority scope. M04 identity and permissions must be resolved from server-validated credentials. The single approved M03 DAO must accept only the trusted scope and never use unbound SQL identifiers or accept caller-originated SELECT filters that remove tenant/batch restrictions.

**Source privacy:** legacy authentication hashes and sessions should not be blindly preserved in usable modern authentication tables. Retention of exact source history for auditing and reuse of credentials are separate decisions. The archive candidate stores plaintext-shaped source strings and MUST NOT be promoted until an owner-approved protection/redaction/encryption policy for each sensitive source group is reviewed without discarding the audit-evidence requirement. No raw historic export, source tokens, source hashes, bank identifiers or customer phone numbers belong in GitHub, public previews or CI logs.

**Database privileges:** D1 migrations and root operators can issue DDL. SQL triggers enforce ordinary write integrity only; they are not cryptographic immutability or a substitute for an access-controlled immutable backup. Backup/restore must be independently rehearsed and signed; no automated deletion or destructive reset of original data.

## RED→GREEN test plan and evidence boundary

The new `tests/m03-archive-v0015-security.test.mjs` tests tenant/batch isolation with two distinct tenants, repeat batch IDs, all 49 source groups, original Bengali/phone/money text, source row gaps, missing group/row, STAGING→SEALED rules, blocked mutation and `INSERT OR REPLACE`, cross-tenant spoofing, and transaction rollback in **synthetic Node SQLite**. The tests were committed before the new candidate SQL file. Green Node CI does not mean a new v0015 Workerd migration has been applied. The previously passed Workerd proof of the *old unscoped* archive is evidence for SQLite trigger feasibility, not the new scoped schema's promotion.

## Acceptance checklist before an actual numbered D1 archive migration

- [ ] **M03:** approve tenant-safe DAO/API, real local Workerd/D1 verification of this **new** candidate schema, source header/row fidelity and denial tests; no public RPC, preview or production binding
- [ ] **M02:** independently pin original 49 group counts/headers/source IDs and review Party multi-role gross-account identity; source SHA and source witness cannot come only from candidate D1 copy
- [ ] **M04:** server-trusted actor/tenant permission and current session revocation checks, including private import authorization
- [ ] **M10:** owner-authorized protected export, independent 49/49 source→D1 audit, count/hash/financial balance/stock reconciliation, missing/ambiguous record handling, encrypted backup and tested restore/rollback
- [ ] **M11:** no-secret PR previews, branch protection, exact-head full CI, full new Workerd test with SQL DDL guards, explicit owner-approved release and recovery runbook
- [ ] **M03 integrator:** rebase latest main, reserve available next migration number, review persistent tenant schema and security, freeze migration with no live data, avoid overlapping shared SQL/Worker commits

**Decision:** Retain as test-backed **design review only**, with `migrations/**` unchanged and **M03 production acceptance NO-GO**. The user's business data in legacy Sheets remains untouched.
