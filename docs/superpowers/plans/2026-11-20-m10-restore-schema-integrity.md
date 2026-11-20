# M10 — Synthetic restore schema, constraints and physical-integrity gate

**Issue:** #312 · **Coordination:** #456 · **Draft PR:** #740  
**Canonical baseline:** `main@2536640a9f6e6b6c409486b26e545c501cfa4a6a` after merged PR #736.  
**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Scoped 12-sentence implementation overview
1. The existing M10 synthetic rehearsal verifies record-level continuity across a local SQLite import, replay, backup and restored file.
2. A recovered file can contain all 98 original synthetic records while having lost a uniqueness constraint or another database schema property.
3. This isolated M10 extension adds physical and structural verification to the existing runner without modifying operational SQL.
4. The runner records a baseline SQLite schema and database-version marker from its newly created in-memory synthetic database.
5. Each materialized stage verifies the SQLite integrity check, foreign-key check and actual schema against that baseline.
6. A rollback-only probe checks that a duplicate fabricated source ID in a separate row is rejected by the SQLite unique constraint.
7. An induced backup schema rebuild removes the source-ID uniqueness constraint while retaining every row exactly.
8. An induced restored-file schema rebuild does the same, proving that comparing row values alone would have been insufficient.
9. Additional synthetic faults add an unexpected restored table or change the schema-version marker.
10. Damaged backup and restored SQLite file headers must be rejected with a fixed redacted error that includes no sensitive values or filesystem paths.
11. Tests precede GREEN implementation, then affected and full GitHub exact-head CI and independent QA/review gate the PR.
12. This local SQLite proof remains synthetic preparation and cannot authorize historical source import, Cloudflare D1 writes, production backup restoration or cutover.

## File ownership and limits
- **M10 exclusive:** existing `src/migration/m10-synthetic-sqlite-recovery.js`; new `tests/m10-synthetic-restore-structure.test.mjs`; this plan.
- **Read-only dependency:** `docs/baseline/schema-inventory.json`. No changes to `src/db/**`, shared SQL/migrations, Workerd bindings, `src/rpc/**`, auth, frontend, operational financial code or other active Mxx workstreams.
- No original XLSX, GAS/Sheets, Cloudflare account, local PC, private customer data, network I/O or remote D1.
- Original 49-group source reconciliation, gross Party obligations, historical FIFO/returns, the true D1 schema and real backup custody remain unsatisfied.
- No deployment, SQL migration, RPC, transaction write, cloud secret or CI workflow effect. No impact on original legacy UI.
- Rollback: revert these M10-only changes without any database rollback.
- Merge: after current-head exact PR checks, independent Super QA/Super Review and explicit human approval, never automatic.

## Superpowers RED → GREEN → QA
- **RED**: `286b74b4923c73deb15c75367c578f945310647a` adds eight new tests with as-yet unsupported schema-fault names. Verify the actual GitHub Actions failure separately.
- **GREEN**: smallest possible change to the existing synthetic runner; preserve all prior M10 expected output and 11 previous tests.
- **Acceptance**: (a) clean 49-group local synthetic database remains candidate-only, (b) identical backup/restored record values with missing UNIQUE constraint fail, (c) extra schema or version drift fail, (d) corrupt files fail closed, (e) no source values/paths leak.
- **CI**: `node --test tests/m10-synthetic-sqlite-recovery.test.mjs tests/m10-synthetic-restore-structure.test.mjs`, repository `node --test`, `npm run verify:source` and required exact-head GitHub checks.
