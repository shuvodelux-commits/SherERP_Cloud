# M03 issue #533 — Whole-group source readback pagination, QA evidence and limitations

**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **GitHub main at implementation start:** `319ea3ef688af60069036eb5d67b4d56d52dd2a2`. **M03:** #22; **QA gap:** #533; **M11 CI:** #532.

## Implementation contract

This is a **private, source-shaped D1 readback proof**, not an operational importer or a deployed D1 archive table. The existing `createFrozenSourceReadback(env).readAllSourceGroups()` API returns all **49** exact source-group names, **659** original frozen headers, original text cells, and physical Sheet row numbers, with the original `formatVersion` and immutable source commit.

The adapter retains fixed parameterized `m03_private_source_seals` and `m03_private_source_rows` SQL (tables exist only in isolated test fixtures). It first requires exactly one `SEALED` manifest entry per original group and validates exact header order, SHA-256 group digest, safe counts and original commit. For each group it reads fixed **256-row keyset pages**, constrained by `legacy_sheet_row > cursor`, source commit and group. Missing original Sheet row numbers are legitimate; they are **not renumbered**. Unsafe duplicate/backward values, truncated pages and modified original text fail closed. After consuming exactly the sealed count, one additional bounded SELECT must return no undeclared rows. It re-reads the complete group seal manifest after collecting pages and rejects changed metadata.

The accepted M02 digest is the canonical SHA-256 of `JSON.stringify(['SherERP_M02_offline_source_parity_v1',groupName,originalHeaders,sortedPhysicalRowsAs[SheetRow,cells]])` using original unconverted strings, original source case, exact money/phone/date text and deleted/audit history. No normalization, rounding, cross-role Party linkage or cash-session accounting occurs here.

### Resource and trust controls

| Control | Bound |
|---|---|
| Rows per keyset SELECT | **256** |
| Maximum original rows across all 49 groups | **250,000** |
| Maximum combined serialized original row text | **8 MiB** |
| Maximum reader wall time | **20 seconds** |
| Unexpected source groups, malformed or unsealed data | **reject, fixed redacted error** |
| Missing, extra, reordered or repeated physical rows | **reject** |
| Original source row values | **never logged by reader** |
| Public RPC/import/production activation | **all false** |

An archive above these bounds **remains blocked** and needs a separate owner-reviewed streaming/reconciliation strategy. Do not silently increase memory/time limits or return only the first N rows. Seals are re-read to detect mutation, but without reviewed immutable archive DDL or a consistent D1 snapshot this is **not** a guarantee against a sophisticated simultaneous seal+row rewrite. That is a separate M03 integration/DDL acceptance gate.

## RED→GREEN TDD evidence

- **RED tests commit:** `adc01848db3ed31d29a1720a6d3ebf8089211379`. GitHub `Foundation source checks` workflow **#44072063688** failed the expected two new positive acceptance tests (1,001 and 2,049 source rows); the old reader still capped 1,000 rows. The same RED job reported 2 failing tests out of 3,160.
- **GREEN implementation:** `c3008650d8e8d14024d0827887b0cf89dbabf83f` introduces keyset paging, safe cursor and page-count checks, byte/time bounds and a second seal validation. Follow-on test-only Workerd spec `a36567164efd11e73e1528d89b473bf6853016bf` exercises real local D1's 1,001-row pagination and undeclared trailing row behavior. Additional direct Node byte limit regression: `4ca5cd626933829c711fea329024011afdfe356b`.
- Unit tests check a successfully sealed **1,001**-row group, **2,049** original rows across page boundaries (with physical row gaps), underreported extras, missing second-page row, duplicated/backward returned cursor, changed seal during reading, forged over-budget count, oversized sealed payload, exact original text integrity and fixed private error strings.
- Final exact-head CI and PR-review acceptance are recorded separately; no fabricated pass count. The new standalone `tests/integration/m03-frozen-source-readback-workerd.spec.mjs` does **not** run in the shared six-shard Workerd CI until M11 #532 integrates it; a fully green generic 44-check PR is not that spec's execution evidence.

## Downstream readiness

**M03 #533 completion is scoped to bounded private readback engineering**, not full M03 operation. The 49-group operational archive still needs M03-reviewed, versioned DDL with immutability/pinning and D1 access policy; M02 must provide independently authorized source counts and original group digests; M10 must compare real protected source exports against separately generated actual D1 source-shaped results. Authentic session/actor checks and SQL-atomic sales, purchases, stock/ledger/cash-bank posting with replay/reversal await M03/M04/M05–M08 integration. No remote source/D1 write or data export is authorized by this PR; preserve original GAS/Sheets and all closed-off public Worker interfaces.

**Recommended merge order:** pass current-head full CI and M03 owner review for #537; have M11 wire and run the Workerd spec under #532; only then mark the local Workerd proof completed. Keep production ERP and real migration NO-GO until the independent M10 reconciliation and owner approval.
