# M10 Run 7 — Party identity + gross current/opening joined Workerd D1 gate

**Issue:** #312. **Coordination:** #456. **Draft PR:** #764.  
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`  
**Base:** `main@8aaad241e920fc3ff4df7bd21f3f402b4ad3301d` after verified merge #753.

## Implementation overview (12 sentences)
1. Earlier M10 runs established fabricated 49-group SQLite recovery and three-group real local Workerd/D1 readback.
2. Existing M02 work already independently validates gross account-type checkpoints and immutable Party identity readback, so M10 must not duplicate its monetary calculations or create new posting interfaces.
3. Run 7 composes the existing M02 gross source-only preflight, identity source plan and existing pure M02 identity and gross comparators into one M10 review decision.
4. It first checks source plan validity, Party IDs, original source group/ID linkage and role membership without any D1 connection.
5. It then issues one fixed five-SELECT D1.batch covering Party master, Party roles, source links, current amounts and historical opening amounts.
6. In the existing 0002 Party schema mode, reviewed cross-role approval references are not persisted and the entire M10 gate must remain NO-GO even if all gross amounts match.
7. An explicit local-test-only `approval_ref` extension is exercised solely in ephemeral D1 to prove fully matching synthetic evidence without altering any shared migration file.
8. The tests reject mismatched original IDs, approval/reviewer changes and nonmatching Party role status independently of amounts.
9. They also reject one-paisa drift, switched Vendor payable/receivable amounts, Owner/Lender/Borrower amount reclassification, duplicated/missing checkpoints and historical opening classified as current.
10. A blocked source must not invoke D1, and ambiguous D1 envelopes or driver errors must always fail with a fixed redacted exception.
11. Tests are committed before implementation; the new M10 PR-only GitHub workflow verifies real local Workerd/D1 and the full exact-head CI remains the merge gate.
12. These synthetic tests do not verify genuine 49-group historical data, operational Party financial schema, real human reviewer authority, genuine backup custody or production cutover.

## Exclusive M10 file ownership and review
- New `src/migration/m10-party-gross-local-d1-gate.js` — M10 read-only combination of existing pure M02 comparators, no new accounting engine
- New `tests/integration/m10-party-gross-gate-workerd.spec.mjs` — fabricated masters/transactions, local Workerd schema, 18 integrated cases
- New `.github/workflows/m10-party-gross-local-d1.yml` — PR-only, no secrets, pinned Wrangler 4.161.0. Requires M11 CI-owner review
- This document `docs/superpowers/plans/2026-11-20-m10-party-gross-local-d1.md`
- Read-only `src/party/**`, `tests/fixtures/m02-party-plan-batch.mjs`, `wrangler.m02-plan-test.jsonc`, frozen core migrations
- Zero edits to `src/db/**`, `migrations/**`, `src/rpc/**`, Worker bindings, auth, finance/stock posting, source GAS/Sheets, Cloudflare remote D1 or original UI
- No overlap with M03 #758/#759 or M05 #756 active file reservations. Revert four new files to roll back; no database rollback required

## Superpowers RED → GREEN → QA → Review
- **RED** test-first SHA `3846b3200ad72463e284ea451bb228b2ab82ea19`, pre-RED regex-syntax correction `8903529e7735ea60abac75cd75e0678eadcc37bb`, dedicated CI workflow SHA `bd33af767c4cd54d72ab7b3d06f63795133b8c67`. Tests deliberately import absent M10 module; inspect actual hosted failure before claiming observed RED.
- **GREEN** `0aeb82aae6df80089ae6b7b93f1c10e5d58832e7`, fixed five-query read-only batch with immutable source contract checks and redacted fail-closed output
- **Focused:** `node --test tests/integration/m10-party-gross-gate-workerd.spec.mjs` with real local Workerd/D1; `node --test` and source-freeze checks in Foundation
- **Review:** Verify that the current 0002 Party schema cannot persist cross-role `approval_ref`, that synthetic gross matching alone returns false, that any M10 candidate status never grants import/restore/remote D1 permission, and that arithmetic always delegates to M02
- **Merge:** full exact-head CI, independent /super qa then /super review, M11 workflow-owner approval and explicit human merge approval; leave PR draft until cleared

## Remaining genuine blockers
Full M10 issue #312 remains open and NO-GO. Owner-authorized private source export, independently verified all-49 historical source IDs and rows, operational account DDL/posting, gross per-party source obligations, actual private staging D1 readback, failure/retry/reversal, authenticated review evidence, financial audit, private backup/restore and M11 launch gates remain outstanding.
