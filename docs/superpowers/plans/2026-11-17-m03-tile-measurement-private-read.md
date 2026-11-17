# M03-0014: private immutable tile measurement read

**Dependency:** M02 migration 0014 PR #439. This branch starts from #439 only to run its SQL; do not merge or retarget ahead of #439's fully green integration. PR #438 separately owns the pure Box/Pcs/Sqft contract. Canonical source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## 12-sentence implementation overview
1. Add a private read-only candidate adapter for tile measurements stored by migration 0014.
2. Reuse the existing M03 product catalog candidate reader, rather than create a second catalog authority.
3. Accept a pinned Product ID and either the active or an explicitly selected positive historical unit revision.
4. Return null when the product or matching tile measurement does not exist, without inventing measurements for legacy products.
5. Read the immutable measurement row through a fixed, parameterized D1 SELECT.
6. Require matching product identity, profile revision, Pcs stock base and exact selected pack conversion.
7. Match the pack factor lexically against a whole safe piece count without converting a decimal through binary REAL.
8. Preserve dimensions, manufacturer coverage, optional evidence and Sqft price override text exactly, including an explicit zero and null.
9. Return historical and inactive configuration for review, but grant no authority to transact with it.
10. Reject inconsistent or incomplete database rows with a fixed redacted NEEDS_REVIEW failure.
11. Prove source isolation, read-only behavior, history, missing rows and bad bindings in SQLite and real local Workerd/D1 tests.
12. Keep public RPC, UI, financial writers, migrations, remote D1 and production deployment unchanged.

## Data contract
Export `readTileMeasurementCandidateD1({DB,productId,revision='current'})` from `src/db/tile-measurement-d1-read.js`. The resolved non-null value is `{catalog,measurement,pricing,evidence,isCurrent}`. `catalog` is the existing M03 DTO; `measurement` uses the pure PR #438 contract's exact field names (with native `boxUnitName`) but does not import or duplicate the pure resolver. `pricing` contains purchase/selling unit and nullable Sqft override texts, `evidence` contains unchanged source and timestamp text. These are candidate snapshots for later separately approved M05/M06/M07 adapters, not posting, manufacturer approval or an authenticated endpoint.

## TDD and review
1. Commit test-only regressions and observe missing adapter RED (locally or CI) before implementation.
2. Write the smallest static-query reader to turn those tests GREEN; no shared M03 reader/kernel change.
3. Add a scoped real D1 workflow, run the Node 22/UTC suite, source verification, frontend build, coverage and local D1 regression.
4. Keep the child PR draft against #439, then retarget to main only after #439 merges; reverify exact-head CI against updated main. Dependency #438 required for future quantity composition, not for this storage-only reader.
5. Do not merge a child with pending checks, bypass the 60-minute parent M03 test, use real production data or deploy.