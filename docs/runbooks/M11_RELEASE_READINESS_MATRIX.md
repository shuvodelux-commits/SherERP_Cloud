# M11 — Release-critical evidence and owner decision matrix

**Version:** prelaunch preparation, 2026-11-17. **Decision: NO-GO.** This document is a review aid, not a launch authorization, staging import procedure, synthetic proof of operational safety, or permission to change production infrastructure.

**Source-of-truth baseline at this review:** `shuvodelux-commits/SherERP_Cloud@bcd2d3adbd03f35612c50c1a144a472b1683b412`; frozen original `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. On the reviewed GitHub issues [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312) had **9/9 unchecked** acceptance items and [M11 #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306) had **10/10 unchecked** release items. Those are documentary gate statuses, not percentages of source code completed.

## Gate BP0 — Require actual GitHub main protection before release approval

**Observed 2026-11-17 at `main@7c81dca09f975fbda37586eb50c2763c7f8506df`: BLOCKED.** The read-only GitHub `GET /repos/shuvodelux-commits/SherERP_Cloud/branches/main` result reported:

```json
{
  "protected": false,
  "protection": {
    "enabled": false,
    "required_status_checks": {
      "enforcement_level": "off",
      "contexts": [],
      "checks": []
    }
  }
}
```

These are the relevant returned fields, not an independently signed configuration attestation. The repository-level rulesets API returned `[]`. The detailed `/branches/main/protection` endpoint returned `403 Resource not accessible by integration`, and this connector cannot inspect GitHub staging environment reviewer/branch restrictions. **Therefore the current PR review and full-CI-before-merge rules are not enforced by GitHub `main` branch protection.** Do not infer that staging environment protection is absent; that remains independently **UNVERIFIED**.

**Required owner/admin action:** In repository **Settings → Rules → Rulesets** (or **Settings → Branches**), establish and activate a branch rule that targets `main`. Require pull requests with reviewer approval, required stable status checks, resolved conversations, and a branch update policy consistent with the full exact-head CI gate. Disallow force pushes/deletion and unauthorized admin bypass; verify the chosen merge restrictions do not silently skip the mandatory existing Node, real Workerd/D1, source/accounting, security, UI/Playwright or preview-no-deploy checks. A passing static YAML check or voluntarily green PR is **not** an acceptable substitute. Repository settings require separate authorized administrator action; this documentation PR does not change them.

**Independent acceptance evidence:** From a privileged owner/admin session, record only non-sensitive proof that `main.protected === true`, required PR approval and status checks are **enforced**, and actual current required checks match reviewed Actions jobs; inspect the GitHub `cloudflare-staging-db` environment's required reviewers, allowed branches and secret permissions separately. Preserve evidence references and reviewer decision outside sensitive logs. Recheck after ruleset updates, and do not assume GitHub mergeability alone means the rule is working. Mark this gate clear only after independently verified, owner-reviewed settings enforcement; **M10 and the ten original M11 acceptance gates remain separate**.

## The critical path: what must actually happen next

**PARALLEL PREPARATION READY / SHARED TRANSACTION WRITES BLOCKED** remains authoritative in [M03 readiness](../M03_PARALLEL_READINESS.md), [parallel execution rules](../PARALLEL_EXECUTION.md) and [coordination #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456). The M11 CI-preflight work [#465](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/465), [#470](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/470) and [#475](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/475) is integrated on main. Those controls check source-only preview/CI safety and a reviewed staging workflow; they do not read the Cloudflare account configuration or prove an active financial ERP.

| Order | Workstream / decision owner | Required deliverable and independently verifiable evidence | Stop condition / what cannot be inferred |
| --- | --- | --- | --- |
| 1 | M02 / source and accounting reviewers; M03 schema integrator | Reviewed **all 49 original source groups**, exact original IDs or physical row positions for id-less LOGS, date/money text, soft-delete history; source-to-D1 mapping and separate customer/supplier advances, vendor AP and AR, owner equity, lender/borrower contracts; quarantined identity conflicts | No auto-merging by phone/name and no net Party balance standing in for gross accounts; source mapping drafts are not import parity |
| 2 | M03 shared integrator + M04 authority owner | A reviewed **versioned internal G1 writer contract** with SQL-level current session/role/actor checks and source identifiers/receipts in the **same** atomic mutation; tests with disabled/revoked user, stale authority, concurrent retries, wrong actor, failed SQL and zero-row CAS | [M03 G1 inventory](../M03_G1_INTEGRATION_HANDOFF.md) is marked review-only and synthetic local D1 tests do not establish a production writer or permission to expose public RPC |
| 3 | M05 → M06 → M07/M08 → M09, coordinated by M03 | Reviewed purchase/stock FIFO + Tiles Box/Pcs/Sqft, complete POS split payment and Cash Session, original-lot returns/reversals, role-separated cash/bank/loan accounts, reports and preserved invoice/print parity; realistic real local Workerd/D1 + browser evidence linked by **current reviewed interface version** | No partial posting, cash-session bypass, duplicate effects, stock drift, unauthorized write or duplicate correction engine; no downstream live writer until dependency contracts are frozen |
| 4 | M10 data custodian + owner | Explicit authorization for private source export, protected USERS/ROLES process, immutable source snapshot and SHA-256 provenance, restricted access/retention and two-read or supervised freeze semantics; no source data or secrets published to GitHub | [Protected export runbook](./M04_PROTECTED_STAFF_EXPORT_AND_CUTOVER.md) is draft; do not extract customer/staff data without separate authorization |
| 5 | M10 staging/recovery operator + independent accounting reviewer | **Approved private staging** full import, frozen 49-group source/D1 readbacks, original-ID/position links, gross accounts, FIFO lots and monetary precision; repeat import, idempotency, zero unexplained critical discrepancies; real restore and post-cutover write-replay rehearsal | Offline mock checkers, locally generated synthetic evidence and a green CI build never prove private staging reconciliation or recoverability |
| 6 | M10 security/performance owner + approvers | Actual source representative user flows, authentication/permissions security review, Workers CPU/D1 query usage, observed p95/p99 and printer/browser tests against separately **approved** budgets; signed independent accounting/security acceptance | The M10 offline performance manifest checker only interprets supplied samples; it does not collect or authenticate Cloudflare metrics |
| 7 | M11 release owner + legacy/Cloudflare operators | Written production GO **only after M10 signoff**, named change operators, scheduled window in Asia/Dhaka, source SHA + final snapshot hash, legacy write-freeze and one-authoritative-writer plan, recent D1 recovery bookmark and deployment/rollback control | No remote D1 import, production binding, traffic switch, GAS source freeze, public auth/RPC or two simultaneous writable ledgers before separately approved execution |
| 8 | M11 release/financial/operations reviewers | Real private deployment smoke of authenticated POS/purchases/returns/finance/reports/printing; monitor Worker/D1 errors, source writes, replay receipts, gross Party accounts and stock; verify traffic rollback **and disposition of every acknowledged post-cutover write** | Neither a successful health check nor a reverted DNS/route is proof that transactions can safely resume on the legacy GAS system |
| 9 | M11 owner / business operations | Signed inventory, finance, security, backup custody, on-call alerting, service handover and retention; links to immutable *private* evidence records, not customer rows or credentials | Until approval and recovery proofs are validated, retain NO-GO and keep the legacy source unchanged |

### The ten original M11 acceptance items — status and evidence required

All statuses below are **BLOCKED / NOT VERIFIED** at this reviewed SHA. This is an evidence register mapped to [issue #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306); it does **not** change or tick those issue checkboxes.

| #306 item | Required independent evidence (private unless metadata-only) | Owner / prerequisite |
| --- | --- | --- |
| 1. M10 signed staging rehearsal | Signed M10 49-group, gross-account, stock/FIFO, auth/performance and discrepancy acceptance | M10 #312; M02–M09 integrated |
| 2. Private export and credentials | Scope, retention, encrypted custody, operator authorization and source/role provenance | Owner + M04 + M10 |
| 3. Staging recovery drill | Real backup/bookmark, restore readback, acknowledged-write replay and divergence reconciliation | M10 + independent reviewer |
| 4. Change window and operators | Exact maintenance time **Asia/Dhaka**, incident owner, freeze/recovery contacts, allowed downtime | Release owner |
| 5. Single-writer source freeze | Legacy writer authority fenced, independent double-read/hash, D1 pre-import point recorded | Legacy + M11 operators |
| 6. Final import/reconciliation | Real D1 row/ID/position counts, Party account gross balances, lots, receipts, zero unexplained drift | M02/M03 + M10 |
| 7. Separate production GO | Signed owner deployment decision, M04 live authority and public-preview isolation | Owner after M10 |
| 8. Private business smoke | Auth/RBAC, POS/split tender, purchase, returns, cash/bank, reports and original invoice/printing | M01, M04–M09 + M11 |
| 9. Rollback and new writes | Route rollback **plus** exactly-once disposition of all committed/acknowledged D1 operations; prove no split brain | M03/M07/M08 + M11 |
| 10. Final handover | Backup custodian, continuous alert ownership, incident contacts, accounting and owner acceptance | M11 + owner |

## Release decision procedure — fail closed

1. **Before a change window**, confirm all parents are merged into GitHub `main` (not just another feature branch). Record each accepted interface/version, its exact commit SHA, test runs, original source provenance, reviewer and remaining limitations. Do not fill missing fields with guessed values.
2. The release owner reviews [M03 G1 integration](../M03_G1_INTEGRATION_HANDOFF.md), [M03 readiness](../M03_PARALLEL_READINESS.md), [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312), [M11 #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306), and the full [M11 cutover runbook](./M11_PRODUCTION_CUTOVER.md). **If any one of the underlying source, accounting, auth, concurrency, data custody, real restore, performance or cutover-authority proofs is absent or disputed, remain NO-GO.**
3. Keep raw exports, staff evidence, secrets, operator contacts, financial rows and sensitive logs in a **privately access-controlled** evidence store; GitHub may contain only non-sensitive identifiers and links approved by the custodians. Distinct reviewers independently verify authenticity of evidence rather than accepting an attacker-created `status:verified` or synthetic manifest.
4. Only after explicitly separate owner permissions may operators propose the actual snapshot/freeze, remote staging/production D1 operations, Worker binding and traffic sequence. The approval must name the production target and **not** reclassify the public `shererp-cloud-preview` Worker or PR previews as production.
5. For rollback: fence D1 writes; reconcile committed and acknowledged D1 operation IDs, source ID/high-water marks, account-specific obligations, lots and refunds; review the replay plan and approve **one** resumed writer. A route switch without disposition of new D1 writes remains a held incident.
6. For activation: confirm no legacy commits after freeze, private smoke and monitoring under on-call supervision. On unexplained critical ledger/stock/identity drift, auth acceptance of an untrusted actor, loss of receipt provenance, or backup/restore uncertainty, **stop**, keep the writer boundary fenced and escalate to the named incident owner.

## Evidence index / responsibilities

- **Source schema, Party identity, original ledger basis:** [M02 #24](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/24), [ADR-007](../architecture/ADR-007-unified-party-relationships.md), [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312).
- **Shared DB, source ID and atomic posting:** [M03 #22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22), [M03 G1 handoff](../M03_G1_INTEGRATION_HANDOFF.md); shared DB/schema/RPC changes remain solely M03-owned.
- **Staff authority inside SQL, session revoke and source credential cutover:** [M04 #23](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/23), [M04/M03 atomic authority #252](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/252).
- **Core behavior and reports:** [M05–M07 #314](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/314), [M08 #66](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/66), [M09 #431](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/431).
- **Data rehearsal, performance, restore:** [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312).
- **Deployment/rollback/no-dual-writer:** [M11 #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306); full [cutover/rollback runbook](./M11_PRODUCTION_CUTOVER.md); deployment audit `scripts/m11-ci-deployment-ownership.mjs`.
- **Parallel ownership and shared-file reservations:** [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456), [PARALLEL_EXECUTION](../PARALLEL_EXECUTION.md).

**Scope of this document:** One M11-owned offline runbook, zero new executable code, zero SQL/RPC/Worker/CI/config changes, zero source-copy transforms, and zero remote data access. Documentation-only tasks are exempt from artificial RED tests but not GitHub review and full PR CI. Revise this matrix only after the underlying links provide new evidence; never mark a live operational gate passed from code presence alone.
