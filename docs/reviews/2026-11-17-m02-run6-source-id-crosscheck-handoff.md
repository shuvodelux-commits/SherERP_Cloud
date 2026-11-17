# M02 Run 6 — source-to-ID cross-evidence private handoff

**M02 issue #590 / parent #24 / coordination #456.** Original pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Source/ID evidence **remains offline only**, not a live import. Owner boundaries: M03 #22 controls common D1/migrations/atomic ID issuing; M10 #312 controls private authorized source→D1 rehearsal.

## Why this gate exists
Run 3 accepts a complete 49-group original source-shaped snapshot, including source headers, original text/physical-row fidelity and all 11 groups without Config-generated ID families. Run 4 separately accepts 38 generated-ID-family original `(sheetRow,id)` lists and captured DocumentProperties counters; Run 5 stores their private salted commitments. Each can be internally valid while referencing **different original source snapshots**. This new M02 report rejects that discrepancy without creating source records, rewriting IDs, joining Party names or implementing a D1 importer.

## Private offline invocation
After separate written source-access authorization, retain the three required files outside the repo/PR/CI/public Workers and run:

```sh
node scripts/dry-run-source-id-crosscheck.mjs /private/49-group-source.json /private/38-family-id-evidence.json /private/38-family-id-freeze.json
```

All three are bounded regular-file JSON reads using `scripts/dry-run-safe-input.mjs` (no final-path symlinks/URLs/device nodes). The source export shape matches `reviewOfflineSourceParity` (49 `groups[group].headers`, exact-string `rows[].cells`, original `sheetRow`). The ID evidence matches Run 4, the private freeze matches Run 5. For each of the 38 Config-derived source groups, the comparison checks `(sheetRow,cells[0]) === (sheetRow,id)` using the original first-column semantics. JSON row-array order is irrelevant. Deleted history must remain in the private export; a deletion or missing original row cannot be recreated by row-count or sequential-ID guessing.

**CLI stdout:** source group totals, a `false`-by-default authorization/reconciliation status and a list of public group names, fixed discrepancy codes and counts. **No** original IDs, actual counter values, original financial amounts/phones/names/passwords, physical row numbers, source paths, salts or private digests. Exit `0` means only that *supplied offline input files are mutually internally consistent*; exit `2` means inconsistent/invalid evidence. It is **not** cryptographic proof that both exports were independently authorized or truly obtained from live Google Sheets.

## Status and integration gate
- Synthetic: 49 source group layouts, all 38 Config-generated ID families; the remaining **11** groups retain source-shape validation but receive **no invented ID prefix**.
- **M02:** remains report-only and cannot certify historical source data imported or independently reconciled; real source→D1 accepted groups remain **0/49**.
- **M03:** only reviewed SQL-atomic, tenant-scoped ID issuance preserving original historical deleted IDs and source DocumentProperties floor, backed by actual local D1 concurrency/replay/rollback evidence, can enable a transaction writer; this report does not implement one.
- **M10:** later compares separately owner-authorized original source and independently acquired D1 readback, gross Party role-account direction, source invoice/return/stock/FIFO histories and backup/restore, not two copies of an original export.
- **M11:** original data access/staging/remote import/production cutover still require distinct owner go/no-go approval.
- **Reviewer:** exact-head GitHub CI and independent review are mandatory prior to merge. The PR is small and M02-only; rollback is a revert with no source/DB data-state change.
