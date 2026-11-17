# M03 Run 5 — private D1 source-ID/counter evidence reconciliation

**Status: internal, read-only, nondeployable proof; NOT production M03 acceptance.**
M03 single shared-D1 owner #22, coordination #456; source evidence M02 #575/#591, M10 #312; original source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Contract

`createM03PrivateIdEvidenceReconciler({DB}).reconcile_({idEvidence,freezeManifest})` reads **all 49 sealed frozen-source groups** via M03's keyset, count and SHA-256-verified real local D1 readback. It then compares every M02 generated-ID family by exact original physical sheet row and ID text, including deleted rows, against independently supplied private M02 Run 4/5/6 ID evidence. All 38 source-pinned prefixes and original counters must match the private M02 salted row/counter commitments and root digest. The remaining 11 nonsequential groups still pass the full source archive seal, with **no invented ID family**.

Input is trusted offline/test-only evidence, **not** caller-authorized RPC, a public signature, or independently attested real Google Sheets custody. The real source values, historical IDs, DocumentProperties counters, salt and private row digest are processed only in memory and never logged, returned or placed in GitHub. If anything mismatches, throw the single redacted `M03 private original ID evidence rejected` error. A success response exposes only counts, consistency state, and explicit **false** release flags.

The verifier **does not** install original floors into an operational counter table, issue any ID, grant staff rights or run an SQL transaction writer. It has **no** source data write, public HTTP/RPC route, production D1 binding, schema migration, Cloudflare secret, Party-account netting or Cash Session side effect. `localD1ArchiveMatchesSuppliedIdFreeze:true` means only that the supplied *private* freeze matches the *local* D1 archive; it is not `sourceToD1Reconciled` or `independentSourceCaptureVerified`.

## Evidence and acceptance

- RED before implementation: commit `db31ee8ce82297b17b458bbbf22701121655ec84`; GitHub Workerd job `134190702766` in workflow `44126243873` reported missing `src/db/m03-private-id-evidence-reconcile.js` with 3,396 passed and one expected failing Node test file.
- GREEN: `tests/m03-frozen-source-readback.test.mjs` tests sealed 49/38 valid D1 evidence; valid independently re-frozen but *different* source ID evidence; changed counter; omitted historical/deleted ID; forged root; duplicate; missing/extra authority fields; malformed archived cell; no raw-data leaks or writes.
- Real Workerd/D1: the **existing five-case** `tests/integration/m03-frozen-source-readback-workerd.spec.mjs` now also exercises a separately M02-salted, canonical-ID 38-family archive and counter mutation negative tests inside the existing final case, preserving M11's full-shard membership count. No new or unsharded Workerd spec.
- Required before merge: full exact-head GitHub CI, same-secret-free preview safety, independent QA and reviewer, and #594 governance safeguards. Revert this PR to undo the private contract; no production data is changed.

## Remaining gates (unchanged)

M02/M10 owner-authorized **real** Sheets source and DocumentProperties acquisition, independent 49/49 original source→operational D1 parity with actual data, original gross Party/ledger/FIFO and source ID floor installation, tenant-scoped M04 SQL-current actor authority on **every** mutation, single SQL-atomic ID+stock+money journal kernel, replay/reversal/Cash Session, and M11 backup/cutover/roll-back approval remain BLOCKED. Public `src/rpc/registry.js` stays empty, production Worker stays D1-unbound, and `docs/M03_PARALLEL_READINESS.md` must not be changed to READY from this proof.
