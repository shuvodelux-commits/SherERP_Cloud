# M03 — Proposed v0015 private archive security and tenant-scope review

**Baseline:** `main@40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`; source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; M03 issue #22 and board #456. **Branch:** `m03/source-archive-v0015-security-design-20261117`. **Work class:** nondeployable review-only source archive DDL + RED→GREEN synthetic SQLite tests, no production code.

## Thirteen-sentence implementation overview
1. Carry forward the 49 source groups and 659 frozen original headers without changing the original Sheets or GAS deployment.
2. Treat the merged private archive as a tested single-snapshot proof, **not** a reusable tenant-scoped production schema.
3. Design a separate candidate v0015 archive with a trusted tenant identifier and a distinct opaque import-batch identifier on every manifest, group, and row.
4. Reject cross-tenant or cross-batch foreign-key links, duplicate physical source rows, fabricated source groups, and unpinned source commits in SQL.
5. Require every new batch and group to begin STAGING before any original rows can be inserted.
6. Bind 49 independently declared group manifests to a batch before sealing, and require all 49 groups to be SEALED before sealing the batch.
7. Require an exact staged row count for each group inside its final SQL write transaction.
8. Forbid group, row, and batch modifications after their seal and guard against `INSERT OR REPLACE` bypass.
9. Store original cell strings as JSON arrays without rounding amounts, normalizing phone numbers, rewriting identifiers, merging Party roles, or discarding deletion/audit history.
10. Keep source digest and external evidence references separately attested by M02/M10; database checks alone do not establish that a source export is authentic.
11. Prove the candidate SQL in local Node SQLite using test-first failures for tenant scope, batch counts, immutability, duplicate source rows, and failed transaction rollback.
12. Threat-model credentials, `SETTINGS`, `USERS`, `SESSIONS`, private export storage and D1 preview bindings, and require an M11 privacy/backup/rollback gate before any real source import.
13. Leave `migrations/**`, `src/db/**`, `src/rpc/**`, Worker bindings and all other M01–M11 ownership lanes untouched until a separate versioned migration approval.

## Reserved file paths
- `docs/schema/m03-archive-v0015.review.sql` — **REVIEW ONLY, NOT UNDER migrations/**
- `tests/m03-archive-v0015-security.test.mjs` — independent Node SQLite tests, synthetic values
- `docs/reviews/2026-11-17-m03-archive-v0015-security-review.md` — threat model, M02/M10/M11 handoff, release NO-GO
- `docs/superpowers/plans/2026-11-17-m03-archive-v0015-security-design.md` — this execution plan

## Mandatory exit gates
A green test suite for this candidate is not permission to create a real remote D1 table, import any business data, register public RPC, commit source secrets to GitHub, mark 49/49 groups reconciled, or enable financial posting. The M03 integrator must obtain a reviewed schema interface, M02 source manifest identity evidence, M10 independently verified original source counts/hashes and owner-approved private backup/restore, and M11 Workerd/shard/deploy review before the actual numbered migration is even submitted.
