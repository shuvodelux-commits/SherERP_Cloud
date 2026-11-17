# M02 Run 5 — Original ID/counter freeze; M03 + M10 handoff

**Issue:** #573, parent #24, board #456. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Release status:** M02 offline-only, nondeployable, **NO-GO**.

## What the build produces
`scripts/dry-run-id-evidence-freeze.mjs` validates the existing Run 4 38-family original-ID/counter evidence and creates a private, salted source-row-and-property-counter freeze. Only the original ID-column text, physical original Sheets row position, original counter text, source group, and source pin affect commitments. JSON array ordering does not. The root fingerprint detects accidental manifest changes; **the manifest alone cannot establish capture authenticity** (an attacker able to rewrite the manifest can recalculate a new root). Keep a separately stored fingerprint or trusted record if chain of custody is required.

No original IDs, counters, source names, phone numbers, balances, Settings, hashes or salt appear in CLI stdout, stderr or public CI. The private manifest **must remain outside GitHub and public Cloudflare previews**. Use separately authorized local input only; never assume this authorizes exporting live Google Sheets or DocumentProperties.

## Private offline workflow
```sh
node scripts/dry-run-id-evidence-freeze.mjs --capture /private/source-id-evidence.json /private/source-id-freeze.json
node scripts/dry-run-id-evidence-freeze.mjs --verify /private/source-id-freeze.json /private/later-source-id-evidence.json
```

Capture refuses an existing output path, uses exclusive create and restrictive `0600` permissions and does not overwrite another manifest. Both input files use the existing M02 bounded, regular-file, no-follow local JSON reader. Verify exits `0` only for an internally consistent match and `2` for mismatches or rejected evidence, reporting fixed public source-group names and issue codes. Even exit `0` is not independent source certification or D1 reconciliation.

## Remaining integration gates
- **M02 #24:** 49 frozen groups, 659 original columns, 38 sequential ID-family counters and 62 original-ID reference review rules are contracts; actual authorized source→D1 reconciliation remains **0/49 independently verified**.
- **M03 #22:** preserves exact historical ID/counter floors and implements tenant- and actor-scoped SQL-atomic issuance under one durable posting kernel, with real local Workerd/D1 replay, stale-CAS, concurrency and rollback tests; never rely on this offline digest as a database lock.
- **M10 #312:** independently acquires approved original source and actual D1 source-shaped readback, verifies all 49 groups, gross distinct Party account signs, original invoices/purchases/returns, FIFO/OVERSOLD, Cash/Bank/Cash Session and audit histories, rather than comparing two copies of one source export.
- **M11 #306:** private-data authority, backup/restore, staging, cloud migration and production cutover remain separately owner-gated.

## Super Build / QA boundary
Plan and synthetic RED→GREEN tests are in GitHub PR linked to #573. No SQL migration, Worker, GAS/Sheets, M03 `src/db`, public RPC, accounting or source-data changes. **Builder never merges**: draft PR goes to independent QA and reviewer after exact-head GitHub CI is assessed. Rollback is PR revert only; no database state exists to restore.
