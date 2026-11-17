# M02-safe — Offline 49-group source text parity and relationship review

**Status:** Local-only source export rehearsal, not a D1 import certificate.
**Issue:** #24; **coordination:** #456; **owner:** M02 scripts/fixtures/tests/docs.
**Frozen original repository:** `shuvodelux-commits/Mohim_ERP` at `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Source headers:** `docs/baseline/schema-inventory.json` (49 groups).
**Existing integration boundary:** M03 owns `src/db/**`, numbered migrations, Worker runtime and source-to-D1 transaction access.

## Included in this reviewed local-only contract

1. Validate *all 49* original group headers in exact order, including explicitly empty groups.
2. Require each cell to be exact text; never coerce IDs, phone strings, monetary strings, timestamps, Bengali Unicode, deletion flags, barcodes or JSON cells.
3. Preserve explicit physical `sheetRow >= 2`, with no inferred positions, gaps fabricated or duplicate source rows.
4. Check unique *record* IDs only on groups where the first-party frozen schema specifies one; retain repeated Invoice/Purchase/Return IDs on line-item and lot-allocation groups.
5. Verify two independent source-shaped exports against a pinned source commit and produce deterministic domain-separated SHA-256 group digests, row counts, and redacted discrepancy codes.
6. Inspect 62 reviewed exact-ID relationship fields as **human-review hints**, not enforced financial FKs. A blank optional source ID stays blank; a missing required ID or nonmatching nonblank ID is a review finding.
7. Preserve distinct Customer, Supplier, Vendor, Finance Person, and Payee source identities. Same names/phones are **not identity evidence**; no account netting, automatic Party linking or financial postings are permitted.
8. Exclude inferred/free-text references such as ledger `Reference`, arbitrary `Person` name, phone comparisons and JSON contents from automatic matching. Historical source orphans, deleted parents and OVERSOLD allocations may require expert review.
9. Reject malformed/missing groups, wrong source commit, wrong headers, unsafe text and duplicated frozen master IDs before comparison.
10. Keep every source file and output report private; reports contain only frozen group names, count/digest evidence, safe reference field names and up to 20 sheet row *numbers* per unresolved relationship.

## Explicit offline use

Both local JSON exports must have this shape (illustrated only; all 49 groups and full ordered headers are mandatory):

```json
{
  "formatVersion": 1,
  "sourceCommit": "29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2",
  "groups": {
    "PRODUCTS": {
      "headers": ["Product ID", "Product Name", "... every frozen header in order ..."],
      "rows": [
        {"sheetRow": 2, "cells": ["P-SYN-1", "Synthetic item", "... matching text columns ..."]}
      ]
    }
  }
}
```

The example above is intentionally abbreviated and **not executable** until expanded to all frozen headers and all 49 group keys. Do not create guessed source IDs or fabricate rows to fill gaps in real migrations. For synthetic test coverage, see `tests/fixtures/m02-source-parity.synthetic.json`; tests expand the source-pinned header list.

```bash
# Read-only, with two explicit local files. Exits nonzero on any exact-text discrepancy.
node scripts/dry-run-source-parity.mjs /path/to/source.json /path/to/candidate-source-shaped.json

# Read-only exact original-ID review queue. Exits nonzero when human review is needed.
node scripts/dry-run-source-parity.mjs --references /path/to/source.json
```

Both commands print **redacted JSON**. They never open remote APIs, D1, Google Sheets, or write to any file. They do not show original names, phones, IDs, Settings, passwords, transaction amounts or contents. SHA-256 digests can reveal equality between reports; keep the reports private and do not paste full source snapshots into GitHub.

## What this does not prove

- A candidate file is **not** automatically an actual D1 projection or verified private production export.
- Exact source text does not independently prove accounting direction, FIFO accuracy, historical COGS, cash-session semantics, or zero gross per-Party role differences.
- Identity-review findings are **not** permission to merge Parties. A source legacy ID match across two different groups is not the same legal identity.
- This does **not** change the current `0/49` fully live imported/reconciled status, run production migrations or unblock M03/M04/M05–M11 financial public operations.
- M03 must later provide an approved and authenticated source-shaped D1 read projection; M10 must independently validate counts, IDs, gross stock/ledger balances, backups, restore and owner-reviewed cutover.
