# M03 private 49-group D1 source archive readback proof and integration boundary

**Date:** 2026-11-17. **Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Main:** `5ac51572cc3220480cd00841230f07df1c56d924`. **M03 ownership:** issue #22. **Coordination:** #456. **M02:** completed source review PRs #493/#505/#515/#517. **M10:** issue #312.

## What this code proves

`src/db/m03-frozen-source-headers.js` is a static snapshot of the frozen **49 original groups and 659 original column labels**. It is not an operational SQLite schema. `src/db/m03-frozen-source-readback.js` is a fully awaited, fixed-SQL, **private** interface for a future source-row archive with exactly two proposed local-only table shapes:
- `m03_private_source_seals(source_commit,source_group,headers_json,expected_rows,source_digest,status)` — one `SEALED` group evidence row per original group.
- `m03_private_source_rows(source_commit,source_group,legacy_sheet_row,cells_json)` — exact historical text cells plus true physical sheet row.

The two tables are created **only in synthetic Node SQLite / local Workerd D1 tests** and do not exist in shared versioned `migrations/**`. No code in the deployed Worker connects this private reader to HTTP/RPC. The reader refuses a missing table or binding, unsealed/extra/missing group, unreviewed source commit, header order changes, unsafe positions, inconsistent counts, malformed cell arrays and changed original-value SHA-256 digest. Its canonical group digest is exactly M02's `SherERP_M02_offline_source_parity_v1` with group name, original headers and sorted `[sheetRow,cells]` pairs. It does not round money, parse dates, normalize Bangladesh phone numbers, change source IDs, delete historical rows or auto-merge Parties.

## Private test command

```bash
node --test tests/m03-frozen-source-readback.test.mjs
# Local Workerd with Wrangler 4.161.0 installed, run ONLY on a
# nondeployable D1 fixture; M11 owns addition to shared PR CI shards:
node --test tests/integration/m03-frozen-source-readback-workerd.spec.mjs
```

The repository's existing full `npm test` and M03 shared CI run the new Node tests. The separately authored Workerd spec is **not yet wired into an existing six-shard workflow**, because `.github/workflows` and the shared shard runner are M11-reviewed paths. Do not claim this new spec passed Workerd CI until the owner enables and executes it. Existing M03 Workerd suite will still validate the other integrated code.

## Why this is a proposal, not completed real D1 migration

- No versioned migration creates the proposed archive tables. M03 must review schema/indices/immutability/row-limit strategy and decide how large authorized exports are staged and atomically sealed. This bounded readback intentionally fails if a group has over 1,000 records; a future source-paginated/streaming adapter is needed for large shops, and must not bypass M02 sealed whole-group fingerprints.
- The only populated data in the tests are **synthetic**. No production source Sheets export or private customer data were accessed, authorized, committed or imported. The `SEALED` test state means a technical archive group is complete, not a human approval or production release. It must not be fabricated from the candidate or treated as an independently approved original count.
- M02 reviewed group proposals still leave **30 without source-specific operational DDL** and **19 with partial schema only**. The original **394 async-impacted GAS functions** need verified awaited source closure, alongside source-faithful API behaviors.
- M03 and M04 still need a common authenticated, revocable staff actor and DB-enforced atomic posting/replay/reversal/cash-session kernel. M05–M08 must confirm historical stock/finance parity with M03 before operational activation.
- M10 needs an independently **authorized private 49/49 original source export**, a **separately generated actual D1 source-shaped readback**, original source-row and hash parity, source-ID/Party human review, gross separate accounts, FIFO lots, rollback and backup/restore proof. To date, **0/49 original business-data groups are independently certified reconciled to real D1**.
- No public HTTP route, source-write capability, Cash/Bank posting, live identity permission or production staging/cutover is unlocked by this contract.

## Specific acceptance handshake

1. **M03 integrator:** review private archive shape against `scripts/dry-run-source-mapping.mjs --json` and `scripts/dry-run-source-fields.mjs --json`, choose typed/operational source-to-D1 schema, and propose a **separate** numbered migration with strict provenance, immutability, safe provenance identity and bounded pagination. Do not edit M02 owner files or active PR #519 Party path.
2. **M11 CI owner:** review and assign `tests/integration/m03-frozen-source-readback-workerd.spec.mjs` to a full current-head local Workerd shard, or a dedicated test-only PR-only workflow with no cloud bindings or secrets.
3. **M02/M10:** use only source-shaped private readback from actually imported D1 (not source JSON copied twice) against independently verified 49-group original counts/digests; investigate all discrepancies and preserve private values off GitHub.
4. **M04/M05–M08:** require staff session/RBAC and one M03 atomic posting interface; do not infer authorization from identity, archive rows or a green synthetic test.
5. **Owner:** keep the original GAS/Sheets business fully intact; grant explicit private export and cutover approval separately when verified prerequisites exist.

**Release verdict:** private source-readback contract only, **NO-GO for real migration or production**. A full M03 module cannot be honestly closed by this proof alone.
