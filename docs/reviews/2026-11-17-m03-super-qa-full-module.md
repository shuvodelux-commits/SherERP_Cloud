# M03 Super QA — Full Backend/RPC Module Acceptance Review

**Date:** 17 November 2026 • **QA method:** acceptance ledger → adversarial/test-gap check → security/privacy pass → evidence → release disposition, adapted from [Super Board / super-qa](https://erictechpro.github.io/super-board/skill-map/#view=super-qa).
**Repository:** `shuvodelux-commits/SherERP_Cloud` • **reviewed starting main:** `f3c1567a66d4e9df98dc1e8de211bd26c12871b2` • **newer main after review started:** `a0f4d437f809311ec7f1aea7b73d2f4a5022f535`.
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Owners:** M03 #22, global board #456; M04 #252; M10 #312; M11 #306.
**QA execution mode:** GitHub evidence and independent Node/SQLite QA regression PR. The native `super-qa` Claude Code runner/board and bundled `pr-security-review` tool are **not installed in this ChatGPT environment**; this is a documented equivalent manual test-gap/security inspection, not a claim that its automated board agents executed. No production secrets, staging D1, source Sheets or public ERP APIs were exercised.

## Executive verdict

**M03 module: QA FAIL / release BLOCKED.** The FAIL reflects missing production integration and unverified real business-data parity, **not a claim that passing synthetic D1 tests are faulty**. Its current code correctly keeps the public runtime inert. Some internal integration slices are implemented and well tested; missing release acceptance must not be converted to an artificial green result.

**Prior merged CI:** M03 #519 exact Party source row provenance (44/44 successful), #523 private 49-group source-shaped reader (44/44 successful), and #528 strict nested Promise-free trusted RPC response serialization (44/44 successful and merged during this review). Those counts apply to each PR's then-current tested head, not to a full operational migration. Latest QA-only PR CI is independently checked before any merge decision.

## AC-to-test evidence ledger

| Acceptance criterion | Existing unit / Node evidence | Actual local Workerd/D1 / E2E evidence | QA result |
|---|---|---|---|
| 1. Frozen original source exact group/columns | `tests/m03-frozen-source-readback.test.mjs`, `tests/m02-source-fields-import.test.mjs` | Real source export **not** available; 49 groups / 659 frozen headers | **PASS definition-only; BLOCK production** |
| 2. Source Group + ID + original row Party identity | `tests/m03-party-provenance-read.test.mjs` | `tests/integration/m03-workerd-core.spec.mjs` via #519 | **PASS synthetic** |
| 3. Never merge Party by name/phone or net roles | `tests/m03-party-provenance-read.test.mjs`, M02/M08 gross-account tests | Local D1 Party link constraints; no real gross account reconciliation | **PASS negative link proof; BLOCK financial GO** |
| 4. Full source archive row, count, header, digest fidelity | `tests/m03-frozen-source-readback.test.mjs` | Separate `tests/integration/m03-frozen-source-readback-workerd.spec.mjs` exists but is **not selected in required CI** | **HIGH test gap #532** |
| 5. Original text formats, dates, signed money, phone and deletion history | M02 exact-text parity and M03 readback tests | Only synthetic source snapshots, not actual historical D1 | **PARTIAL** |
| 6. Complete source archive for large original groups | New QA test `Super QA: ... sealed 1001-row ...` proves bounded reader rejects | No paginated whole-group D1 readback; 1,000-row cap | **HIGH release gap #533** |
| 7. Protected D1 errors and malicious result columns/getters | New QA tests for extra private D1 column/getter plus existing malformed reply tests | No browser/public API needed; no sensitive echo permitted | **TESTS ADDED; exact-head CI pending** |
| 8. Complete source-to-D1 operational schema | `tests/m02-m03-migration-coverage.test.mjs` tracks partial DDL | 14 versioned `migrations/*.sql`; `m03_private_source_*` tables are synthetic fixtures, not versioned tables | **BLOCKED** |
| 9. All affected legacy Database.gs async closure | `tests/m03-async-closure.test.mjs`, `tests/m03-transitive-async-graph.test.mjs` | Audit enumerates **394 impacted functions out of 614**, not verified converted endpoint count | **BLOCKED** |
| 10. Nested Promise cannot be serialized to `{}` as successful RPC | `tests/m03-rpc-awaited-response-boundary.test.mjs` (merged PR #528) | `tests/integration/m03-daybook-http-workerd.spec.mjs` | **PASS private bridge proof** |
| 11. Public RPC allowlist and authentication fail closed | `tests/m03-rpc-executable.test.mjs`, `tests/m03-runtime-policy.test.mjs` | `src/index.js` calls `handleRpc(request)` with no private bridge, `rpcRegistry` is empty | **PASS safety / BLOCK enabled ERP** |
| 12. Trusted server actor, live revocation, permissions in same SQL mutation | M03/M04 synthetic authority tests | Local Workerd/D1 proofs exist, no accepted fully integrated production mutation path | **BLOCKED** |
| 13. Source-ID, stock/lot, Party gross accounts and journal in one SQL-atomic mutation | `tests/m03-exactly-one-batch.test.mjs`, `tests/m03-authorized-post.test.mjs` | Synthetic D1 transaction proofs, not reviewed complete M05–M08 source transaction kernel | **BLOCKED** |
| 14. Replay, concurrent submit, lost acknowledgement and exactly-once reversal | `tests/m03-operation-receipt-reconcile.test.mjs`, `tests/m03-reversal-contract.test.mjs` | Synthetic Workerd proofs only; source-faithful multi-unit + Cash/Bank workflow not certified | **BLOCKED** |
| 15. Source-shaped original `serverCall` compatibility | `tests/m03-rpc-readiness.test.mjs` and related adapted API tests | No comprehensive authenticated E2E all-source-handler parity | **BLOCKED** |
| 16. Migration of all real customer/supplier/vendor/finance/stock data | M02 offline evidence (49 source definitions, 62 source-ID reference rules) | **0/49 real original groups certified imported and independently reconciled** | **HIGH external release gate** |
| 17. Secure source migration, backups and rollback | M10 offline evidence packet/guards | Owner-approved full private export, independent D1 readback, backup/restore and accountant GO not evidenced | **BLOCKED (M10/M11)** |
| 18. Full exact-head CI and branch owner review | 44-check GitHub Actions matrix per PR, isolated Workerd shards and Chromium | #519/#523/#528 merged green; latest QA-only PR requires its own 44-check proof | **PARTIAL / follow-up** |

## Confirmed Super QA findings (independent tickets)

**HIGH — [#532](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/532): new frozen-source Workerd spec missing from required M03 CI.** Reproduce by comparing `tests/integration/m03-frozen-source-readback-workerd.spec.mjs` with the six-shard matrix in `.github/workflows/m03-d1-workerd.yml`. No direct code defect is alleged. Owner: M11 CI integrator; requires explicit Workerd execution and updated coverage oracle.

**HIGH — [#533](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/533): readback cannot handle a correctly sealed group with 1,001 source rows.** `MAX_GROUP_ROWS=1000` deliberately rejects it; QA test records this safe NO-GO. Expected future private, bounded, integrity-preserving paginated readback and independently checked whole-group hash. Owner: M03 integrator; never silently raise the cap or return partial data.

**HIGH pre-existing gates — #22/#456/#312:** no approved full operational schema, no production-level actor+receipt+stock+ledger atomic integration, no original source→D1 49-group independent data parity, no authorized rollback/cutover. These are existing blockers, not duplicate defect tickets.

## Adversarial/security review and test-the-tests notes

- **PASS scoped privacy inspection:** `src/index.js` does not connect public Worker RPC to private D1; `rpcRegistry` stays empty. The new QA fault injections intentionally use synthetic strings, and require fixed redacted failures with zero private values in error messages. Actual private data was not accessed.
- **PASS current Node negative-path code:** `src/db/m03-frozen-source-readback.js` validates fixed source commit, all source groups, exact headers, sealed counts, physical row order and original-value SHA-256 digest; bad inputs fail closed. The QA tests seek to kill mutations such as dropping an extra-column guard or executing a `cells_json` getter.
- **HIGH missing verification:** the standalone Workerd spec is not executed by the required CI, so a runtime-specific crypto/D1 mismatch could survive a green full-workflow count. File #532 must be closed with real run evidence.
- **HIGH missing integration:** `m03_private_source_*` fixture schema and row limit are not a versioned, production-approved importer. A source-vs-candidate comparison using identical synthetic JSON copies never proves historical business data moved.
- **Security-review limitation:** an official Super Board `pr-security-review` skill invocation was unavailable. This audit included manual scope and trust-boundary inspection only; do not claim automated SAST, dependency audit, dynamic penetration testing, credentialed user journey, or proof of compliance.
- **Test isolation:** all QA-only code edits are M03-owned tests/docs. No M04–M11, `src/db`, `migrations`, shared `src/rpc`, Worker config, `.github/workflows` or original source changes.

## Exit criteria and handoff

M03 cannot leave QA FAIL until reviewed M03 operational D1 source storage/readback supports original source size and proven pagination; M11 executes all owned Workerd suites including #532; every source-dependent original endpoint relevant to the MVP is proven awaited; M04 actor/permission checks are SQL-atomic with M05–M08 stock/Party/Bank/Cash/returns posting and replay; M10 independently verifies actual 49/49 source counts/identities/hashes and gross accounts plus source stock FIFO/returns and private backup/restore; and M11 records written owner release GO.

**Next QA re-run:** after M11 CI issue #532 and M03 pagination issue #533 are fixed, repeat the exact current-head Node tests, real Workerd D1 tests, current authenticated RPC tests, historical source-vs-D1 private rehearsal and complete critical money-flow E2E acceptance. No production traffic or remote writes were initiated by this QA run.
