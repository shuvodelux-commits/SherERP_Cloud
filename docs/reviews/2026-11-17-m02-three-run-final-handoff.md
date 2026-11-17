# M02 Three-Run Completion and External Reconciliation Gates

**Date:** 17 November 2026. **Owner:** M02 / [issue #24](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/24).
**Parallel coordination:** [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).
**Pinned Mohim_ERP source:** `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Current design-only status:** **M02 offline/source-preservation engineering staged for review; historical private business source→D1 import reconciliation is NOT VERIFIED**.

## Three-run trace and review status

| Run | Owned engineering artifact | GitHub evidence | Acceptance state |
|---|---|---|---|
| 1A | All-49 group exact source-text, original row positions, original-ID and 62 exact reference review rules | [PR #493](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/493) on `main` as merge `f0e4fc245fce591eb469852fbf2c9b3eb66bca15` | Merged foundation; only synthetic/local export evidence |
| 1B | Independent original counts + source-freeze SHA-256 evidence and no-follow private JSON file reader | [PR #505](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/505) | 44/44 exact-head CI passed at Run 3 start; owner review/merge outstanding then |
| 2 | 49-group source-to-D1 logical proposals, legacy identity and role-separated account review, 19 partial DDL-only / 30 unmapped statuses | [PR #515](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/515) | Prior 11 workflow failures traced to one incorrect test regex expecting a different fail-closed rejection phrase; targeted correction committed; new exact-head CI required |
| 3 | All-column human-review preservation contract; original field hazards (signed gross money, FIFO quantity, identifiers, secrets, source dates, JSON and deleted history) | This PR | 49 groups / 659 original columns; 15 test-first acceptance cases; CI/review required |

This table records the state at the time of authoring; **never interpret a green isolated Node/Workerd test as a real production source import**. The exact PR head and required checks must be re-verified before each merge.

## Exact source-to-target obligations

- **49/49 frozen source groups** from `legacy/source/Config.gs`; full original header order mandatory. `LOGS` and line-item/bundle allocation sources have explicit physical row provenance, not fabricated master IDs.
- **659/659 original field definitions** receive exact-string preservation obligations; the source field review is not an endorsement of proposed operational SQL storage types. M03 owns reviewed operational schema/column mapping and import code.
- **Original identity:** Customer, Supplier, Vendor, Finance Person, Payee IDs remain independent until human-reviewed legal-identity linkage. No name, phone, address, equality of apparent amounts or source IDs *across groups* auto-joins legal Parties. Staff login roles are separate from Party roles.
- **Gross finance:** Customer receivable/advance; Supplier payable/advance; Vendor payable; Vendor receivable; Owner equity/drawings; Lender loan payable; Borrower loan receivable remain distinct. Vendor Current Due/Current Receivable are not offset. Payee alone incurs no liability. Opening balances are historical, not newly generated Cash/Bank/Cash Session activity.
- **Inventory:** Preserve original Product IDs, purchased lot IDs, purchase date + Lot ID FIFO order, OVERSOLD lot history, supplier/vendor sourcing, unit/Tile Box/Pcs/Sqft conversions, revision snapshots, bundle composition, sale-item lot consumption and stock movement reversal provenance.
- **Sales / corrections:** Preserve invoice/draft IDs, split tender versus applied versus change, operation ID and replay hashes, original edits/deletions, native return documents, same original-lot reversal and audit-trail ordering; no second correction engine.
- **Privacy:** Full source rows, staff credentials, phones, Settings and actual original financial balances must never be in GitHub source, CI logs, PR descriptions, publicly accessible Workers or deterministic unredacted JSON reports.
- **Snapshot:** Approved independent source export counts and digests are kept privately. Only actual privately reviewed D1 source-shaped readback may be compared with the independent frozen original; copying the source file twice is **not** a real D1 reconciliation.

## External acceptance gates still required (BLOCKED)

| Gate / owner | Specific required evidence | Why M02 cannot certify it here |
|---|---|---|
| M02 + business owner | Complete source export of all **49/49** real groups, original exact IDs/rows/phones/precision, 100% independent count and SHA-256 reconciliation | No authority or private live Google Sheets export supplied |
| M03 | M02 mapping proposal design acceptance; D1 archive and operational SQL implementation, reviewed original-ID integrity, source-shaped authenticated readback | M03 exclusively owns all `src/db` migrations and shared runtime contracts |
| M04 | Reviewed staff sessions/credentials/role/permission rules, real D1 revocation and authenticated session guard | Current offline M02 test cannot authorize public authentication |
| M05–M08 | Source-faithful atomic stock, invoice, returns and gross financial ledger mapping to one shared posting kernel | Module-owned historical finance/stock tests and M03 integration gate are separate |
| M10 | Actual approved private source→D1 rehearsal, independent **49/49** group mismatch resolution, per-role gross balances, FIFO lots, idempotent retries, backup/restore and accountant review | M10 [issue #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312) is explicitly a gated rehearsal lane |
| M11 | Written owner go/no-go, complete prelaunch CI, rollback and cutover approval | Not granted by a mapping metadata report |

### Safe M03 integration handshake (proposal, not code)

M03 may consume the names/columns from `node scripts/dry-run-source-fields.mjs --json` and review all 49 proposed logical models from `node scripts/dry-run-source-mapping.mjs --json` **after PR #515 merges**. M03 must independently decide storage types and authoritative source-to-operational field bindings, with original source text retained for audit. M10 separately consumes independently authorized readback/reconciliation evidence, not this metadata-only report. Preserve M03's single-writer/atomic posting ownership throughout.

## Final M02 disposition

**M02-owned design + offline tests can be complete only after PRs #505, #515 and this Run 3 PR pass exact-head full CI, receive required review and are present on `main`.**

**The entire M02 business-data migration/reconciliation cannot be closed or labeled production-ready until the real 49-group export and verified D1 import, gross accounts and historical source parity are independently evidenced.** On any missing original data, unresolved account mismatch, identity ambiguity or schema disagreement: **NO-GO** and preserve the working GAS/Sheets source unchanged.
