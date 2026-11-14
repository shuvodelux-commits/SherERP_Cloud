# M00 — Pinned Original Source Snapshot

**Original repository:** [shuvodelux-commits/Mohim_ERP](https://github.com/shuvodelux-commits/Mohim_ERP)  
**Commit:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`  
**Original Git tree:** `f5bc4976690ba1331d998426677dfcf017bd5127`  
**Original commit date:** 2026-11-11 06:50:19 UTC  
**Destination:** `SherERP_Cloud/legacy/source/` on foundation feature branch (not runnable code).

## Snapshot scope

- 47 root-level Google Apps Script `.gs` files.
- 37 root-level HTML/CSS/JS partial `.html` files.
- **84 total source files; 2,588,647 bytes**.
- All 84 destination Git blob SHA-1 hashes and byte lengths were compared with the immutable source tree at the exact commit. **84/84 matched** during the import check.
- Every file is copied byte-for-byte and keeps its original extension. No migration conversions or UI transformations have been performed.

The snapshot intentionally excludes the source's `.clasp.json`, `appsscript.json`, original test files, documentation, CI configuration, and any live Google Sheets content. These may be consulted in the original repository when needed; only approved app source files are copied into `legacy/source`.

**Do not use this snapshot as a deployment.** It still requires Google Apps Script services and Google Sheets. Port application logic to Worker modules only through separate tested PRs.

## Reproducing checks (after cloning this branch)

```bash
npm test
npm run verify:source
npm run audit > source-audit.json
```

- `verify:source` validates file list, byte counts and Git blob SHA-1 against `source-manifest.json`.
- `audit` is a **static lexical inventory**, not a parser or an assertion that all Google service dependencies have been eliminated. It may count references in comments and strings.
- The original Apps Script regression-suite baseline has **not** been executed in this branch yet. That requires importing or referencing the original tests and selecting a usable GAS/Worker test harness.

## Foundation gates still ahead

M01: Build the original HTML partial tree as static assets without changing DOM or functionality; adapt central `serverCall()` transport.

M02: Analyze all 49 configured sheet groups and design typed, reviewed SQLite/D1 migrations, safe deterministic data import and financial consistency tests.

**Source-of-truth policy:** No changes to the original `Mohim_ERP` repo, existing Apps Script deployment or production spreadsheet were made during M00.
