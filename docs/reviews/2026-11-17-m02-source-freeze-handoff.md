# M02 source freeze handoff — independent counts and exact-text snapshot

**17 November 2026.** M02 issue #24, coordination #456, shared D1 integrator M03 issue #22, rehearsal owner M10 issue #312.
**Pinned original source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Source reference:** `docs/baseline/schema-inventory.json` (49 configured source groups).
**Existing M02 prerequisite:** PR #493 (`scripts/dry-run-source-parity.mjs`), merged and confirmed on main. New gate in PR #505.

## What the source owner must prepare privately

1. Export an **approved full snapshot** of all 49 original Google Sheets data groups into a private `source.json`, preserving every original column, exact text value, physical `sheetRow`, no invented row positions, and the pinned `sourceCommit` metadata. Exporting is an authorized external step, **not performed by this PR**.
2. Independently review each original sheet's data-row count (excluding the header row). Save a separate private `counts.json` object keyed by **all 49** frozen group names; include zero counts for intentionally empty groups.
3. Run the capture CLI, inspect the output, and retain the resulting manifest privately with the source export and independent count attestations. The CLI does **not** write the manifest to disk.
4. Run the exact source-ID review CLI from #493; manually investigate unresolved reference evidence without deleting orphan rows or attempting name/phone matching.
5. At a subsequent authorized freeze point, generate a **separate candidate source-shaped snapshot** from the approved D1 review adapter (owned by M03). Until that adapter and its owner authorization exist, do not pretend a duplicate copy of `source.json` is a D1 export.
6. Verify the D1 candidate source-shaped snapshot against the independently retained source manifest using the verification CLI. A mismatch is a blocker to investigate, not an instruction to update the baseline or change source rows.
7. After exact-text parity, M10 and the accountant must independently reconcile financial gross role accounts, separate Vendor Due/Receivable, FIFO lot quantities, original sale returns, cash/bank sessions and historical opening balances. Passing this CLI is not evidence of monetary correctness.

## Offline CLI (explicit regular private local files only)

```bash
# Group count file: {"PRODUCTS": 123, "CUSTOMERS": 52, ...}
# The example is illustrative: every 49-group count is required, not guessed.
node scripts/dry-run-source-freeze.mjs --capture /private/source.json /private/counts.json > /private/freeze-manifest.json

# After an independently authorized D1 source-shaped read is available:
node scripts/dry-run-source-freeze.mjs --verify /private/freeze-manifest.json /private/d1-candidate-source-shaped.json

# Optionally review exact original foreign-key-like IDs on the source snapshot:
node scripts/dry-run-source-parity.mjs --references /private/source.json
```

Exit statuses: capture succeeds with 0; verify returns 0 only for an exact match and returns **2** on a count/digest mismatch; rejected/malformed local inputs return **2**. The reference-review command returns 1 when human review findings exist. Commands make no database or source-file changes.

## Manifest format (non-authoritative)

```json
{
  "formatVersion": 1,
  "sourceCommit": "29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2",
  "scope": "offline-source-shaped",
  "fullyCoveredGroups": 49,
  "totalRows": 0,
  "fingerprint": "<64-character SHA-256 of ordered group evidence>",
  "sourceApproved": false,
  "d1Verified": false,
  "productionReady": false,
  "groups": [
    {
      "sourceGroup": "PRODUCTS",
      "declaredRows": 0,
      "sourceDigest": "<64-character SHA-256 of original group text and physical row numbers>"
    }
  ]
}
```

This is a *shape illustration*, not a valid complete manifest: the actual output contains all 49 groups in frozen order. Root digest is deterministic and detects accidental manifest edits; it is **not** a cryptographic signature, an authenticated human approval or a guarantee that the exported source itself was truthful. Counts must be checked independently, not copied from the candidate. A manifest and a copied source snapshot can match while still containing historical errors.

## Security and operational guards

- Scripts read only two explicitly named, existing, regular local JSON files. Inputs cannot be a symlink, URL, FIFO, device, directory, malformed JSON or a file over 64 MiB; source files are never modified.
- Source rows may include passwords and private customer data. Do **not** commit `source.json`, `counts.json`, the raw D1 snapshot or the resulting fingerprints to a public PR or issue.
- JSON reports contain group names, counts, hashes and safe discrepancy identifiers only, with no names, phones, source IDs, raw amounts, passwords or Settings values. Public disclosure of fingerprints can still reveal equality across reports, so evidence stays private.
- Full source fidelity needs 49/49 groups and independent production-authorized D1 rows. Current published audit is **0/49 fully reconciled**; this tool does not change that status.
- Cloudflare production D1 migrations, any source edit/deletion, M04 public authentication, shared transaction APIs, and cutover remain separately gated. M02 owns only offline semantic and evidence tooling.
