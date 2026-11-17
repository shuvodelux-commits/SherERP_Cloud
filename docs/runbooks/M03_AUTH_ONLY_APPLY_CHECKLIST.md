# M03 — Protected auth-only D1 migration operator checklist

**Status: PREPARED / NOT AUTHORIZED TO APPLY.** This is the next private staging gate after reviewed #633 and #634. It is not a production cutover or approval to enable login, import staff or execute financial writes.

## Actual private pre-auth staging recovery evidence — 2026-11-18

An authorized **read-only** Cloudflare Wrangler inspection identified operational staging D1 by its exact name/UUID: **shererp-staging-db / aa04618e-1639-4cb9-bdf5-7b967d8b968b**. The database has original migrations 0001_core_catalog.sql and 0002_party_identity.sql, seven existing **empty** application tables, four original Party protection triggers, and zero auth tables. The separate immutable history D1 is **shererp-legacy-history-staging-20261118 / 3328e5c8-7695-4d6c-8bcf-9725437ebdd5**.

On the owner-controlled CachyOS computer, a **private staging SQL export** was created before auth migration. Its SHA-256 is **c677f92ac0d71f7fdfefc8f0988958759635ae012399a8a2477097d6521f971c**, 5,438 bytes. It was restored into an isolated local SQLite instance; PRAGMA integrity_check returned ok, two migrations and four Party triggers were present, and the seven original source tables were intact. The canonical seven-table core-row SHA-256 at capture time was **67a61d9d2b07e4517d0eb13be54c9990ac04051f499749f2c04e89c15e5718d9**. A **Cloudflare Time Travel bookmark** was captured to a private 0600 file; the actual bookmark value and backup are NOT in GitHub. Parent backup directory mode is 0700.

The local export and bookmark are recovery prerequisites, not a production rollback rehearsal. Before any approved remote schema write, M11 still must independently confirm protected environment rules, backup custody, restorable bookmark, exact Cloudflare account and the proposed deployment commit; refresh the recovery point if staging has changed.

## Exact-file plan and local validation

New M03 bundle builder: **scripts/prepare-m03-auth-only-bundle.mjs**. It checks SHA-256 pins on original migration files and writes a freshly created 0700 private directory with **only four SQL files** and a CLI-only Wrangler config binding **only** operational staging D1.

The original root migration directory still contains **14** numbered SQL files. NEVER run root-config remote migration apply against the existing database; it would include ten unrelated migrations beyond the required auth-only pair. The existing .github/workflows/remote-d1-staging.yml remains unchanged and intentionally prevents applying onto nonempty D1. Do not disable its migration-count or empty-schema guards.

Synthetic SQLite tests and a separate actual **Wrangler local D1** rehearsal have passed:

1. Create local D1 with only 0001/0002 applied.
2. Point the four-file isolated CLI config at the **same local persistence** and run Wrangler local migration apply.
3. Wrangler reports **exactly 0003_auth_core.sql** and **0004_auth_source_provenance.sql** as pending/applied; the already recorded 0001/0002 are skipped.
4. Readback shows exactly four ordered D1 migrations, seven preserved core/Party tables, **four preserved Party triggers**, five empty authentication tables, four source provenance columns, and no imported staff/role/credential/session/throttle data.
5. The strict **scripts/check-m03-auth-only-post.mjs** checks the full table list, all 24 expected triggers, all four provenance column names, ordered migration ledger and zero auth records. It rejects extras, missing records, wrong schema and changed-D1 query metadata. This verifier never authorizes remote apply.

## Future independently approved staging-only operator sequence

Only an approved M03/M04 integrator with M11-reviewed recovery controls may execute an actual remote operation. This runbook does NOT itself supply permission.

1. Re-read latest main AGENTS.md and coordination issue #456; ensure no other staging D1 writer or active PR owns this operation. Pin the reviewed release SHA and original source hash.
2. Verify the Cloudflare account ID and both D1 UUIDs using **read-only** Wrangler calls and run the merged M03 preflight checker against fresh list, sqlite_master and d1_migrations readbacks. Refuse any drift from the 0001/0002 baseline or unexpected table, trigger or data changes. Ensure zero remote auth tables.
3. Verify an independently recoverable private D1 export, restore integrity, a **fresh** Time Travel bookmark in private custody, safe operator/reviewer permissions and owner confirmation for the schema-only staging change. Do not upload SQL, bookmarks, passwords or source user rows to a repository, Actions artifact or a public log.
4. Generate a **fresh standalone bundle** under a private temporary directory outside the repository using the pinned bundle builder; check exactly four files and the exact operational UUID in its generated Wrangler config. Validate the local rehearsal and the approved SHA pins again.
5. Only with the separate reviewed and recorded human authorization, issue Wrangler's **remote migrations apply** with the generated config (not the repository's fourteen-file config and not the current protected initial-setup workflow). Wrangler must identify only 0003 and 0004 as pending; **abort** if any other filename appears. Record the protected prewrite bookmark.
6. Immediately re-query the remote schema and ledger using SELECT-only statements, then check the strict post-apply verifier. Export the post-schema D1 privately and compare **every original application row and all four original Party guards** against the pre-apply snapshot. Ensure all auth data tables remain empty immediately after schema-only migration.
7. If unexpected changes occur, **stop**: preserve the logs privately and escalate to the approved recovery operator. Do not run an automatic restore or modify source history. An incorrect D1 recovery can erase later legitimate writes; recovery requires its own approval.
8. After auth schema review passes, M04 independently rehearses the owner-approved **partial** staff import with two source freezes; original historical Owner remains Active, with unmodified source User ID/phone and deferred D1 enrollment until verified mobile correction. Do not misreport this as a complete three-user migration.
9. Public Worker/RPC, staff credential activation, real Administrator login and financial posting require separate M03/M04/M11 integration approval and tests. This PR creates no deployed login path.

**Human review at this gate:** M03 reviews source SQL and initial table preservation. M04 reviews auth/session triggers, exact Administrator source ID and the deferred Owner account. M11 verifies environment protection, operator identity, backup custody and recovery. **No source or private operational records are committed in this PR.**
