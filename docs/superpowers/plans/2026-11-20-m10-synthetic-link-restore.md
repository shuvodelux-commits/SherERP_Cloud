# M10 Run 5 — Tenant-scoped synthetic reference recovery

**Issue:** #312 · **Coordination:** #456 · **PR:** #746 · **Base:** `main@fb56703fd41a942ca6adfae19af324eaab0ab66c` · **Original source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Implementation overview (12 sentences)
1. M10 Run 3 and Run 4 have already been merged and validate record-level and schema-level continuity across synthetic local SQLite backup and restoration.
2. Their 49-group-shaped fixture does not have relational links, making its foreign-key check vacuous.
3. Run 5 adds a separate M10-only, synthetic cross-group reference graph rather than changing the existing M10 runner or M03's actual D1 schema.
4. It uses nine group names that exist in the frozen 49-group inventory, representing a small illustrative Supplier/Purchase/Stock Lot and Customer/Sale/Sale Item/Return chain.
5. Two fabricated Shop IDs deliberately reuse the same fabricated source IDs, so a wrong tenant scope cannot be silently accepted.
6. Composite SQLite foreign keys enforce the parent/child identity scope and a CHECK constraint explicitly rejects cross-Shop parent links.
7. The database performs a real SQLite backup and restores a separate local file, with independent node and edge readback on each stage.
8. A rollback-only savepoint checks that a missing-parent insert is rejected at SQL time, not merely by JavaScript.
9. Controlled faults cover orphan parent/child, original ID drift, wrong but existing parent, cross-Shop substitution, retired parent and backup propagation.
10. Additional faults disable foreign-key enforcement or remove foreign-key definitions while all record counts and values remain present.
11. The 13 committed-first tests require deterministic, redacted diagnostic codes with no raw IDs, database paths or source values, and full exact-head GitHub CI plus independent review gates merge.
12. This is strictly synthetic local SQLite evidence: it does not prove the actual historical 49 groups, the operational D1 schema, original account balances, backup custody or a production go/no-go.

## Exact ownership
- **New M10-only files:** `src/migration/m10-synthetic-link-restore.js`, `tests/m10-synthetic-link-restore.test.mjs`, this plan.
- **Read-only input:** `docs/baseline/schema-inventory.json`.
- **No changes:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, D1 bindings, migrations, M02 importers, M03 financial SQL, M04 auth, M05–M09 modules, existing M10 tests, UI, original GAS/Sheets, workflows or external data.
- **Runtime:** Node >=22 with built-in `node:sqlite`. The disposable database and two local SQLite files are always cleaned in `finally`. No network, credentials, remote D1 or production data.

## RED → GREEN → QA → Review
- **RED:** `88c0e641684dda9e72785b81969ad5c453dc0206` introduced 13 Node tests importing a deliberately absent M10-only helper; review GitHub Actions for executed RED evidence. Do not characterize unrelated workflow failures as proof of RED.
- **GREEN:** `bb3cbbfc9e788c86b0086ce357af2cae6b4aa97e` added a minimal fabricated local SQLite FK/CHECK graph, real backup/restore and independent comparison against immutable expected synthetic nodes and links.
- **Focused QA:** `node --test tests/m10-synthetic-link-restore.test.mjs`; **repository QA:** `node --test`, `npm run verify:source`, and all exact-head PR required checks.
- **Review:** confirm explicit Shop-scoped source IDs and no mistaken auto-merge; actual relational corruption detected at unchanged counts; no data leak; no external I/O; SQL probe always rolled back; failures cannot produce a production-ready flag.
- **Merge gate:** draft until exact-head CI passes, independent QA/review, no conflicts or shared-file collisions, then explicit human approval. Rollback: revert three M10-only files; no data rollback.
