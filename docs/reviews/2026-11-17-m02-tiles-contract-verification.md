# M02 tiles contract — verification checkpoint

This completes the scoped pure quantity/pricing and catalog-composition slice
of PR #438. M02, tiles measurement persistence, all-group importer, financial
posting and M05/M06/M07/M09 production workflows remain incomplete.

## Observed RED and root cause

Original remote head `8c51f57978ac7122cb441e4398a31efbe5dfb639` had 11 failing
GitHub check jobs. Every failed job log was inspected: each reported exactly
one failing test module, `m02-tile-quantity-contract.test.mjs`, because the
planned production module did not exist (`ERR_MODULE_NOT_FOUND`).
[Foundation RED run](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/43993110775).
The same missing-module failure was reproduced locally before implementation.

The initial 23 behavioral tests then passed. A second test-first cycle exposed
two real boundary defects: coerced dimension-unit objects/arrays were accepted,
and very large generated coverage was incorrectly reparsed through the bounded
user-input decimal parser. Both tests failed before the two-line fix, then all
25 passed. A third RED cycle required the missing catalog-bound export in unit
and real D1 tests before its implementation; final unit count is 27.

## GREEN evidence

- CI-equivalent Node **22.23.5**, `TZ=UTC`, full `node --test`: **2,473 passed,
  zero failures, zero skips**. Local main includes the three previously missing
  main commits, merged without conflicts.
- Tiles unit contract: **27/27 passed**.
- `tests/integration/m02-tile-catalog-workerd.spec.mjs`: **3/3 actual local
  Workerd/D1 tests passed**. Supplied synthetic measurements bind to existing
  catalog revisions; 25-piece history remains 25 when current pack is 24;
  mismatched revision/factor is refused; Worker HTTP stays 404.
- Existing `m02-product-catalog-workerd.spec.mjs`: **5/5 actual local D1 tests
  passed**, including late batch rollback and immutable revision checks.
- `npm run verify:source`: **84 original files verified**.
- `npm run build:frontend`: **36 includes assembled**, existing patches applied.
- `node scripts/audit-migration-coverage.mjs --check`: **49 source groups,
  zero fully reconciled**; no coverage promotion or numbered migration change.
- Independent read-only review found no concrete correctness defects and
  independently reran the 27 unit tests successfully.

The new D1 composition test runs in the existing product-catalog CI job.
Exact-head GitHub checks after publishing the implementation must still be
observed before claiming hosted CI fully green or owner review/merge readiness.

## Environment distinctions and limits

An initial Node 24 run on an Asia/Dhaka host exposed existing oracle timezone
assumptions; a UTC rerun removed nine unrelated phone-history mismatches. One
existing invoice regression test assumes TAP child output, while Node 24
defaults to a different reporter. Explicit TAP resolved that mismatch. No
unrelated business module or test was changed; final verification uses CI's
Node 22/UTC runtime and passes the complete suite.

Local Workerd warned that optional Request.cf metadata could not be fetched
and used a placeholder. D1 migrations, reads, constraints and test assertions
executed against the local runtime and passed; no remote D1 was used.

Measurements are explicitly supplied synthetic evidence in the D1 tests;
there is still no tile measurement table, inventory writer, transaction
posting, return/refund or print integration in this PR. Financial/Party
account policy, measurement schema review, revision sealing, all 49-group
imports and actual private-data reconciliation retain their existing gates.

## Latest-main revalidation

The repository advanced while the implementation was being reviewed. Main
`c73c333c51ea0e90e8fac73c63efb4e906c43d54` was merged without conflicts and
the full CI-equivalent Node 22/UTC suite passed again: **2,525 tests, zero
failures, zero skips**. This supersedes the earlier 2,473-test baseline above.
The source/helper tree published through GitHub was checked against the local
tested Git tree; hashes matched exactly before this latest main refresh.
Final hosted CI is checked separately on the published refreshed head.
