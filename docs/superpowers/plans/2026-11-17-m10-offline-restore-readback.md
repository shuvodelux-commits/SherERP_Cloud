# M10-11 — Offline backup/restore readback integrity preflight

**Tracking:** #312; parallel board #456. **Base:** `main@666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`. **Original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Scoped implementation overview (12 sentences)

1. M10 needs a separately reviewable restore-readback proof before the private backup-and-restore drill can be signed.
2. Existing M10-01 compares source against D1 evidence but does not compare an immutable backup capture against the independently captured restored readback.
3. This task adds a pure offline metadata evaluator with no I/O, SQL, network calls or source export.
4. It accepts only the frozen 49-group inventory and synthetic or explicitly authorized externally supplied checksum summaries.
5. Each snapshot must identify its source commit, distinct capture, exact capture timestamp and group summaries.
6. Ordinary groups retain original-source ID digests; legacy LOGS must use source-row position provenance and must never receive a fabricated ID.
7. The evaluator compares exact row counts, row content hashes and source ID or physical-row-position digests for all groups.
8. It rejects missing, extra and duplicated groups, malformed evidence, cross-capture identity swaps and reversed chronology.
9. A separate receipt ties the backup capture to the restored readback and asserts that the drill target is isolated, but the receipt is only supplied evidence, not independently authenticated authority.
10. Result fields expose only fixed diagnostic codes and aggregate counts, never original IDs, amounts, hash values, capture identifiers, or private rows.
11. Tests will be committed first to demonstrate RED, followed by the smallest passing implementation and full GitHub CI, with no relaxation of existing test gates.
12. Even a clean synthetic comparison grants neither a real restore, a private D1 migration, a production import nor M11 cutover approval.

## Owner and impact inventory

- **M10-owned new paths:** `tests/m10-restore-integrity.test.mjs`, `src/migration/m10-restore-integrity.js`, this plan.
- **Read-only references:** `docs/baseline/schema-inventory.json`, `src/migration/m10-rehearsal-gate.js`, `src/migration/m10-source-freeze.js`.
- **No shared edits:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, `wrangler*`, shared IDs/posting kernel, auth, workflows, UI, original GAS and Sheets remain untouched.
- **RPC / SQL / live data:** none. Original byte-level source is neither copied nor transformed.
- **Dependencies:** M10-01/M10-03/M10-10 present on main, M03 owns common DB contracts; real/private data and M11 remain separately gated.
- **Merge order:** this isolated PR targets main after mandatory full exact-head CI and review; no stacked dependencies.
- **Rollback:** revert the new evaluator, dedicated tests and plan; no schema or state rollback required.

## RED → GREEN acceptance

1. RED: new test-first imports missing `src/migration/m10-restore-integrity.js`, verified by GitHub Actions; document exact failure rather than claiming pass.
2. GREEN: positive 49-group synthetic comparator, exact original-ID/LOGS positional proof, receipt chronology and target isolation.
3. Failure paths: missing/extra/duplicate groups; altered count, content, ID/position; forged/non-distinct capture, missing/mismatched receipt, wrong chronology, non-isolated target.
4. Reject accessors/prototype or malformed data with a **fixed redacted error**; never mutate evidence or emit hashes/private values.
5. Results preserve unconditional `authorizesRestore:false`, `authorizesImport:false`, `productionReady:false`; `candidateRestoreParity` never implies a real physical restore was performed.
6. Run focused `node --test tests/m10-restore-integrity.test.mjs`, full `npm test`, source verification and required PR CI; real Workerd/D1 is **not** exercised by this pure comparator.

**Limitations:** Actual backup provenance, independent D1 reads, a private isolated restore rehearsal and sign-off remain absent. Issue #312 cannot be closed based on this PR.
