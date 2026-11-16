# M10-02 — Source-shaped catalog digest / real local D1 parity (design)

**Original source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Prior M10:** merged PR #311, issue #312. Applicable repository rules: `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md` and ADR-007.

## Problem
M10-01 accepts externally supplied 64-character digests without independently generating them from source/D1 readbacks; identical fabricated digests cannot prove any imported rows. Before a private full-data rehearsal, pin deterministic source-shaped serialization and verify the first safe persisted slice against a **real isolated Workerd/D1 instance**.

## Scope
Only the two already-reviewed, nonfinancial catalog masters: `PRODUCT_CATEGORIES` and `PRODUCT_UNITS`. A pure offline function `summarizeM10Catalog({inventory,sheetKey,rows})` accepts original `Config.gs` source-shaped rows, validates exact columns and sequential original physical `_rowIndex` values through existing M02 source import preflights, and returns exactly `{sheetKey,rowCount,rowDigest,idDigest}` compatible with M10-01.

Digest v1 contract: SHA-256 lower-case hex over domain-separated JSON arrays. Full-row digest includes group, original source row positions, and all original column values in frozen column order. ID digest separately includes original source ID together with source physical row position; names/phones never constitute identity. Preserve exact Unicode, strings, leading zeros and empty values; only the original M02 importer normalization of valid Date objects to UTC ISO applies. Do not sort away source physical row order, normalize text, coerce malformed payloads, choose new IDs, or return any raw data.

## Evidence
- Unit tests: identical snapshots produce identical digests regardless of JavaScript key insertion order; one-character value drift, source-ID drift, duplicate IDs, omitted/moved physical rows and unsupported columns are rejected or change the expected digest; no data mutation and redacted errors.
- Workerd/D1 test: import synthetic source Category and Unit snapshots using the **existing** atomic M02 importer into actual local isolated D1, independently read persisted source-shaped rows using the existing async M03 repository, and compare *computed* source/readback digests. A direct SQL mutation of the persisted name must break full-row parity but preserve the original-ID digest.
- No new SQL, Worker/RPC route, public D1 binding, remote migration, secrets, private live export, financial posting or cross-role settlement. The checker does not claim any 49-group coverage or production approval; M10-01 remains fail-closed with the existing actual coverage report.

## Approaches considered
1. **Selected:** reuse existing reviewed source-row validator and Workerd/D1 reader; compute digest only on the two source-backed masters.
2. Build a generic 49-group canonicalizer now — unsafe because 38 groups have no source→D1 schema and composite/financial identities require reviewed contracts.
3. Keep external hashes only — cannot detect fabrication, serialization or readback divergence.

## Approval boundary
This is an isolated synthetic test slice, not owner approval to export Sheets, create private staging snapshots, run actual production imports, or cut over to M11. Rollback: revert M10-02 PR only. Owner reviews PR and CI before merging.
