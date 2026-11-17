# M10 private staging rehearsal — gross Party/account reconciliation

**Status:** Preparation and offline evidence review ONLY. **Issue:** #312. **No production GO or customer-data export authorization.**
**Frozen original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Source of account rules:** [ADR-007](../architecture/ADR-007-unified-party-relationships.md).
**Independent module:** `src/migration/m10-gross-party-reconcile.js`.
**Other gates:** M10-01 (49-group source/D1), M10-12 (backup/restore chain), M10-13 (reviewed p95/p99/CPU/D1 budgets).

## 1. Independent gates before any real private snapshot

1. Obtain written owner authorization specifying which **private** source and isolated staging D1 may be read, retention and intended reviewers. Do not reuse production secrets in GitHub Actions or preview.
2. Have M02-P review legacy ID links and account-kind mappings by group; same names or phone numbers never merge an identity. Record unresolved posted-obligation identities separately, without exporting them into issues.
3. Confirm M03 integrator-owned numbered schema and real local D1 testing; the M10 module **cannot** invent schema or perform a Cloudflare import.
4. Freeze a source baseline with audit provenance and **immutable capture receipts** in approved private storage. Compare 49 exact original groups, original IDs and physical row identities (legacy `LOGS` is position-only).
5. Establish the original account sign conventions with M08/accounting reviewer, including signed historical opening balances and separate CURRENT checkpoints. Never post opening balances as current Cash Book or Cash Session events.
6. Agree specific real staging benchmark sample size, p95/p99 Workers CPU/D1 limits and representative business-data volumes before calling a performance gate green.
7. Verify isolated backup/restore custody and independent captured readback. Time Travel/bookmarks and recovery testing must stay outside production until separately approved.

## 2. Gross obligations — never compare a net number

Record both `OPENING` and `CURRENT` separately for each original account and explicit contract, including a zero balance. Keep the same original source master digest, account kind, contract digest and currency on source and readback evidence.

| Original master | Separate account kinds | Critical rule |
|---|---|---|
| `CUSTOMERS` | `CUSTOMER_AR`, `CUSTOMER_ADVANCE` | Customer receivable cannot pay supplier/vendor/loan automatically |
| `SUPPLIERS` | `SUPPLIER_AP`, `SUPPLIER_ADVANCE` | Supplier advance is not a negative customer receivable |
| `VENDORS` | `VENDOR_AP`, `VENDOR_AR` | Preserve Current Due and Current Receivable independently |
| `FINANCE_PERSONS` | `OWNER_EQUITY`, `OWNER_DRAWINGS`, `LENDER_LOAN_AP`, `BORROWER_LOAN_AR` | Owner equity/drawings never masquerade as lender/borrower obligations |
| `EXPENSE_PAYEES` | None from identity alone | An expense payee becomes a payable only if separately recorded as an actual obligation |

Same real person can have multiple roles and multiple loan contracts. **Do not collapse amounts to one Party ID/Current Due**. Opening balances are historical; Cash Session controls apply only where source business policy requires them for current cash movements. If source signing/normal balance direction is unknown or contested, stop and obtain M02/M08 accounting review instead of guessing signs.

### Offline evidence contract (kept in approved private memory/storage)

```js
{
  sourcePlanReviewed: true, // evidence flag; NOT actual owner authorization
  identityReviewsPending: 0, // independent reviewed count
  source: {
    captureId: "SOURCE-ACCOUNT-001",
    capturedAt: "2026-11-17T07:00:00.000Z",
    sourceCommit: "29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2",
    accounts: [
      {
        sourceGroup: "CUSTOMERS",
        legacyIdDigest: "<64-lowercase-hex-private-original-ID-commitment>",
        accountKind: "CUSTOMER_AR",
        contractDigest: "<64-lowercase-hex-private-contract-commitment>",
        basis: "OPENING",
        currency: "BDT",
        balanceMinor: "-1200" // signed *minor* units; exact string, never float
      },
      // same account requires CURRENT basis too, with its own source value
    ]
  },
  d1: { /* independently captured isolated D1 readback; same schema */ }
}
```

The helper accepts inputs supplied by authorized adapters but **does not independently prove those inputs were actually captured**. Digest algorithms, canonical normalization, original physical row linkage, contract ID uniqueness and authorized readers must be independently reviewed and frozen by M02/M08. `legacyIdDigest` and `contractDigest` are private comparison commitments; do not publish original identifiers or raw commitments. No `party_id`-based summation is accepted as a substitute for original source IDs.

### Offline code execution (synthetic test-only; zero database writes)

```sh
node --test tests/m10-gross-party-reconcile.test.mjs
```

In an authorized **private** evaluation environment (not CI/logs), an approved adapter can supply the two strict evidence snapshots to `assessM10GrossPartyReconciliation` and only persist the aggregate, redacted `issues` result. Never paste row-level financial evidence or unredacted exceptions into a GitHub issue.

## 3. Discrepancy register and triage

The evaluator returns **only code and count**, plus booleans; a private reviewer investigates source IDs inside the isolated environment. Examples:

| Discrepancy | Private reviewer action | Severity |
|---|---|---|
| `GROSS_ACCOUNT_MISSING_D1` / `UNEXPECTED_D1` | Check original legacy ID/link and contract; identify dropped/duplicated identity or posting | Critical |
| `GROSS_ACCOUNT_DUPLICATE_SOURCE` / `D1` | Investigate one-to-many mapping, unsupported contract aggregation or duplicate import | Critical |
| `GROSS_OPENING_BALANCE_MISMATCH` | Check signed historical baseline, edited opening history, source numeric text, no current Cash/Bank event | Critical |
| `GROSS_CURRENT_BALANCE_MISMATCH` | Trace original ledger and any returns, payments, reversals, vendor AP/AR and loan history | Critical |
| `GROSS_ACCOUNT_BASIS_INCOMPLETE_SOURCE` / `D1` | Require both OPENING and CURRENT even when one is zero | Critical |
| `GROSS_SOURCE_PLAN_UNREVIEWED` / `GROSS_IDENTITY_REVIEWS_PENDING` | Resolve accountant-owned original ID and sign decisions without automated name/phone linking | Blocker |
| `GROSS_CAPTURES_NOT_ORDERED` / `NOT_DISTINCT` | Correct custody and independently reproduce source then D1 readback | Blocker |

For any critical difference: **NO-GO; preserve source, private evidence and staging backup**. Record the internal discrepancy reference, classification, affected original group (privately), investigator, root cause, signed resolution and rerun receipt. Never share private identities, amounts or unredacted digests in GitHub PRs, CI or public preview.

## 4. Sign-off matrix (unfilled until independently demonstrated)

| Gate | Required evidence | Responsible reviewer | Current |
|---|---|---|---|
| 49 source groups | Source-canonical rows, IDs/position, signed mapping, reconciliation receipts | M02/M10 | **Not verified** |
| Identity + account mapping | No unresolved posted obligations; opening/current account sign review | M02-P/M08 + accounting | **Not verified** |
| Private staged import | Repeatable import, fail/retry, discrepancy ledger, no critical drift | M03/M10 + owner | **Not verified** |
| Posting safety | Actual D1 replay, concurrency, rollback, exactly-once reversal for all transactional modules | M03/M04/M05–M08 | **Not verified** |
| Security | Actor/tenant authority, revocation, RPC protections and log secrecy | M04/M10 | **Not verified** |
| Performance | Approved p95/p99 Workers CPU and D1 budgets measured on sanctioned representative staging | M10/M11 | **Not verified** |
| Restore | Independent isolated backup receipt, restore and full readback checksum | M10/M11 | **Not verified** |
| UI/printing | Preserved mobile/desktop/browser/print evidence | M01/M09/M10 | **Not verified** |
| Owner GO | Linked independent security and accounting reviews, explicit written sign-off | Project owner | **Not verified** |

This checklist is not marked done by passing deterministic Node tests. Independent signed evidence is needed; **M10 acceptance and M11 production remain NO-GO**.
