# M03 — Isolated private archive SQL on actual local Workerd/D1

**Baseline:** `main@e387a5c483ffd7a180616c0a80b09eb7ac4ffe00`; approved source reference `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **M03 issue:** #22; coordination #456; Workerd test-shard owner: M11 #532.
**No active other PRs at branch creation.** The approved nondeployable schema lives in `docs/schema/m03-private-source-archive.proposed.sql` from merged PR #544. There are no numbered archive migrations and no real business source export.

## Twelve-sentence overview
1. Confirm the approved proposed archive SQL is executable under real **local Workerd/D1**, not only Node's SQLite.
2. Extend the existing required five-case M03 frozen source Workerd test without adding a sixth `test(` case or touching the M11 sharding oracle.
3. Preserve all four original Workerd cases and the existing fifth 1,001-row pagination case exactly as their current prerequisite evidence.
4. Run the new schema experiment only **after** those earlier cases, within the fifth test's final phase, using disposable local D1 archive tables.
5. Drop only the existing two test-only `m03_private_source_*` tables, then apply the unchanged proposed SQL from `docs/schema` to isolated local D1.
6. Seed the frozen 49 source groups in `STAGING` with synthetic original row text, Sheet row identities and independent canonical group digests.
7. Prove the database refuses an early seal when declared rows are not all present, then seal each complete group.
8. Verify that the existing private awaited 49-group readback matches the seeded archive exactly, including original header widths, physical row gaps, prices and IDs.
9. Directly attack post-seal row insert/update/delete, group status/digest changes and duplicate Sheet row identity under real D1; require failure.
10. Never import original GAS/Sheets records, secrets, production DB bindings, external credentials, public RPC or financial mutation.
11. Leave the exact five-case Workerd coverage count unchanged, preserving M11's one-shard/one-spec membership control.
12. Run new exact-head full GitHub checks, inspect the **actual Workerd shard-6 log**, and hand off a separate owner-approved numbered migration proposal only after source evidence and rollback policy.

## Scope
Edit only `tests/integration/m03-frozen-source-readback-workerd.spec.mjs` plus new M03 plan/review docs. **Do not edit `migrations/**`, `src/db/**`, `.github/workflows/**`, `tests/m03-workerd-ci-sharding.test.mjs`, Worker bindings or original source. The on-disk SQL proposal is not promoted to a migration and is not altered.

## Limitations
This is a **synthetic local D1 schema compatibility proof**, not an actual independently reconciled 49-group historical export, source signing, production backup/restore, remote D1 migration, or approval to enable public ERP posting. Full M03/M04/M05–M08/M10/M11 integration remains blocked.