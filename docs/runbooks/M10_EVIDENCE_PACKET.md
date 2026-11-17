# M10 evidence packet — private staging/reconciliation operator runbook

**Status: NOT EXECUTED. Preparing deterministic checks; NO production GO.**
**Issue:** [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312).
**Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Coordinator:** [M01–M11 board #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).
**No credentials, private spreadsheet exports, original IDs, Party amounts or unhashed records belong in GitHub, CI or a public Cloudflare preview.**

## 1. What this tool does and does not do

This preflight composes **existing** M10 checks; it never takes a real snapshot, imports a group, authorizes D1 SQL, mutates Sheets, posts money, modifies worker bindings or performs backup/restore.

| Evidence key | Existing evaluator | What a candidate means | What it does NOT prove |
| --- | --- | --- | --- |
| `rehearsal` + `restore` | `assessM10RehearsalRestoreChain` (M10-01/12) | 49 supplied frozen source summaries match D1 and the supplied backup/restored readbacks, authentic IDs vs physical LOGS position | Source custody, actual D1 import or actual restore |
| `gross` | `assessM10GrossPartyReconciliation` (M10-14) | Original-ID sourced 12 M02 account kinds match independently, six source domains attested | True identity review, account sign/contract correctness or accounting signoff |
| `performance` | `assessM10PerformanceBudget` (M10-13) | Explicit supplied p95/p99, CPU and D1 cost limits match supplied samples | Representative private data, genuine Workers metrics, agreed review thresholds or measured production latency |
| *Packet* | `assessM10EvidencePacket` (M10-15) | All three candidates passed, identity-review count agrees, Party evidence captures are not after the backup | Signed M10 acceptance, security compliance, actual replay/concurrency, safe release |

**Critical:** A complete synthetic packet has `candidateEvidenceComplete:true`, but **always**
`authorizesImport:false`, `authorizesPosting:false`, `authorizesRestore:false`,
`authorizesCutover:false` and `productionReady:false`.
It must never be presented as evidence that production data was migrated or independently reviewed.

## 2. Prepare source and D1 evidence separately

1. Obtain **specific written permission** from the owner for the original private source snapshot, isolated private staging D1 and authorized operator. Store capture permissions, consent, credentials, retention boundaries and backup manifests in protected private storage only.
2. M02/M02-P reviewers must freeze the exact 49 original groups, source IDs (legacy `LOGS` is physical-position-only), original row order, deletion history, date/amount normalization and Party identity decisions. An unresolved identity on a posted obligation is a blocker.
3. M03 single integrator must provide a real independently captured local/private D1 readback of the source-shaped rows, ID/position hashes and schema migration revision; no separate M10 posting engine or independent remote D1 migration is allowed.
4. M08 accounting reviewers must verify gross account direction and customer/supplier advances, vendor AP vs AR, owner equity vs advance, lender loan payable/credit and borrower loan receivable/credit for the original source IDs. Historical openings must not become today's Cash Book, Bank Book or Cash Session activity.
5. Capture *separate* immutable source-freeze passes, imported D1 summaries, isolated backup and isolated restored-readback receipts. The actual backup/import/restore operation is explicitly **outside** this tool; follow M11 operational restrictions and owner staging authorization.
6. Set explicit, reviewed performance workloads/limits using representative sample size and independently measured latency, Workers CPU, D1 queries/rows read. All synthetic or self-declared values remain supplied claims.
7. Supply the four evidence keys in one private JSON file with each module's reviewed format; never manually invent source commits, group hashes, identity links, reader version or review provenance.
8. The packet additionally checks that `rehearsal.pendingIdentityReviews` equals `gross.identityReviewsPending`, and that both gross captures precede or coincide with the backup capture they purport to validate.
9. Record private provenance links and the IDs of independent reviewers for security, accounting, operational replay/rollback, and UI/browser print. These are **not present** in the packet result and cannot be marked done by this script.

### Packet shape

```js
{
  rehearsal: { /* M10-01: full 49-group source/D1 + stable source-freeze evidence */ },
  restore: { /* M10-11: distinct backup+restored captures and isolated drill receipt */ },
  gross: { /* M10-14: separate original-ID M02 gross source/D1 checkpoints */ },
  performance: { /* M10-13: explicit reviewed workload budgets + raw per-request samples */ }
}
```

The packet does **not** accept a `productionReady`, `approved`, `reviewer`, private source row, or any other extra top-level field. It never reinterprets a `candidate` as a signed authorization. Use the respective M10 module tests for synthetic example shapes, not as proof of actual data.

## 3. Local-only command (not in CI with real business data)

```sh
node --test tests/m10-evidence-packet.test.mjs tests/m10-evidence-packet-cli.test.mjs

# Only after separate source/privacy approval, on an authorized isolated host:
node scripts/m10-evidence-packet-check.mjs /private/authorized/m10-evidence-packet.json
```

The CLI permits **exactly one local regular JSON file** (up to 64 MiB) and uses a no-follow file open to prevent symlink traversal. It has no D1/cloud network client, no export/download facility and writes nothing.

**Exit 0:** all supplied offline candidate checks agree. Not a GO decision.
**Exit 2:** one or more missing/mismatched/blocked checks, or malformed/inaccessible evidence.
For valid data it prints only redacted candidate flags and fixed issue code/counts. For parsing/input errors it prints a single fixed redacted error without the file path or data. Do not upload the input or raw CLI environment logs into GitHub.

## 4. Private discrepancy ledger and remediation

| Packet issue | Remediation owner | Required follow-up |
| --- | --- | --- |
| `PACKET_CHAIN_EVIDENCE_MISSING` / `NOT_READY` | M02/M03/M10 | Reconcile all original 49 groups, original IDs/LOGS physical positions, source freeze and backup/restore checks with independent captured input |
| `PACKET_GROSS_EVIDENCE_MISSING` / `NOT_READY` | M02-P/M08/M10 | Review exact source account kinds, signed historical opening/current balances, original identity links, Party gross obligations, and zero unresolved posted identity records |
| `PACKET_PERFORMANCE_EVIDENCE_MISSING` / `NOT_READY` | M10/M11 | Agree numeric p95/p99, CPU and D1 budgets and measure on a real representative isolated staging environment |
| `PACKET_IDENTITY_REVIEW_COUNT_CONFLICT` | M02-P / accountant | Revisit inconsistent identity-review queues for the two separately supplied sources; forbid posting |
| `PACKET_GROSS_CAPTURE_AFTER_BACKUP` | M03/M10 | Independently recapture gross source and D1 checkpoint evidence before the backup they are intended to support |
| Any invalid-evidence error | Independent reviewer | Validate schema, original source pin, private capture custody and malformed JSON without exposing the input |

Each discrepancy remains a **NO-GO**. Privately record the discrepancy reference, count, severity, affected original group/account, private investigation owner, signed resolution and repeat-run receipt. Only code/count and status without sensitive values belongs on public coordination issues.

## 5. M10 acceptance sign-off (none automatically completed)

| Full M10 issue #312 gate | Required independently observed evidence | Gate at authoring |
| --- | --- | --- |
| All 49 source groups | Real original snapshot, canonical imports, source ID/row mapping and zero critical drift | Not verified |
| Immutable source custody | Authorized private snapshot, source pin, checksums and independent capture receipts | Not verified |
| Private D1 staged import | Actual repeated/dry-run import, reconciliation ledger and idempotent D1 readback | Not verified |
| Gross Party accounts | Independent accountant and M02/M08 signed source-ID + opening/current gross balance review | Not verified |
| Real D1 transaction safety | Retry, stale/concurrent writes, rollback and exactly-once reversal on actual local D1 | Not verified |
| Security and privacy | Verified staff/tenant authority, revoked users, RPC/CSRF/rate controls, preview and log isolation | Not verified |
| Performance + UI | Reviewed p95/p99 Workers CPU, D1 query/rows budgets, original browser/mobile/print baselines | Not verified |
| Isolated recovery | Actual private backup/restore and full readback after recovery | Not verified |
| Independent and owner signoff | Security reviewer, accountant and written owner GO | Not verified |

**Release decision remains NO-GO** until every requirement is independently evidenced and explicitly signed. Production should not be cut over from this runbook or any packet result.
