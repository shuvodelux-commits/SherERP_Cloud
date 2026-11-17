# M11 — SherERP production cutover, monitoring and rollback

**Status: DRAFT — NOT APPROVED FOR LIVE LAUNCH.** Tracking [M11 issue #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306). Read `AGENTS.md`, `docs/WORKSTREAMS.md` M10/M11, `docs/MIGRATION_PLAN.md`, `docs/runbooks/M04_PROTECTED_STAFF_EXPORT_AND_CUTOVER.md`, ADR-007 and the M11 Superpowers plan first.

**Release gate crosswalk:** [M11 release-critical evidence matrix](M11_RELEASE_READINESS_MATRIX.md) maps the ten issue #306 gates to M03/M04/M10 prerequisites, actual operator evidence and stop conditions. It is a **NO-GO preparation reference**, not cutover permission.

## Current deployment boundary

- `main` automatically publishes only the **inert, D1-free** `shererp-cloud-preview` shell using Cloudflare Workers Builds. Its `/api/health` response is `foundation / not-connected`.
- PR Workers Previews remain isolated and must have **no production/staging D1 or mutable source bindings**.
- `wrangler.staging.jsonc` references the separately gated staging database; this is not a production binding and does not authorize real customer data import.
- There is **no approved production D1 cutover, Worker routing plan, staff export or complete M10 signed report** in this runbook. This first M11 PR performs no deployment, mutation, release-secret access or live data inspection.
- For current work, do not point the old GAS or Google Sheets at Workers, do not enable incomplete RPC routes and do not modify original source records.

**Pre-Gate BP0 — GitHub release-control-plane protection:** The [M11 evidence matrix](M11_RELEASE_READINESS_MATRIX.md#gate-bp0--require-actual-github-main-protection-before-release-approval) records a 2026-11-17 actual GitHub API finding: `main.protected=false`, required status checks not enforced. Before accepting release GO, the repository administrator must activate and independently verify a protected `main` PR/review/status-check rule and inspect staging environment approval rules. This is separate from full CI passing voluntarily and does not authorize production or remote D1. See [M11 issue #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306) for the dated evidence. No branch setting is changed by this runbook.

## Gate 0 — Decide release authority before any live action

**GO requires owner review of signed M10 acceptance evidence** for complete 49-group source mapping, row counts/IDs, FIFO/OVERSOLD stock, all gross Party accounts (including advances, owner equity and loans), returns, balances, cash/bank, invoices, permissions, original UX/printing, security and p95/D1 budgets. Zero unexplained critical discrepancies, no unresolved identity links on posted obligations, and a successful realistic staging rehearsal are mandatory. Source protected USERS/ROLES export and credential handling require separate explicit authorization.

Record outside public GitHub: operator and backup custodian, release commit + pinned source commit, cutover time in **Asia/Dhaka**, source freeze start/end and acknowledgment from all writers, max outage, decision maker, recovery on-call, private incident bridge, D1 Time Travel retention/budget and the exact response for new writes after the switch. Owner must approve planned routing and single-writer authority. **Any missing gate = NO GO.**

### Offline documentary check (not proof of actual completion)

`scripts/check-m11-release-evidence.mjs` checks a separately stored, metadata-only manifest for allowed fields, release SHA, frozen source SHA and phase-specific evidence IDs. It never deploys or accesses D1, cannot authenticate an external approval and cannot turn a structurally complete manifest into cutover authorization.

```sh
node scripts/check-m11-release-evidence.mjs /private/path/m11-evidence.json <exact-40-hex-release-commit> prepare
node scripts/check-m11-release-evidence.mjs /private/path/m11-evidence.json <same-release-commit> switch
node scripts/check-m11-release-evidence.mjs /private/path/m11-evidence.json <same-release-commit> handover
```

Do not commit the private manifest, snapshots, salts, password hashes, customer/staff data, token values or backup payloads. Each `checks` entry uses only `{ "status": "verified", "record": "audit/approved-reference", "releaseSha": "<exact-target-commit>" }`; `record` is a short **non-sensitive identifier**, not a URL or embedded evidence. `sourceSnapshotSha256` is required from switch onward. Verification means a named authorized human has checked the underlying private evidence; the script validates syntax only. Never edit metadata to force a pass.

## Gate 1 — Prepare and rehearse (before freeze)

1. Finish M10 private staging import, same-version migrations, full source-to-target reconciliation and signed review. Prove two independent source snapshots/exports agree where required; resolve rejected mappings rather than silently merging Parties.
2. On an isolated environment, rehearse *both* D1 restore/rollback **and** every post-cutover write disposition (replay, reject or roll-forward), including failed/duplicate submissions, post-restore idempotency IDs and ledger/lot reversals.
3. Verify M04 real auth and RBAC, all authorized RPCs, staff password/session upgrade policy, login throttle, last Administrator protection and permission revocation. No anonymous writes and no reliance on UI-only permission.
4. Freeze a release SHA and check all required GitHub CI, real Workerd/D1 and Playwright results for **that exact SHA**; no claim that synthetic tests prove production parity.
5. Verify **separate** production Worker name/routes, D1 DB ownership, environment secrets, least-privilege permissions, safe migration plan, backup retention, observability and deployment ownership. A later separately reviewed PR must create/approve this production configuration; NEVER add D1 to public PR previews.
6. Assign named go/no-go authority, maintenance notice and write-freeze communication; document threshold for abort and how to contact support.

## Gate 2 — Source freeze, final import and switch (separate owner approval)

1. Announce maintenance window; disable **all** legacy GAS/Sheets writing entry points (app clients, scripts, triggers, automation, offline terminals) and verify a stable write counter, source version and last operation timestamp. Preserve legacy as read-only.
2. Take the final private, immutable source snapshot, record SHA-256 and original source IDs/row counts per group. Verify protected staff export separately under M04 controls; do not log or commit exports.
3. Capture and independently verify the target production D1 pre-import restore/bookmark or backup. Confirm target is correct and no concurrent writers exist. Stop if schema/version or DB identity differs.
4. Import into the approved target under a single-writer plan, guarding duplicates and each financial invariant in the DB transaction boundary. Perform complete final source-vs-D1 reconciliation for every in-scope group, per-account Party obligations, exact inventory FIFO lots, accounting balances and source operation IDs.
5. **STOP on any unexplained discrepancy, missing staff mapping or broken write-replay plan.** Keep old system read-only during investigation; do not attempt dual writes.
6. Present release SHA, frozen-source checksum, import manifest, reconciliation report, recovery bookmark and previous-phase approval to the owner. Require **new, explicit GO** to route clients to production Worker/D1. Do not treat automatic merge/build of `shererp-cloud-preview` as this GO.
7. After approved routing change, limit initial access if feasible; verify authenticated staff roles, navigation, cash-session policy, product read, purchase, POS, split payment, stock, returns/corrections, cash/bank, original invoice printing and report totals. Use controlled, reversible smoke transactions and reconcile their exact IDs and monetary effects.

## Gate 3 — Monitor, reconcile and hand over

- Capture release/deployment IDs and non-sensitive correlation IDs; monitor Worker 4xx/5xx, failed logins/permission denials, D1 errors, p95 latency, CPU/quotas, duplicate operation IDs, pending/rejected posts, stock deficit, finance reconciliation drift, and source write-freeze integrity.
- Set alert owners, severity thresholds, escalation channels and scheduled balance/stock reconciliation. Never include PII, credentials, complete invoices or SQL parameter values in public logs.
- Retain legacy source read-only until explicitly approved retirement, with original immutable backups and dated retention obligations.
- Complete post-cutover source/target write-boundary audit, report business signoff, support instructions and acknowledgment by the owner.

## Rollback — no silent loss or split-brain

**Trigger:** auth/permission bypass, incorrect account/stock postings, unresolvable import mismatch, unbounded failures, missing recovery evidence or owner incident decision.

1. Immediately **freeze new Worker/D1 writes** and prevent stale clients/offline queues from retrying. Preserve the exact D1 release bookmark, write log, committed operation IDs and separately captured post-cutover transaction delta. Record the last successfully acknowledged write.
2. Do **not** simply change DNS/route back to GAS if any production D1 write has committed: the legacy Sheets will not include those entries. A blind rollback loses sales, returns, money movements and stock updates.
3. Compare D1 committed write IDs to source freeze manifest and acknowledged client requests. Choose, with owner signoff, either **(a)** reviewed, idempotent replay of every valid new D1 write into restored legacy authority using verified semantics, or **(b)** Worker read-only incident mode and controlled roll-forward repair. Block write routing until reconciliation is exact and permission/session policy is safe.
4. A D1 Time Travel restoration can erase newer writes. Export and independently preserve the delta before any restore and confirm replay or permanent preservation. No restore without documented data-loss analysis, maintenance stop and explicit owner decision.
5. Test the selected target and its rights, balance reconciliation, user sessions, operation ID deduplication and client caches before any traffic rollback; keep **exactly one authoritative writable system**.
6. Record incident timeline, restored version/source checksum, unresolved obligations, final write disposition, audit reports, and owner approval for reopening transactions.

## Final owner handover

Capture approved live Worker URL, exact deployed SHA, D1 database ID (privately), backup/restore SOP, incident contacts, freeze/resume procedure, monitoring dashboard, smoke-test evidence, reconciled starting balances and support runbook. Mark M11 DONE **only** after source preservation, recovery rehearsal, production business workflow evidence and owner handover are independently verified. Until then, this document is an operational design, not proof of launch.


## M11-02 — Offline post-cutover write-delta completeness review

**This is an evidence-review aid, not a replay engine or switch permission.** A restoration of D1 or routing back to GAS after even one committed Worker/D1 write could silently lose sales, return movements, cash and bank entries, or stock changes. Before any such decision, an authorized operator must privately extract a D1 committed-operation journal and independently capture acknowledged request IDs. Neither private payload nor any identifying values belong in GitHub.

**Metadata-only schema (synthetic illustrative values, never customer/source data):**

```json
{
  "schemaVersion": 1,
  "releaseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "sourceSnapshotSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "mode": "resume-legacy",
  "freeze": {
    "legacy": {"status":"verified","record":"audit/legacy-freeze","releaseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    "d1": {"status":"verified","record":"audit/d1-freeze","releaseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
  },
  "checkpoints": {
    "committed": {"count":1,"record":"audit/d1-commit-log","releaseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
    "acknowledged": {"count":1,"record":"audit/client-acks","releaseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
  },
  "writes": [
    {"operationId":"synthetic/001","canonicalDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
  ],
  "acknowledgments": ["synthetic/001"],
  "dispositions": [
    {"operationId":"synthetic/001","action":"replayed-to-legacy","canonicalDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","record":"audit/replay-one"}
  ]
}
```

Save real metadata **only in a private, access-controlled location** with separate source journal and reconciliation evidence. Run:

```sh
node scripts/check-m11-write-delta.mjs /private/m11-delta.json <release-commit-sha> <final-source-snapshot-sha256>
```

- Both legacy and Worker/D1 writes must already be frozen, separately verified and pinned to the release commit. The submitted checkpoints must come from operator-reviewed committed and acknowledged journals.
- A committed operation requires **exactly one** disposition and a matching canonical operation digest; missing IDs, duplicate operation IDs, unknown acknowledgments, mismatched counts and changed digests block the review.
- `mode: "resume-legacy"` requires every operation classified `replayed-to-legacy` with private evidence of **actual confirmed replay**, per-account/stock reconciliation and safe idempotency; `mode: "roll-forward"` requires every operation classified `retained-on-d1` while legacy remains read-only.
- A zero-write delta requires a verified independent zero-count committed checkpoint, zero-count acknowledged checkpoint and both freeze records, rather than a blank manifest.
- The structural validator does **not** query source/D1, verify the journal is complete, compare actual replay effects, check a live backup, prove source permission safety or authenticate an owner. A green result is **not** authorization to switch routes, resume writes or restore D1. Require a real rehearsal, separate M10/M11 owner approval and human review of the private artifacts before any operational step.


## M11-03 — Offline cutover sequence rehearsal

M11 has three reviewed **documentary event sequences**: `activation` (complete activation/smoke), `rollback-to-legacy` (replay and resume legacy) and `hold-d1-readonly` (controlled D1 incident hold). This check is not a production controller; it cannot freeze either live writer, read Cloudflare/Sheets, operate routing or assert the authenticity of supplied evidence.

Prepare a strictly metadata-only private JSON document with `schemaVersion: 1`, `releaseSha` (exact approved target commit), `sourceSha` (frozen original commit), `sourceSnapshotSha256` (final source export digest), `path` and ordered `events`. Each event has `{ "seq": 1, "event": "legacy-writes-frozen", "record": "audit/source-freeze-001", "releaseSha": "<release-commit-sha>" }`. Every record must refer to a separately retained, verified private artifact; never include real source records, customer details, passwords, credentials, invoice payloads or exports in the JSON.

The approved order is defined by `M11_CUTOVER_EVENT_ORDER` in `scripts/check-m11-cutover-order.mjs`. The validator cross-checks the release manifest accepted by `assessM11Evidence(... phase: 'switch')`. For emergency rollback and D1 read-only hold, it also requires a `assessM11WriteDelta`-accepted private write-delta artifact matching the same release and source-snapshot digest. `rollback-to-legacy` requires `resume-legacy` dispositions; `hold-d1-readonly` requires `roll-forward` dispositions.

```sh
node scripts/check-m11-cutover-order.mjs /private/m11-order.json /private/m11-release.json \
  <release-commit-sha> <final-source-snapshot-sha256> [ /private/m11-delta.json ]
```

The CLI uses the repository-pinned source SHA, emits only fixed blocker codes and **never** makes a launch decision. A structurally complete review record does not demonstrate that actual freezes, snapshots, migrations, reconciliation, approvals, replay or traffic changes occurred. A real M10 rehearsal, source-data custody, human verification of event chronology, and separately authorized production GO remain mandatory.


## M11-04 — Production candidate isolation and health preflight

**Current NO-GO:** `wrangler.jsonc` has **no production D1 binding**, and `src/index.js` currently returns `{"status":"foundation","service":"shererp-cloud","database":"not-connected"}` from `GET /api/health`. Workers Builds publishing the preview Worker from `main` is not evidence that a D1-connected ERP is deployed, and no source GAS/Sheets migration may be triggered on this basis.

Before a separate owner-approved production deployment configuration is proposed, review its *private candidate config*, **actual observed** release health, exact preview/staging configs and the M11 prepare-phase evidence references together. The offline validator `scripts/check-m11-production-candidate.mjs` must refuse:

- the existing `shererp-cloud-preview` identity, staging Worker identity or re-use of the staging D1 database name or UUID;
- public workers.dev exposure, preview resource bindings, missing/extra D1 binding, unsupported config keys (including premature routes), or changed original asset routing;
- an observed `foundation/not-connected` response, stale deployed release SHA or missing independent M10 owner-signoff record.

Run **only on operator-reviewed local files**; do not commit production credentials, private evidence payloads, staff/customer exports or cloud tokens:

```sh
node scripts/check-m11-production-candidate.mjs \
  /private/proposed-production-wrangler.json \
  /private/reviewed-production-health.json \
  /private/m11-release-evidence.json \
  <exact-reviewed-release-sha>
```

This is intentionally **not** a production deployment tool, proof of real health authenticity, permission to create/bind D1 or GO to switch routing. A syntactically valid, synthetic candidate can pass document completeness while real M10, auth/security/financial parity, operator review and owner approval remain absent. Never add production D1 resources to `wrangler.preview.jsonc`, `previews` or the connected public preview Worker.


## M11-05 — Operator-reviewed monitoring and incident severity (offline only)

The post-cutover monitoring gate is a **rehearsal/evidence triage function**, not an active Cloudflare alert or production authority. Before production launch, the owner must separately verify that real Worker, D1, source-freeze and financial reconciliation monitoring is configured, tested, staffed and accessible to the incident operator. Every actual observation must come from a private, authenticated source; a syntactically valid JSON file is not proof of complete telemetry.

`scripts/check-m11-monitoring.mjs` accepts one private, metadata-only JSON object with the **exact** fields `schemaVersion:1`, `releaseSha`, `sourceSnapshotSha256`, `window`, `thresholds`, `observations` and `metrics`. The window holds UTC `startedAt`/`endedAt` timestamps and may cover no more than 24 hours. Operator-signed and independently retained `thresholds` have `http5xxRateBps` (0–10000), `workerP95LatencyMs` (positive milliseconds ≤60000), `status:"verified"`, a non-sensitive `record` ID, and the exact `releaseSha`. Observation IDs are `worker`, `d1`, `financial`, `inventory`, `legacy`, `operation`, with `reviewStatus:"verified"` and `releaseSha`; each points to separately protected evidence, never a URL or secret.

The `metrics` are nonnegative, safe-integer aggregates:
`workerRequests`, `worker5xx`, `workerP95LatencyMs`, `d1Errors`, `unauthorizedAcceptedWrites`, `duplicatePostingEffects`, `grossLedgerDiscrepancies`, `inventoryDiscrepancies`, `legacyWritesAfterFreeze`, `unreconciledAcknowledgedOperations`.

Run privately against the independently reviewed release and frozen legacy source-snapshot checksum:

```sh
node scripts/check-m11-monitoring.mjs /private/monitoring-window.json \
  <exact-release-sha> <final-source-snapshot-sha256>
```

The script prints only fixed result and blocker codes—**never** metrics payloads, transaction IDs, invoice details or staff/customer data. Severity is deterministic:

- **`INSUFFICIENT_EVIDENCE`:** Missing/invalid/unreviewed observation, release or checksum mismatch, invalid counts, missing traffic denominator, unknown schema fields or invalid monitoring window. Stop the release/handover decision and obtain real evidence.
- **`INCIDENT_HOLD`:** Any accepted unauthorized write, duplicate monetary posting, gross account mismatch, stock mismatch, post-freeze legacy write, unreconciled acknowledged operation or D1 error. Inform incident authority, immediately investigate write safety, preserve IDs and journals privately; use the *separately approved* write-freeze/recovery procedure, never let the check itself reroute traffic.
- **`ESCALATE`:** Owner-approved HTTP 5xx error-rate or Worker p95 budget is exceeded without a higher-severity breach. Page the named on-call, investigate impact and escalate further on failed financial/stock checks.
- **`OBSERVE`:** All supplied metadata is structurally complete and no supplied metric exceeds limits. This is **not** evidence that real telemetry, alerts, source freeze, M10 financial parity, service auth or production deployment is functioning.

A single monitoring window never proves ongoing safety, incident response readiness or GO. Preserve complete private logs, define live alert routing and thresholds independently, run ongoing source/D1 reconciliation, rehearse the incident communication tree and require owner business acceptance before considering M11 handover.


## M11-06 — Public preview Worker no-write runtime CI gate

The existing connected `shererp-cloud-preview` is deliberately **not** a production ERP. In addition to verifying the DB-free Wrangler configuration, each GitHub PR now runs `node scripts/check-m11-preview-runtime.mjs` in the no-secrets preview validation workflow. This uses a **local in-process Worker**, synthetic HTTP requests, mock static assets and a trap that records every attempted environment-property access other than `ASSETS`. It does not contact Cloudflare, GAS/Sheets or a real D1 database.

The smoke probes `GET /api/health` for `foundation/not-connected`, confirms public login remains unavailable and selected product, sale, purchase, return, bank, stock and cash-book RPCs return controlled non-success responses, and checks malformed RPC, GET-only RPC refusal, unknown API paths, headers and static-asset fallback. Any business RPC success, unexpected health readiness claim, use of unbound DB/secrets or preview binding drift fails PR CI with a fixed blocker code. The test is also regression-tested against synthetic intentionally unsafe Worker mutants.

This makes accidental preview activation more visible at **merge time**, without changing the deployment owner, Worker code or production routing. It is not exhaustive security testing and cannot certify Cloudflare dashboard settings, actual remote previews, production D1, authentication, source data reconciliation or owner GO. Production ERP enablement must occur only through a separately reviewed, non-preview release with completed M10 staging evidence and a formally authorized cutover.


## M11-07 — Complete pinned source-RPC refusal in public previews

M11-06 tested a representative subset of preview RPC calls; **M11-07 extends that existing PR-only smoke to the complete reviewed source method set.** The frozen M00 literal inventory has **129 distinct names** (172 literal callsites), and the reviewed dynamic closure contributes **16 distinct, previously unlisted names** (four dynamic callsites), yielding **145 unique frontend-callable RPC targets**. The smoke reads these two checked-in M00 artifacts, validates the frozen source pin, names, completeness/counters and backend ownership, and issues one additional synthetic request per method against the *actual local Worker entry point*. It requires `login` to stay unavailable (503) and all other original browser RPCs to remain not migrated (501), with fixed non-success envelopes and safe headers. The public `rpcRegistry` must also stay empty, so unsupported argument shapes cannot masquerade as safe inactive methods.

This check is already included in `node scripts/check-m11-preview-runtime.mjs` and runs in the existing no-secrets PR-only Cloudflare Workers Builds safety workflow. A source inventory mismatch, deleted dynamic target, silently enabled nonrepresentative source RPC, public registry registration or leaked environment access fails with fixed codes and blocks a normal PR merge when branch rules enforce this check. No original GAS, live Sheets, remote D1 or Cloudflare release is accessed.

**Scope and remaining limitations:** The 145-name inventory covers known original browser methods, not arbitrary new RPC names, attack payload space, trusted staff authorization, real production database connectivity or all Cloudflare dashboard changes. Local behavior and an empty public registry are deliberately required until separate M10 business reconciliation, security proof and owner GO authorize a new non-preview production release. **A passing preview smoke does not mean the ERP is functional.**


## M11-08 — Sticky incident hold and documented recovery review

A single clean M11-05 monitoring window **must never be used to clear a prior unresolved accounting, stock, D1 or unauthorized-write incident**. Use the offline, metadata-only continuity reviewer `scripts/check-m11-incident-continuity.mjs` to examine consecutive, source/release-pinned windows and any separately approved recovery review records. This is a *documentary* operator procedure, not an alert runner, D1 query, incident controller or permission to resume transactions.

The private JSON uses the exact top-level structure:

```json
{
  "schemaVersion": 1,
  "releaseSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "sourceSnapshotSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "windows": [],
  "recoveryReviews": []
}
```

Populate `windows` with **one or more** complete M11-05 monitoring manifests (up to 48), ordered in canonical UTC with each start equal to the previous end, no gaps or overlaps, and identical reviewed release/SHA-256 pins. `windows: []` is shown above only as a structural key illustration: it **fails** the preflight until actual privately collected and independently reviewed window evidence is supplied. Do not submit customer/staff identities, invoice payloads, passwords, SQL, tokens, financial line entries or raw D1 journals.

An M11-05 `INCIDENT_HOLD` persists across later `OBSERVE` windows until an independently signed review points to the **latest** outstanding incident window and a **subsequent quiet** window. The review metadata has exact keys `incidentWindow` and `throughWindow` (zero-based indexes in the supplied window array), `status: "verified"`, `releaseSha`, `sourceSnapshotSha256` and `evidence`. `evidence` requires six **different non-sensitive private reference IDs**: `legacyFreeze`, `d1Freeze`, `committedWriteJournal`, `grossPartyAccounts`, `inventoryLots` and `ownerReview`. A recovery review on an incident or escalated window, a duplicate/out-of-order review, or a review with no outstanding critical incident is rejected. A new incident after a reviewed recovery creates a fresh sticky hold.

```sh
node scripts/check-m11-incident-continuity.mjs \
  /private/m11-monitoring-continuity.json \
  <reviewed-release-sha> <final-source-snapshot-sha256>
```

Statuses are `INSUFFICIENT_EVIDENCE`, `INCIDENT_HOLD`, `ESCALATE`, `OBSERVE` or `RECOVERY_REVIEWED`. **`RECOVERY_REVIEWED` is only a structurally complete review record, not an authenticated incident clearance or operational GO.** The CLI prints fixed diagnostic codes and explicitly sets `authorizesWriteResumption:false` and `authorizesTrafficSwitch:false` for every status. Real emergency write freezes, exact committed-write reconciliation, independent source and D1 verification, incident on-call coordination, permission and session checks, and a separate owner decision remain mandatory before restoring any authoritative writer.


## M11-09 — Private post-cutover ERP workflow-smoke evidence

**This is a metadata-only documentary preflight, not a test against live Workers/D1 and not an authorization to exercise, deploy, restore or resume business operations.** Only an authorized operator may run real production smoke under a separately approved cutover with verified M10 signoff, controlled transactions and independently preserved private business records. `scripts/check-m11-production-smoke.mjs` checks that the operator's report *mentions all expected workflows and reconciliation proofs*; it cannot authenticate submitted references.

Save three JSON documents **outside GitHub**: the already-reviewed M11 release-evidence manifest (switch phase), the exact `activation` cutover event-order manifest, and a post-cutover smoke report. The smoke report has exact top-level keys `schemaVersion:1`, `releaseSha`, `sourceSha`, `sourceSnapshotSha256`, `deployment`, `reads`, `writes`, `postSmoke`, `writerBoundary`. The release, original source and final snapshot must match all three independently provided pins. Deployment metadata needs `status:"verified"`, a non-sensitive `record`, `releaseSha`, `deployedSha` matching the pinned release, `environment:"private-production"` and a separate production `workerName`, never a preview/staging/test Worker.

`reads` requires individually reviewed `{status:"verified",record:"audit/private-reference",releaseSha:"<release-sha>"}` for exactly: `health-deployed`, `staff-login-logout`, `rbac-denial`, `products-stock-fifo`, `invoice-print`, `daybook-reports`, `settings-team`. Each reference is unique and points to separately retained private evidence.

`writes` requires exactly: `pos-sale`, `split-payment`, `purchase`, `sales-return`, `purchase-return`, `cash-session`, `cash-bank`. Each entry has exact keys `status:"verified"`, `operationId`, `receiptRecord`, `verificationRecord`, `unexplainedDifferences:0` and `releaseSha`. Operation IDs and receipt/verification record references must be distinct across all paths. They must refer to reviewed **controlled** operations and their exact immutable receipts/reversals; the checker neither issues them nor touches any real operation. Do not record staff, customer, supplier or invoice details.

`postSmoke` has `status:"verified"`, `record`, `releaseSha`, plus zero `unreconciledAcknowledgedOperations`, `grossPartyDiscrepancies`, `inventoryDiscrepancies`, `cashBankDiscrepancies`. `writerBoundary` has `status:"verified"`, `record`, `releaseSha`, `authority:"d1-only"`, `activeWriters:1`, `legacyWritesAfterFreeze:0`. These are assertions backed by independent, private evidence and cannot substitute for a real freeze check, failure injection, stock-lot parity, role denial or bookkeeping reconciliation.

Run the structural check locally with **private** evidence files:

```sh
node scripts/check-m11-production-smoke.mjs \
  /private/m11-postcutover-smoke.json \
  /private/m11-activation-order.json \
  /private/m11-release-evidence.json \
  <reviewed-production-release-sha> <final-source-snapshot-sha256>
```

Outputs contain only fixed status, blocker codes and caution, never input contents. `DOCUMENTARY_COMPLETE` means the supplied shape passes consistency checks: it **does not** demonstrate that a real private production deployment exists, that the Worker is secure, that a receipt matches a real posted operation, that business parity holds, or that the owner approved launch. M10 reconciliation/recovery/auth/performance gates, separate production deployment authority, on-call evidence, and postlaunch owner acceptance remain independent and mandatory. Do not enable D1 on a public preview as a workaround.


## M11-10 — Linked operational handover and custody evidence

A single completed source-import, a synthetic business-smoke evidence manifest, or an incident window marked `OBSERVE` **does not** establish a safe owner handover. Use `scripts/check-m11-handover-evidence.mjs` only to cross-check a private, operator-reviewed **handover metadata record** against the existing M11 handover-phase release evidence, exact activation sequence, M11-09 business-smoke evidence and M11-08 consecutive monitoring history. All underlying evidence must be retained and verified **outside GitHub** and never include passwords, financial row payloads, tokens, client data or identifiable staff/Party records.

The input handover metadata must have exactly `schemaVersion:1`, `releaseSha`, `sourceSha`, `sourceSnapshotSha256`, `observationsEndedAt`, `reviewedAt` and `custody`. The first three pins must match the independently supplied release and original source snapshot. UTC timestamps must use canonical `YYYY-MM-DDTHH:MM:SSZ`; `observationsEndedAt` must match the final supplied monitoring-window end exactly, and the handover review must be **later** than that observation. At least two contiguous reviewed monitoring windows must be supplied, without recent alert escalation or unresolved critical incidents. A critical incident, including one with a documentary recovery review, requires a separate human incident-authority decision before normal handover; this conservative gate never clears it automatically.

The `custody` object requires exactly eight distinct release-pinned `{status:"verified",record:"audit/non-sensitive-reference",releaseSha:"<release-sha>"}` entries:

- `backupCustodian`: verified ownership of D1 backups and private recovery access;
- `restoreDrill`: independently checked real restore/readback and post-cutover write replay rehearsal;
- `sourceArchive`: preserved immutable GAS/Sheets source-data archive and retention owner;
- `incidentOnCall`: staffed escalation and freeze/rollback incident authority;
- `monitoringAlerts`: reviewed Worker/D1 plus financial-stock/source-freeze alert routing;
- `supportHandoff`: shop-facing support and operator continuity instructions;
- `accountingAcceptance`: same reviewed reference as the release manifest's `postlaunch-d1-write-and-account-reconciliation` check;
- `ownerBusinessAcceptance`: same reviewed reference as the release manifest's `owner-handover-acceptance` check.

Records must not be reused across distinct custody roles. All status and receipt identifiers here are **self-reported metadata** and are not a substitute for independent review of live deployment, source-data custody, source/D1 amounts, gross Party accounts, stock/FIFO, staff permissions and original invoice printing.

Run only on operator-controlled local private JSON files:

```sh
node scripts/check-m11-handover-evidence.mjs \
  /private/m11-handover.json \
  /private/m11-release-evidence.json \
  /private/m11-activation-order.json \
  /private/m11-postcutover-smoke.json \
  /private/m11-monitoring-continuity.json \
  <exact-reviewed-release-sha> <final-source-snapshot-sha256>
```

`DOCUMENTARY_COMPLETE` states only that the submitted metadata and references are internally consistent under the source pin. A different operator must validate authenticity of the underlying evidence; M10 source-to-D1 migration parity, actual restore rehearsal, incident disposition, and **explicit owner business acceptance remain independent**. The tool grants no production authorization and cannot deploy, reroute, connect a D1 binding, freeze writers, restore a backup or resume transactions.


## M11-11 — One authoritative writer across cutover and rollback

The existing M11-03 event sequence and M11-02 committed-write disposition reports **do not separately prove when each system was writable**. The offline `scripts/check-m11-single-writer-timeline.mjs` adds a time-contiguous **authority-epoch review** over private, operator-supplied evidence. It cannot contact the legacy GAS/Sheets deployment, Cloudflare Workers or any D1 database, observe actual commits, stop either writer or authorize traffic switching.

Prepare a private JSON document containing exactly `schemaVersion:1`, `releaseSha`, `sourceSha`, `sourceSnapshotSha256`, `mode`, `epochs`, and `checkpoint`. The three identifiers must match the independently reviewed target release, pinned original Mohim_ERP source, and private final source snapshot. `mode` must match the separately reviewed M11-03 cutover order:

| Mode | Required writer epochs (in order) |
|---|---|
| `activation` | `legacy` → `frozen` → `d1` |
| `rollback-to-legacy` | `legacy` → `frozen` → `d1` → `frozen` → `legacy` |
| `hold-d1-readonly` | `legacy` → `frozen` → `d1` → `frozen` |

Each epoch has **exactly** `startedAt`, `endedAt` (canonical UTC `YYYY-MM-DDTHH:MM:SSZ`), `authority`, `legacyCommits`, `d1Commits`, `record` and `releaseSha`. Intervals must have positive durations of no more than 24 hours, be strictly ordered and meet end-to-start with no gaps or overlaps. Each `record` is a distinct non-sensitive private audit-reference ID; no raw journal, transaction, employee or customer data is included. For the source-freeze epoch, use the **same** `record` as the M11-03 `legacy-writes-frozen` event; for the D1 epoch, use that of `traffic-switched-to-d1`. For recovery/hold, link the second frozen epoch to `worker-writes-frozen`; for rollback back to legacy, link the final epoch to `traffic-restored-to-legacy`.

A `legacy` epoch must report zero D1 commits, a `d1` epoch must report zero legacy commits, and a `frozen` epoch must report zero commits to **both** systems. The validator rejects any forbidden commitment, missing or malformed count, invalid fence, or duplicated audit reference. This proves only **internal consistency of the submitted counts**, not their completeness or the fact that live writers were stopped.

For `rollback-to-legacy` and `hold-d1-readonly`, also supply the existing M11-02 private delta manifest. Its separately reviewed `freeze.legacy.record` and `freeze.d1.record` must match the timeline's source and D1 freeze epochs; its `checkpoints.committed.count` must exactly equal all reported D1-only commits. The existing M11-03 validator must independently accept that delta, with `resume-legacy` dispositions for rollback or `roll-forward` retention for D1 hold. **Never** reactivate legacy writes until every acknowledged post-switch D1 operation has been reconciled and replayed under a separately authorized single-writer plan. A zero-count delta is permissible only when the independent committed journal proves zero commits.

The `checkpoint` must contain `status:"verified"`, distinct `record`, pinned `releaseSha` and **zero** `unreconciledAcknowledgedOperations`, `duplicateOperationEffects`, `grossPartyDiscrepancies`, `inventoryDiscrepancies`, `legacyWritesAfterFreeze`. A nonzero or unreviewed checkpoint is an incident/recovery blocker.

```sh
# Activation review: only private reports; no database access
node scripts/check-m11-single-writer-timeline.mjs \
  /private/m11-writer-timeline.json \
  /private/m11-cutover-order.json \
  /private/m11-release-evidence.json \
  <reviewed-release-sha> <source-snapshot-sha256>

# Approved rollback or D1 read-only hold: same arguments plus the private delta
node scripts/check-m11-single-writer-timeline.mjs \
  /private/m11-writer-timeline.json \
  /private/m11-cutover-order.json \
  /private/m11-release-evidence.json \
  <reviewed-release-sha> <source-snapshot-sha256> \
  /private/m11-write-delta.json
```

The tool emits fixed blocker codes, not source data, raw event IDs or secrets. A structurally complete report is **not an authenticated live source freeze, production GO, safe rollback, authorization to resume legacy/D1 writes, or proof of a finished ERP migration**. Require real M10/production acceptance, independent source and target journal/readback evidence, gross-role Party accounts, stock/FIFO parity, correct D1 Time Travel retention and a separate documented owner decision. Do not bind public previews to D1 or write to the original business Sheets during this review.


## M11-12 — GitHub Actions deployment-ownership audit (source only)

**Scope:** GitHub-based M11 preparation under `AGENTS.md`, `docs/PARALLEL_EXECUTION.md` and coordination issue #456. Cloudflare Workers Builds is the sole automatic deployment owner for the inert `shererp-cloud-preview` Worker. The normal pull-request workflows run tests, local Workerd/D1 fixtures and `wrangler deploy --dry-run`; they must never publish a Worker, access remote D1, or receive deployment secrets. This is not approval to activate production RPC, import real historical data or bind D1 to a public preview.

Run the dependency-free, read-only repository audit as an extra operator check:

```sh
node scripts/m11-ci-deployment-ownership.mjs
```

The audit scans every `.github/workflows/*.yml`/`*.yaml` file, verifies the existing DB-free preview Wrangler config, and rejects direct Wrangler publish commands, unexpected Cloudflare deployment actions, remote operations in ordinary workflows, or secret expressions in those workflows. The existing `remote-d1-staging.yml` is a **narrow manual exception**: `workflow_dispatch` only, exact `main` ref and approved `APPLY_STAGING_D1_SCHEMA_ONLY` confirmation, protected `cloudflare-staging-db` environment, verified database target and existing limited migration count. This exception does not authorize new staging migrations or private customer data, and it does not make GitHub Actions the owner of public preview deployment.

The companion `tests/m11-ci-deployment-ownership.test.mjs` uses synthetic mutations to prove that new PR deployments, PR-secret access, alternate remote D1 targets and weakening the manual staging conditions are blocked. The test suite reads all current workflow files through `npm test`, and the standard full PR CI must remain green before this guard or any later M11 change merges. A green static audit does **not** prove GitHub protected-environment policies, cloud-account permissions, Workers Builds identity, live database binding state or real traffic routing; those controls need independently reviewed authority. The audit performs no Cloudflare API calls and never writes D1 or GAS/Sheets.
