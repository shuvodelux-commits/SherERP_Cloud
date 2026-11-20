# Independent ERP Accounting QA — Super Build / Super QA / Super Review

**Date:** 20 Nov 2026 (Asia/Dhaka)
**Review status:** **NO-GO for live financial posting and historical cutover.** This is an independent QA evidence record, **not** an authorization for schema changes, posting integration, Cloudflare deployment, data import or business-policy changes.

**GitHub baseline:** SherERP_Cloud main at `8fc6e7fd1d4fa78d84e3c45f4d25b85c613f57cc` (merged #717); original immutable Mohim_ERP source `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Coordinating issues: [#24 M02 supplier/source](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/24), [#66 M08 finance](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/66), [#22 M03](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22), [#690 clean shop](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), [#456 concurrency](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456), [#312 M10 recovery](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312) and [#306 M11 release](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306).

## Scope and reproducibility

Independent read-only review of frozen Apps Script purchase, sale, return, money-ledger and session behavior; GitHub current migration/RPC readiness; full affected local financial test suite. No staged or production account was contacted. No financial source, Worker, UI, SQL migration, RPC, Cloudflare profile or runtime calculation was modified. **Codex owns PORT-00 P2 and upcoming two-Shop binding tests; this QA PR does not touch those files.**

Run from the reviewed commit with Node >=22, locally installed Wrangler/Workerd and permitted loopback. The test examples use only synthetic/local data:

    npm run verify:source
    node scripts/audit-migration-coverage.mjs --check
    node scripts/dry-run-source-mapping.mjs --check
    node --test \
      tests/contract/m03-run3-purchase-precision-source.test.mjs \
      tests/contract/m08-purchase-source-financial.test.mjs \
      tests/contract/m06-sale-payment-source.test.mjs \
      tests/m03-run3-source-id-contract.test.mjs
    node --test --test-concurrency=2 \
      tests/integration/m05-purchase-posting-workerd.spec.mjs \
      tests/integration/m05-tile-atomic-receiving-workerd.spec.mjs \
      tests/integration/m06-sale-posting-workerd.spec.mjs \
      tests/integration/m07-cash-return-workerd.spec.mjs \
      tests/integration/m07-store-credit-workerd.spec.mjs \
      tests/integration/m08-reconciliation-atomic-workerd.spec.mjs \
      tests/integration/m02-gross-parity-workerd.spec.mjs

### Observed results — the actual 20 Nov 2026 run

| Verification | Observed | Meaning / limitation |
|---|---|---|
| Frozen source manifest | **84 files verified** | Protects source integrity, not financial parity |
| Four affected source/contract suites | **26 passed, zero failed** | Executes original source statements and source-shaped contract logic |
| M02/M03 migration coverage audit | **49 source groups; zero fully reconciled; 394 async-impacted source functions** | Inventory and gap evidence, not completed migration |
| M02 mapping audit | **49/49 proposed mappings; 30 missing source-specific D1 DDL; zero fully reconciled** | Historical data/account reconciliation remains unproven |
| Seven invoked local D1 suites (some import additional tests) | **183 passed, zero failed** | Real local Workerd/D1 but using **synthetic, isolated fixture schemas**, not approved operational purchase/sale/return D1 or a private-host complete ERP |
| Public production purchase/sale RPC | `src/rpc/registry.js` exports an **empty registry** | Correct fail-closed gate; it is **not** evidence of a working ERP posting API |
| Operational numbered D1 migration inventory | `migrations/0001`–`0014`; no complete purchase/sale/party-money posting schema in those migrations | Existing product/auth/catalog and separate private/staging capabilities do not equal a complete financial writer |
| Real Cloudflare tenant, private historic data and restore | **Not tested in this QA** | Cannot certify actual account/D1 binding, private ledger balances, or recovery |

Local machine caveat: CachyOS `/tmp` tmpfs was nearly full (30 MiB free) when starting. The reviewer used an isolated Git worktree under `/home/shoaib` and a private `TMPDIR` there. **No caches, unrelated worktrees or local main changes were removed.** Do not interpret future `/tmp` test failure as an ERP bug without investigating the environment first.

## Super QA: accounting acceptance matrix

All "passed" entries below refer strictly to the named **source or synthetic D1** proof. The rightmost gate is still required before releasing the operational feature.

| Invariant / expected behavior | Evidence now | Outstanding real-operation acceptance |
|---|---|---|
| Original Supplier ID, reviewed Party link and gross role-separated balances | M08 source oracle; M02 gross D1 fixture; same-Party AR does not net Supplier AP | M02 #24 reconciled actual IDs, opening balance and all ledger rows, duplicate/orphan review |
| Cash purchase and payable sign | Source `createPurchase` and M05 D1 reference: 10×৳60 credit, 10×৳75 cash yields 20 stock, cost ৳1,350, supplier due ৳600, drawer movement −৳750 | M03 operational purchase SQL with original source IDs and SQL-time actor/Cash Session permission |
| Original purchase dates, distinct FIFO lots and reversal lineage | M05 local Workerd/D1 backdated/lot tests and M07 source-lot restoration fixtures | Operational FIFO across own/vendor/OVERSOLD, purchase edits/deletes and reversal integration |
| Purchase requires active Cash Session even if entirely due or paid through Bank | Frozen `Purchase.gs` unconditional check; synthetic test denial | Exact enabled/disabled tenant setting and current session enforced inside operational SQL |
| Cash sale posts only applied money, cash change is metadata | M06 local D1: tender ৳120 on ৳100 invoice credits Cash Book only ৳100 | Original POS V2 browser ↔ authenticated Shop D1 end-to-end and printed invoice reconciliation |
| Split tenders conserve cash/bank/mobile applied total | M06 local D1: Bank ৳35.25 + Mobile ৳22.75 + Cash applied ৳42 = ৳100, cash change ৳8 | Operational payment child/book lineages, backdated edits and per-account reconciliation |
| Customer due, supplier AP and advances stay separate | M06/M07 synthetic D1 and M02 gross checkpoints | Accepted ADR-007 identity links and real Party ledger source readback; no silent cross-role offsets |
| Cash and Store Credit returns restore only proven original lots | M07 local Workerd/D1 stock, replay and injected rollback suites | Unified operational sale/return history, original consumption/bundle/oversold lineage, UI tests |
| Supplier Return credit/payment semantics, returns by original lot | Frozen `PurchaseReturn.gs`; independent M05/M07 synthetic tests in earlier merged evidence | M08 settled advance/credit policy, operational SQL implementation and exact cross-module rollback |
| Tiles/Pcs/Box/Sqft quantity and revision conservation | M05 tile receiving local Workerd/D1: canonical Pcs, nominal area bounds, revision and SQL failure guards | Product unit configuration, Tiles purchase ↔ POS ↔ returns in the original UI and operational database |
| Cash close/reconciliation does not invent synthetic variance money | M08 reconciliation local Workerd/D1 tests cover link, same ID replay, concurrent claim, rollback | Reviewed real source cash-session/Bank ledger readback, current authority, closing reconciliation in one live data path |
| Replay/partial failure never duplicates money/stock | M05/M06/M07/M08 synthetic tests include replay, stale SQL CAS, concurrent operations and last-ledger-leg failure rollback | Shared **single** M03 transaction kernel and private real D1 recovery/roll-forward receipt verification |

### Business-policy review points: do not silently change source behavior

1. **Sub-paisa value and rounding:** `Purchase.gs` accepts 0.5 × ৳10.005, storing subtotal/due ৳5.0025 and original unit cost ৳10.005; M05 synthetic fixed-paisa writer correctly **rejects** fractional-paisa cases instead of guessing. Choose approved quantity/price scale, tie handling and posting boundary before the operational schema. See merged #709/#714/#716 and issue #66.
2. **Split vs one-shot Supplier Credit returns:** A purchase worth ৳3 discounted to ৳1 yields three separate returns of ৳0.33 (total ৳0.99), versus one full return of ৳1.00. One-paisa residual is **observed source behavior**; accepting, disallowing or absorbing it requires a documented decision and tests. Do not silently promise perfect cumulative equivalence.
3. **Cash refund on unpaid Customer invoice:** Frozen `SalesReturn.gs::prepareSalesReturn_` explicitly treats cash refund as an operator-selected outflow even when the original invoice is unpaid, **leaving Customer AR unchanged**; M07 synthetic `original fully unpaid sale accepts actual Cash refund` tests this. This is intentional pinned-source semantics, **not evidence of a code bug**. Owner/M08 should explicitly accept this financial/reporting policy or authorize a separately reviewed change; never silently net AR against an outgoing refund.
4. **Physical ledger column directions:** A source Supplier Ledger **Debit** raises source signed due; purchase Cash/Bank Book **Debit** records money out; sale Cash/Bank Book **Credit** records money in. Do not substitute conventional general-ledger semantics without an explicit mapping.
5. **Cash-session setting and historical openings:** Sale, purchase and relevant returns require the original active-session gate; source historical opening balances are **not** current-day drawer movements. A per-tenant setting that relaxes session enforcement must be separately reviewed and tested without weakening financial integrity.

## Independent Super Review: prioritized findings

| ID | Severity / decision | Finding and closure evidence |
|---|---|---|
| QA-01 | **P0 release blocker** | No end-to-end authoritative purchase→POS→return shared financial writer and operational D1 schema. The public RPC is fail-closed and local accounting tests use synthetic fixture tables. **Codex M03** after M02/M08 and M04 sign-off: one versioned schema, atomic SQL receipt and role/session enforcement, real Workerd/D1 and original UI proof, audit trail; no parallel posting engines. |
| QA-02 | **P0 for historical continuation/cutover** | 49 source groups have zero *fully* reconciled, 30 lack their source-specific DDL. **M02/M10** prove original IDs/row counts/master and gross ledger amounts against owner-approved protected snapshots, repeat import and rollback with zero unexplained critical discrepancies. Fresh empty shop can be proven separately; no workbook dependency for clean onboarding. |
| QA-03 | **P0 deployment gate** | Private hosted Admin/Owner authority, active Shop↔D1 binding, actual role/session denial and financial workflow not certified by these tests. **Codex M03/M04/M10/M11** test each on a separately approved disposable/staging target; avoid violating concurrent PORT-00 two-Shop isolation ownership. |
| QA-04 | **P1 accounting decision** | Monetary precision, stored scales and supplier-credit rounding residual unresolved. **M08 #66 and M02 #24** sign source policy + source-ID reconciliation first; add deterministic amount bounds and source-compatible fixtures before SQL design. |
| QA-05 | **P1 business-policy decision** | Cash refunds against unpaid invoices are source-valid and leave receivable outstanding. Require owner/M08 written acceptance or a separately approved correction contract plus financial/reporting tests; no quiet reinterpretation. |
| QA-06 | **P1 posting boundary** | Every sale/purchase/return must bind current server-derived tenant, actor, permission, Cash Session and product/lot version in the **same** atomic mutation. Synthetic tests demonstrate patterns but are not the real M03 shared kernel. |
| QA-07 | **P1 end-to-end acceptance** | Original POS V2 split payments, multi-unit/Tiles, invoice/print, returns/edits, cash close, source/final balances and UI refresh still need one approved private operational E2E across two empty shops (after Codex's isolated binding proof). |
| QA-08 | **P2 operator environment** | Local `/tmp` tmpfs near full may break future Workerd/browser tests. Keep QA temp isolated on disk or inspect capacity; do not delete unrelated worktrees/files without explicit authorization. |

### Recommended safe Codex execution order

1. **Do not interrupt Codex's PORT-00 P2 two-Shop binding ownership.** Review that scoped PR and ensure same-ID/different-value, swapped binding, interrupted migration, resumed migration, rollback and no cross-shop leak are proven locally.
2. Obtain **M02 #24 supplier identity/reconciliation** and **M08 #66 exact monetary/return/advance policy** sign-offs. This QA report is **evidence and blocker classification, not those approvals**.
3. Only then let the **single M03 integrator** open a test-first operational purchase schema/writer PR; RED first with real local Workerd/D1 10×৳60 credit plus 10×৳75 cash oracle, SQL-time actor/Cash Session, same-ID replay, late failure rollback and gross Party isolation. No public RPC/remote SQL during this proof.
4. After purchase, integrate M06 POS, M07 returns and M08 ledgers against that exact shared schema/receipt contract; verify source/multi-unit/Tiles and 100%-correct reconciled business calculations rather than only green tests.
5. Reserve private historical import, backup/restore, hosted release and final production GO for **M10/M11 approvals**; do not count test-only Workerd or an empty DB as production readiness.

## Super Review sign-off

- **Source fidelity:** PASS for inspected behaviors and 84 immutable files. This is not an exhaustive proof for the original ERP.
- **Local isolated financial test regression:** PASS, 26 source tests + 183 Workerd/D1 tests, zero failures, on the pinned local main checkout.
- **Live operational accounting correctness:** **BLOCKED / NOT TESTED**.
- **Historical gross reconciliation:** **BLOCKED / NOT TESTED**.
- **Security/tenant deployment and recovery:** **BLOCKED / OUT OF SCOPE** (Codex PORT-00 separate).
- **QA decision:** Keep production financial write, remote migrations, public RPC and cutover disabled. Review findings and have Codex implement only after the named signed contracts and gates.

**File ownership/rollback:** This PR adds only this review document. Revert it to undo the document; there is no operational state or schema impact.
