# M03 source archive sealing — isolated SQL proposal and handoff

**Date:** 2026-11-17. **Source:** pinned read-only `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Base main:** `a4e763feea7de9d93440192084d180e1ad6ddc95`. **M03:** issue #22, central board #456, private source readback PRs #523/#537, CI #532.
**Status:** **NONDEPLOYABLE STAGING/IMMUTABILITY SQL PROPOSAL**. This is *not* a numbered D1 migration and is *not* a production historical-data import.

## Scope and data model

`docs/schema/m03-private-source-archive.proposed.sql` defines two strict local SQLite/D1-compatible tables with **the exact six seal fields and four row fields** already consumed by `createFrozenSourceReadback()`:

| Table | Source-frozen key | Invariants |
|---|---|---|
| `m03_private_source_seals` | `(source_commit,source_group)` | Pinned 40-character source SHA; 49 known group names; JSON headers; declared count; 64-hex group digest; `STAGING` or `SEALED` |
| `m03_private_source_rows` | `(source_commit,source_group,legacy_sheet_row)` | Original physical row as safe integer ≥2; original JSON text cells; exact parent group foreign key; unique original row positions |

Database triggers require new seals to begin at `STAGING`. Source rows can be appended or removed for staging rollback only while the matching group remains `STAGING`. Row **updates are always forbidden**, so correcting a staged source row requires a delete+insert at the original physical sheet row, with a recomputed source evidence seal. Groups may be marked `SEALED` only when the declared count is identical to a SQL count of their staged rows. The `STAGING→SEALED` statement cannot change the declared count, headers or digest simultaneously; any post-seal seal edit, source-row insert/change/delete, or historical seal deletion aborts in SQLite. Group and source SHA identity may never be reassigned. These rules are **DB-enforced**, not JavaScript preflight checks.

The private source readback independently verifies all 49 group names, 659 original header names and their order, original text cells and physical rows, the complete group count and M02 canonical SHA-256 of `[version,group,headers,rows]`. Pinned sample values include source ID `000-AB-009`, original phone `01700000000`, `-001.00` signed money text, legacy Boolean strings and Bengali values; no schema normalizes them. SQL row counts and the source-reader digest comparison are complementary: a correct count by itself cannot establish that the archive matches the original spreadsheet.

## Test-first evidence

- Source plan `docs/superpowers/plans/2026-11-17-m03-private-source-archive-seal.md` created before the new SQL schema.
- First new tests committed `399bc4fa0e5aacfd4560bdd397b869f7a49a36ac` before `docs/schema/m03-private-source-archive.proposed.sql` existed.
- GREEN schema commit `7963054879d7a04d7cb8ddf956787eea33f209a5`, then a safety-test correction excludes SQL comments while checking executable statements (no relaxation of SQL restrictions). Final required CI evidence must be taken from the **latest PR head**, not earlier attempts.
- Node SQLite tests: two strict tables, 49 original source groups, 659 source columns via frozen headers, immutable sealed rows/seals, staged source replacements, original IDs/text, duplicate/unknown identities, seal row-count mismatch, canonical digest corruption, and atomic rollback.
- **Real local Workerd/D1 compatibility for this newly proposed DDL has not yet been independently verified**. Existing M03 required Workerd suites test deployed operational migrations and the separate synthetic reader fixtures; they are not proof the new SQL proposal is deployed, installed or authorized.

## Security and production limitations

- SQLite `json_valid` checks syntax, not exact frozen header/cell content. Private reader validates exact header shape, cell array width and string types. That reader must remain internal; a shared or public D1 binding does not follow from this proposal.
- Seal digest is supplied by a staging writer. SQLite cannot prove the writer's digest equals **independently captured original GAS/Sheets data**; that source authenticity is explicitly **M02/M10 owned** and cannot be inferred from identical source/candidate JSON snapshots.
- 49 group source definitions and 659 headers do not mean real 49-group data has been migrated. **0/49 original groups independently reconciled against real D1** remains the documented acceptance state.
- The existing private reader remains bounded at 250,000 total original rows, 8MiB serialized row JSON and 20s. A larger business history requires an owner-reviewed streaming/import and independent count/digest strategy. Do not silently truncate, increase limits without review, or store private exports in GitHub.
- Operational D1 schema must still address tenant/private-environment isolation, provenance authorization, independent immutable original source seals, import transaction lifecycle and retry/resume, backup/restore/reconciliation, archive retention/privacy, SQL concurrency, and any permitted eventual production migration number. **These tables are not added to `migrations/**`.**
- No M04 authenticated actor, M05–M08 stock/ledger/cash-posting kernel, cashier session, public RPC or cross-role finance settlement is implemented here. Original Mohim_ERP source, live GAS deployment and original Sheets stay untouched.
- The parallel M03 #543 sealed-source lookup adapter and M11 shared CI policies are not changed by this PR.

## Recommended owner handoff

1. **M03 integrator** reviews this synthetic schema and decides whether an approved numbered source-archive migration is warranted, including real D1/Workerd immutable-trigger tests and strict private access policy.
2. **M02/M10 owners** obtain explicit authorization for a private original-source export, separately pin original group row counts/digests, define ambiguous source-ID review and gross role/account reconciliation, and approve staging/backup/rollback evidence.
3. **M04 + M03** implement current staff auth-version and permission under one SQL-atomic boundary for every eventual writer; never authorize a write from a read-only source-identity result.
4. **M11** requires full exact-head CI for any new D1 migration, rollback/restore rehearsal and a no-secret preview release gate before an owner-approved production cutover.

**Release verdict:** useful synthetic source-archive immutability foundation, **M03 full-module production acceptance NO-GO**.
