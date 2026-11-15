# M03 — Source ID-counter high-water migration preflight

**Authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `legacy/source/Utils.gs::generateId_` and `legacy/source/Config.gs::ID_PREFIX` / `ID_PAD_LENGTH`. Source `generateId_` uses a document-property counter, scans existing original physical Sheet **ID column** on the first call, chooses the higher counter, and formats the next ID with zero-padding. It explicitly rejects unsafe numeric overflow. Row count alone is not enough after deletions or imports.

## Problem

M03 must replace GAS DocumentProperties and LockService without reusing stale/duplicate document-property sequences. A migration rehearsal needs a **read-only, deterministic floor** calculated from the exported ID column plus recorded source counter. M03 cannot simply issue the next ID from this read because two callers could race, even with an in-process lock; the future allocator requires DB-enforced uniqueness and a single D1 atomic boundary.

## Design

One new pure internal helper `planSourceIdCounterFloor({idKey,prefix,storedCounter,existingIds,padLength})` in `src/modules/source-id-counter-floor.js`.

- `idKey` and its `prefix` are supplied by a trusted source configuration/import harness; **do not accept them from an RPC or use them as SQL identifiers**. This helper never reads D1, creates or reserves an ID, mutates inputs or caches counters across requests.
- Accept absent/empty recorded counters as zero, or a finite nonnegative safe integer (including decimal text). Do **not** silently reset corrupt nonempty values as GAS did; fail-closed import preflight requires human repair.
- Accept only an array of original ID-cell strings. Match the exact case-sensitive `prefix-` source family; ignore IDs for other families. For IDs in the target family, require digits-only suffix, safe integer and no duplicates. Malformed target-family IDs cause a reject/review result rather than silently interpreting `PCAT-000016bad` as sequence 16 (the GAS `parseInt` quirk).
- `floor = max(storedCounter, max existing sequence)`; fail for exhausted safe-integer range. Output `{idKey,prefix,storedCounter,highestExisting,floor,nextPreviewId}` with the original configurable pad length; `nextPreviewId` is a **non-authoritative preview**, not an allocated token and must never be attached to a write.
- Original source parity proven on valid ID snapshots by actually executing the frozen GAS function in a Node VM with fake immutable source rows and document-property value. Strict preflight rejects malformed snapshots even when original code would coerce them.
- Require input validation against unexpected objects, getters, arrays/proxies where feasible; fail closed before processing wrong types. Avoid adding frameworks, identifier-mapping tables, or new SQL migrations.

## Acceptance, release and rollback

Tests: empty sheet, stale counter after deletion, counter ahead of issued rows, two unrelated ID families, multiple source prefixes, leading-zero & width growth, corrupted ID, duplicates, unsafe numeric overflow, invalid counter/key/list and immutability. RED missing export/module in GitHub Foundation; GREEN only one production helper. No `src/db`, auth, RPC, UI, original GAS, SQL, production or remote D1 changes. Existing Workerd/D1 CI is regression-only for this pure helper. Future actual issuance must be a separately approved SQL-atomic, tenant-scoped implementation, including real concurrent D1 tests and source import reconciliation. Rollback: revert this PR.
