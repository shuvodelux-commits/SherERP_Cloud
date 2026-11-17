# M02 #602 private original-row review queue — operator and reviewer handoff

**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Parent M02 #24; M03 integrator #22; M08 gross Party policy #66; M10 private rehearsal #312; M11 protected/release gate #306.

## Offline, private use only
First obtain written owner approval for the **private** source export and keep source/queue files outside the GitHub checkout, Cloudflare Workers, public previews, CI artifacts, PRs, tickets, shared logs and cloud-sync folders. Preserve original GAS/Sheets unchanged. Run in a trusted private local directory:

```sh
node scripts/dry-run-private-review-queue.mjs /private/source-49.json --private-output /private/new-review-queue.json
```

The destination must be a **new** file; it cannot exist, including as a symlink. Existing files are never overwritten. The program validates source group count, original fields and physical sheet rows with the frozen M02 source-shape verifier before any private file is created. It reuses `reviewM02MasterIdentityCandidates` as the authority for redacted collision counts and compares the private locator counts against that public-safe report. The private queue uses a random same-directory `0600` `O_CREAT|O_EXCL|O_NOFOLLOW` temporary regular file, flushes the whole content, and atomically publishes through a non-overwriting hard link. The temporary file is cleaned on rejection. Repository-root destinations (including symlinked parent directories) and URL/symlink inputs are rejected. **Trust the private parent directory; do not run in a directory writable by another user.**

**Exit status:** `0` if a new private output was written and no human-review candidate exists. `2` if a new private output was written with advisory candidates, or if validation/write failed (in the latter case there is no new successfully published output). The summary on stdout remains the original redacted M02 fixed public issue codes/source group names/counts, with all D1 and production flags false; stderr uses one generic fixed error, never source data or paths.

## What the private file contains
Two arrays of **original physical Sheet-row locators**, not source record contents:
- `masterClusters`: each includes `sourceGroup`, sorted `sheetRows` for **all** original Category or Unit records with an exact identical nonempty display name, and `candidateCount = N-1`.
- `partyClusters`: each groups an exact nonempty original name+phone collision involving **two or more of the five separate original Party source groups**. It contains sorted `sourceGroups`, `rows: [{sourceGroup,sheetRow}]` and the number of possible cross-role pairs. Repeated names/phones are **advisory only**.

The file deliberately **does not include original names, phone numbers, IDs, Settings, balances, source cells, salted hashes or legal identity decisions**. The private human reviewer uses each `sourceGroup + sheetRow` to examine the independently approved original source snapshot and record a separate authorized adjudication. Do not assume matching text proves identity, delete duplicate legacy IDs, merge Category/Unit IDs, auto-net role balances, or alter any stock or financial history. A later source snapshot may move physical row locations; the locators are valid only for the pinned private export being reviewed.

## Security and QA contract
- No access to live Sheets, D1, customer/staff systems or original Google Apps Script is performed.
- Full 49-group source shape and exact 38 original generated ID-family/counter-floor contracts remain separate already implemented M02 read-only evidence.
- The safe existing `scripts/dry-run-master-identity-review.mjs` is **unchanged**. This new CLI is strictly opt-in via `--private-output`.
- Reject invalid source/duplicate original ID, overwrite/symlink output, missing directory, repository output path, malformed source or private-output buffer overflow. Fail closed with redacted errors and no partially published destination.
- Never treat a clean/offline row-locator review or 44/44 green CI as real historical data→D1 reconciliation.

## External acceptance gates still open
- [ ] Written owner authorization for independently captured **real 49 original source groups** and 38 DocumentProperties counter-family evidence; secure custody/backup, no secrets in GitHub.
- [ ] Human adjudication of any real private original record collisions and distinct gross Party-role accounts under ADR-007.
- [ ] M03 #22 has reviewed operational D1 schema, source-shaped archive/import/readback, SQL-atomic source-ID issuance and auth guard.
- [ ] M10 #312 confirms independently captured **actual** original source vs independently obtained D1 readback for all 49 groups, preserved source IDs, historical stock/FIFO/returns, gross Party account balances and restore.
- [ ] Independent Super QA/Review **before** PR merge and M11 enforced branch approvals + production go/no-go.

**M02 status:** private offline review engineering can be complete after this PR's exact-head CI and independent approval; parent M02 #24 **cannot** be called fully migrated until actual authorized 49/49 source→D1 reconciliation and owner acceptance. As of this handoff **0/49 independently verified**, production NO-GO.
