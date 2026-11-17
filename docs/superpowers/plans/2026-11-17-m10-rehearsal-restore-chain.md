# M10-12 — Cross-gate source→D1→backup→restore evidence continuity

**Workstream:** M10. **Issue:** #312. **Coordination:** #456. **Starting main:** `d3cef4a21e685f356c09ecde59a0663d0dc896cb` (includes merged M10-11 #466). **Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Scoped implementation overview (12 sentences)

1. M10-01 can compare supplied frozen source summaries to a supplied D1 readback, and M10-11 can separately compare supplied backup and restored-readback summaries.
2. Neither gate currently proves that the D1 candidate checked before backup is the same captured state as the backup independently checked during the restoration rehearsal.
3. M10-12 adds a pure offline chain preflight without introducing a new SQL writer, importer, endpoint, workflow or backup mechanism.
4. It composes the existing two M10 read-only evaluators and refuses to treat either as production authorization.
5. It accepts only an M10-01 rehearsal evidence object and an M10-11 restore evidence object, both tied to the same frozen inventory.
6. When both prerequisite gates are positive, it independently checks each D1 readback group against the backup capture's row count, row hash and original ID or LOGS physical-position digest.
7. It requires that the backup capture is later than the last supplied source-freeze pass.
8. A missing prerequisite, partial evidence, unmatched original identifier, altered row, out-of-sequence backup or missing LOGS positional link fails closed.
9. All new messages use fixed diagnostic codes and counts; no source IDs, financial amounts, capture IDs, raw digest strings or sensitive exceptions appear.
10. Ten or more synthetic Node tests will be committed first and observed failing before the small implementation is added.
11. Exact-head GitHub CI and any affected Workerd/D1 suites are mandatory prior to merging the isolated PR into main.
12. Even an entirely matching supplied chain is not proof of independent export authenticity, a real private restore, staging D1 reconciliation or authorization to cut over production.

## File ownership and dependency inventory

- **M10 exclusive new files:** `src/migration/m10-rehearsal-restore-chain.js`; `tests/m10-rehearsal-restore-chain.test.mjs`; this plan.
- **Read-only existing M10 contracts:** `src/migration/m10-rehearsal-gate.js`, `src/migration/m10-restore-integrity.js`; frozen `docs/baseline/schema-inventory.json`.
- **No shared changes:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, Worker bindings, auth, stock/financial posting, original GAS/Sheets, frontend, workflow definitions and cloud services unchanged.
- **No RPC/table impact or original-source transformation.** No production/staging D1 import, private export or remote database write.
- **Dependency:** #466 merged on main, existing M10-01 and source-freeze contracts already on main; issue #312 remains open, board #456 reserves all shared files to M03.
- **Merge sequencing:** one independent M10 PR against main, complete exact-head CI, review and conflict check, then merge; no stacked feature branch.
- **Rollback:** revert these three isolated files; no DB/data rollback.

## TDD acceptance and evidence

1. RED tests import absent pure M10-12 helper from a new test file; show expected missing-module failure in GitHub Actions where available, or explicitly distinguish local/in-tool RED from verified GitHub RED.
2. Synthetic positive all 49 groups → only candidate chain parity, never import/restore/production authorization.
3. Synthetic independent-green but mutually disconnected D1 and backup groups → fail closed on row count, content digest, ID digest and LOGS physical-row position.
4. Reject reversed backup chronology, missing/blocked M10-01/M10-11 reports, non-original source pin and malformed/malicious evidence with redacted errors.
5. Report no identifiers, amounts, source rows or raw hashes. Do not mutate inputs. Deterministic issue ordering.
6. Verify source pin and full `npm test`, `npm run verify:source`, frontend build and exact-head GitHub CI. No claim of real Workerd/D1 integration from this pure helper.

**Release status:** Always `authorizesImport:false`, `authorizesRestore:false`, `productionReady:false`. M10 #312 and M11 remain NO-GO.
