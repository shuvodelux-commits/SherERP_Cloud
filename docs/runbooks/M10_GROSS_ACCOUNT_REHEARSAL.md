# M10 private staging gross-account reconciliation — operator runbook

**Status: NOT EXECUTED. This is an offline rehearsal specification, not owner approval to extract or migrate private data.**
**Issue:** [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312).
**Frozen original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Source account semantics:** `src/party/gross-balance-preflight.js` and `src/party/gross-checkpoint-parity.js`; [ADR-007](../architecture/ADR-007-unified-party-relationships.md).
**Pure candidate comparator:** `src/migration/m10-gross-party-reconcile.js`.
**Other M10 gates:** M10-01 source↔D1 group hashes; M10-12 source↔backup↔restore; M10-13 independent p95/p99 latency, CPU and D1 workload limits.

## A. Evidence authority before any private dataset

1. Get separate explicit owner authorization for a specified source snapshot and isolated private/staging D1; record owner reviewer, purpose, expiry/retention, scope, verified access and backup custody privately. The repository provides **no** authorization to export source Sheets or import remote D1.
2. M02-P must resolve original legacy IDs, rows, deletion history, user-reviewed identity links and finance Person ID per original Finance transaction. Similar names/phone numbers do not establish a valid link.
3. M02/M08 accounting reviewers must confirm original debit/credit signs and the exact M02 checkpoint contract. All separate accounts are gross: no Party net, no unauthorized cross-role settlement.
4. M03 integration owner must demonstrate source-owned D1 schema/import contracts and actual sanctioned local D1 readback. M10 does not edit migrations/DB bindings.
5. Freeze immutable source capture(s), all 49 group counts, IDs/physical-row digests and original source SHA. Legacy LOGS is physical-position-only rather than fabricated-ID evidence.
6. Confirm independent captured D1 readback, exact original identity commitments, target isolation, source-to-D1 content parity and source freeze/restore chronology.
7. Confirm whether empty original account kinds are genuinely absent through separately reviewed **domain** coverage evidence. Do not manufacture zero-balance original rows.
8. Keep source/row data, approval references, original IDs and even hash commitments in authorized private memory/storage. Only the redacted aggregate report can be pasted into a GitHub issue.

## B. Exact gross account kinds and signs (the existing M02 contract)

| Source group | M02 account kinds | Original source field | Source checkpoint basis |
|---|---|---|---|
| `CUSTOMERS` | `CUSTOMER_RECEIVABLE` / `CUSTOMER_ADVANCE` | `Current Due` | `SOURCE_CURRENT` |
| `CUSTOMERS` | `CUSTOMER_RECEIVABLE` / `CUSTOMER_ADVANCE` | `Opening Balance` | `HISTORICAL_OPENING` |
| `SUPPLIERS` | `SUPPLIER_PAYABLE` / `SUPPLIER_ADVANCE` | `Current Due` | `SOURCE_CURRENT` |
| `SUPPLIERS` | `SUPPLIER_PAYABLE` / `SUPPLIER_ADVANCE` | `Opening Balance` | `HISTORICAL_OPENING` |
| `VENDORS` | `VENDOR_PAYABLE` | `Current Due` | `SOURCE_CURRENT` |
| `VENDORS` | `VENDOR_RECEIVABLE` | `Current Receivable` | `SOURCE_CURRENT` |
| `FINANCE_PERSONS` | `OWNER_EQUITY` / `OWNER_ADVANCE` / `LENDER_LOAN_PAYABLE` / `LENDER_CREDIT` / `BORROWER_LOAN_RECEIVABLE` / `BORROWER_CREDIT` | `FINANCE_TRANSACTIONS.Amount` | `SOURCE_CURRENT` |

**M02 behavior matters:** A source value of `-100.00` in Customer `Opening Balance` becomes a *positive 10000 minor-unit* `CUSTOMER_ADVANCE` checkpoint in `HISTORICAL_OPENING`. It is **not** a `-10000` receivable checkpoint, and never creates present-day Cash Book, Bank Book or Cash Session movement. M02 emits only nonzero checkpoints; a zero current/opening value can be represented by absence of that account row **only if the entire corresponding domain was independently attested**.

`VENDORS` has two distinct current fields. A finance Person may hold Owner, Lender and Borrower roles simultaneously, but the **same signed channel** cannot contain both a positive and an advance/credit direction on one original source Person ID. `EXPENSE_PAYEES` is an identity role only; no payable is automatically posted.

## C. Required supplied-evidence shape

Evidence is supplied by trusted private export/readback adapters; this comparator does **not** fetch any source, hash original IDs itself, sign a receipt, query D1 or establish snapshot authenticity.

```js
{
  sourcePlanReviewed: true, // externally reviewed M02 account/ID plan, not release approval
  identityReviewsPending: 0, // an independently reviewed count
  source: {
    captureId: 'SOURCE-ACCOUNT-001',
    capturedAt: '2026-11-17T07:00:00.000Z',
    sourceCommit: '29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2',
    domains: [
      {sourceGroup: 'CUSTOMERS', basis: 'SOURCE_CURRENT'},
      {sourceGroup: 'CUSTOMERS', basis: 'HISTORICAL_OPENING'},
      {sourceGroup: 'SUPPLIERS', basis: 'SOURCE_CURRENT'},
      {sourceGroup: 'SUPPLIERS', basis: 'HISTORICAL_OPENING'},
      {sourceGroup: 'VENDORS', basis: 'SOURCE_CURRENT'},
      {sourceGroup: 'FINANCE_PERSONS', basis: 'SOURCE_CURRENT'}
    ],
    accounts: [
      {
        sourceGroup: 'CUSTOMERS',
        legacyIdDigest: '<private-64-hex-source-ID-commitment>',
        accountKind: 'CUSTOMER_ADVANCE',
        sourceField: 'Opening Balance',
        basis: 'HISTORICAL_OPENING',
        currency: 'BDT',
        amountMinor: '10000'
      }
    ]
  },
  d1: {
    // same capture fields and six domains,
    // independently captured after the source and compared without netting
  }
}
```

The `legacyIdDigest` must be generated by a separately reviewed, identical canonical original ID commitment algorithm on both source and readback sides. Never substitute a new Party ID, name, phone, or inferred human identity. M02 checkpoints currently track original `sourceId` and `sourceField`, but no separately contracted loan subaccount ID; **do not invent a finance contract hash** in M10. Further loan-level contract granularity is an M02/M08 review dependency.

### Synthetic zero-write smoke check

```sh
node --test tests/m10-gross-party-reconcile.test.mjs
```

To use real private evidence later, an authorized offline adapter must provide the strict shape directly in a secure environment and emit **only** the evaluator's aggregate, redacted report. Never add private JSON fixtures, financial IDs, hashes or raw amounts to GitHub, CI output or Cloudflare preview.

## D. Failure codes and reviewer actions

| Report issue | Investigation inside private environment | Effect |
|---|---|---|
| `GROSS_DOMAIN_MISSING_SOURCE`, `GROSS_DOMAIN_MISSING_D1` | Missing attestation for one of six source-supported domains, including reviewed zero-obligation domains | NO-GO |
| `GROSS_ACCOUNT_MISSING_D1`, `GROSS_ACCOUNT_UNEXPECTED_D1` | Investigate original ID, M02 kind/source field and historical/current basis | NO-GO |
| `GROSS_ACCOUNT_DUPLICATE_SOURCE`, `GROSS_ACCOUNT_DUPLICATE_D1` | Look for duplicate import, source ID reuse or readback joins | NO-GO |
| `GROSS_OPENING_BALANCE_MISMATCH` | Reconcile signed historical source baseline and edits, without current Cash/Bank turnover | NO-GO |
| `GROSS_CURRENT_BALANCE_MISMATCH` | Check customer/supplier due or advance, vendor AP vs AR, finance loan/equity and returns/reversals | NO-GO |
| `GROSS_SIGNED_DIRECTION_CONFLICT_SOURCE`, `GROSS_SIGNED_DIRECTION_CONFLICT_D1` | Original signed channel was incorrectly represented as positive and advance/credit simultaneously | NO-GO |
| `GROSS_IDENTITY_REVIEWS_PENDING`, `GROSS_SOURCE_PLAN_UNREVIEWED` | Obtain M02-P/M08 reviewed original account signs and identity links | NO-GO |
| `GROSS_CAPTURES_NOT_DISTINCT`, `GROSS_CAPTURES_NOT_ORDERED` | Prove distinct source-first/readback-second custody | NO-GO |

For any discrepancy, preserve source snapshot, staging backup, private reporter output and original immutable files. Document internal discrepancy ID, source group, owner, severity, root cause, resolution and replay receipt **privately**. Only sanitized code+count summary belongs in GitHub.

## E. Sign-off matrix — NONE IS AUTO-COMPLETED BY TESTS

| Required real gate | Owner/reviewer | Status |
|---|---|---|
| All 49 groups, source original IDs, rows/digests and mapping | M02/M10 | **Pending real private evidence** |
| Original Party identity links, separate source account directions, signed opening/current balances | M02-P/M08 + independent accountant | **Pending** |
| Isolated local/private D1 staged import, retry/replay/discrepancy convergence | M03/M10 + owner | **Pending** |
| Real D1 transactional retries, stale reads, concurrency, rollback and exactly-once reversals | M03/M04/M05–M08 | **Pending** |
| Staff authority, permissions, log privacy, preview isolation and RPC security | M04/M10 | **Pending** |
| Reviewed latency p95/p99, CPU/D1 cost and mobile/browser/print baselines on representative staging | M01/M09/M10/M11 | **Pending** |
| Isolated private backup and restore readback parity and custodial proof | M10/M11 | **Pending** |
| Independent security and accounting sign-off with explicit owner decision | Project owner | **Pending** |

**Never mark M10 #312 complete or authorize M11 cutover based on a synthetic or self-attested candidate report.** It is not proof that any customer data was imported, and never authorizes shared D1 transaction posting.
