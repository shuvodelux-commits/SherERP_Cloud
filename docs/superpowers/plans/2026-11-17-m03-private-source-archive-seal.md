# M03 — Private source-archive seal integrity, isolated SQL review (RED→GREEN)

**Current main:** `a4e763feea7de9d93440192084d180e1ad6ddc95`. **Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Single integrator / coordination:** M03 #22 and board #456. **Concurrent M03 #543:** exclusive edits to `src/db/m03-sealed-source-lookup.js`, `tests/m03-sealed-source-lookup.test.mjs`, and `tests/integration/m03-frozen-source-readback-workerd.spec.mjs`; do not touch these. **M11:** owns shared CI issue #532 and test sharding.

## Thirteen-sentence implementation overview
1. Create an **isolated, proposed** SQL archive schema that matches the private 49-group/659-header readback contract without adding it to numbered Cloudflare D1 migrations.
2. Require pinned source commit and allowlisted source group names, strict original physical row numbers, original unconverted cell JSON text, and unique source group+row provenance.
3. Require each group to enter as STAGING, never as an already sealed group created by an importer.
4. Reject inserting archived rows unless the matching source group remains STAGING.
5. Forbid row changes after sealing, while preserving an explicit staging-only replacement/restart mechanism before sealing.
6. Forbid replacing source commit or source group identity and rewriting already sealed group headers, counts, digests, or statuses.
7. Permit a STAGING→SEALED transition only when the SQL row count matches the declared count under the same frozen source and group.
8. Retain the existing M02 canonical SHA-256 digest validation in the **separate readback adapter**; SQLite cannot independently attest that the source data was genuine.
9. Fail closed on malformed JSON, duplicate physical rows, orphan rows, invalid source identifiers, and illegal status changes.
10. Test the SQL proposal against real Node SQLite including transactional failures and against the existing M03 private 49-group readback with synthetic exact original-text values.
11. Add negative tests for mutation after seal, cross-group spoofing, counted-but-corrupt data, and mutation through alternate SQLite statements.
12. Preserve all original GAS/Sheets data untouched and do not enable any public RPC, financial writer, production D1 database binding or private business export.
13. Run exact-head full GitHub CI, report what is and is not proven, and request separate M02/M03/M10 approval before any **future** numbered D1 archive migration.

## Reserved owned files
- `docs/schema/m03-private-source-archive.proposed.sql` (NOT under `migrations/**`)
- `tests/m03-private-source-archive-proposal.test.mjs`
- `docs/reviews/2026-11-17-m03-source-archive-seal-handoff.md`
- this plan

**Explicitly untouched:** active PR #543 files, `migrations/**`, `src/db/**`, `src/rpc/**`, public Worker, source GAS/Sheets, CI workflows, M11 sharding tests, M04 auth and any finance path. Tested archive is local-only and not independently certified source-to-D1 data.

## Exit gates
A green synthetic proposal does **not** finish the production archive: M03 review needed for typed operational mapping and audit immutability; M02/M10 must provide independently verified source counts/digests and explicit private-data approval; M11 must prove real Workerd/D1 and safe rollback/backup before cutover. Production GO remains blocked.