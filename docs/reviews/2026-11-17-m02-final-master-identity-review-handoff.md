# M02 final master/Party identity advisory handoff — issue #598

**Frozen Mohim source:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **M02 workstream:** #24; M03 shared schema/write owner #22; M08 Party accounts #66; M10 privately authorized rehearsal #312; M11 launch gate #306. No original business data were accessed or copied into this PR.

## What the source-only validator adds
`scripts/dry-run-master-identity-review.mjs` reuses the frozen 49-group exact-header/row/text/source-ID validator before analyzing private in-memory source values for potential identity ambiguity. It records **only counts** of (a) exact nonempty category/unit display-name collisions under distinct original master IDs, and (b) exact nonempty original name+phone matches across Customer, Supplier, Vendor, Finance Person and Expense Payee groups. Original name/phone matches are **advisory**, not proof of legal identity or an instruction to combine records. Blank names/phones are ignored; no normalized phone/name comparisons, no source record updates, no new Party IDs or financial balances.

The input stays on the operator's private authorized machine. Invoke only on a separately owner-approved local snapshot already matching M02 Run 3 shape:

```sh
node scripts/dry-run-master-identity-review.mjs /private/49-source-groups.json
```

**CLI output:** `sourceGroups:49`, reviewed master and Party group totals, only public source-group names, fixed review codes and counts, and always-false authority/reconciliation flags. No actual original IDs, names, phones, source rows, amounts, file paths, hashes, salts or credentials are printed. Exit 0 means only that no **advisory identity collisions** were found in a supplied offline input. Exit 2 means review findings or malformed/unsafe local input. An output free of findings is not an independent source export, an identity determination or D1 readback.

## Human adjudication
For each code `DUPLICATE_MASTER_DISPLAY_NAME_REVIEW`, the private operator must review distinct original category/unit IDs (including historic deleted references and Product foreign references) and decide whether to preserve separate operational identities. Never auto-deduplicate by display name. For each `POSSIBLE_CROSS_ROLE_IDENTITY_REVIEW`, the operator should examine source-group+ID+physical row provenance, legal identity evidence and the seven ADR-007 independent economic-role obligations. Name/phone similarity is not legal identity. Never auto-merge or auto-net the Customer receivable/advance, Supplier payable/advance, Vendor payable/receivable, Owner equity/drawings, Lender payable or Borrower receivable accounts. Expense Payee by itself is not a liability.

## Completion boundary — *cannot* be certified by M02 synthetic CI
- [x] 49 original source groups, 659 columns and source ID/row shape frozen; 38 generated ID families and source+ID/counter freeze consistency available on main
- [x] Offline duplicate original ID/reference and source-text fidelity checks
- [x] This additional display-name and exact cross-role **review-only** checker staged behind test-first GitHub PR
- [ ] Written owner authorization for real private 49-group Google Sheets and 38-counter snapshot plus secure custody/backup
- [ ] M03 reviewed source archive/operational D1 mappings, import/readback and tenant-safe SQL-atomic ID issuance
- [ ] M10 independent real original-vs-D1 readback of all 49 groups, zero unexplained critical differences, gross Party obligations/lot FIFO/returns/stock and restore drill
- [ ] Verified GitHub pre-merge independent reviewer protections (issue #594) and final M11 release decision

**Final rule:** `sourceToD1Reconciled:false`, `productionReady:false` remain immutable for the M02-only tool. Do **not** close the M02 parent as a fully migrated production-ready module based on synthetic tests or duplicated source copies. M03/M10 own the externally authorized next steps.
