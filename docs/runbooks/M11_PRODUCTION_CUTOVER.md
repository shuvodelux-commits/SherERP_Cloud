# M11 — SherERP production cutover, monitoring and rollback

**Status: DRAFT — NOT APPROVED FOR LIVE LAUNCH.** Tracking [M11 issue #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306). Read `AGENTS.md`, `docs/WORKSTREAMS.md` M10/M11, `docs/MIGRATION_PLAN.md`, `docs/runbooks/M04_PROTECTED_STAFF_EXPORT_AND_CUTOVER.md`, ADR-007 and the M11 Superpowers plan first.

## Current deployment boundary

- `main` automatically publishes only the **inert, D1-free** `shererp-cloud-preview` shell using Cloudflare Workers Builds. Its `/api/health` response is `foundation / not-connected`.
- PR Workers Previews remain isolated and must have **no production/staging D1 or mutable source bindings**.
- `wrangler.staging.jsonc` references the separately gated staging database; this is not a production binding and does not authorize real customer data import.
- There is **no approved production D1 cutover, Worker routing plan, staff export or complete M10 signed report** in this runbook. This first M11 PR performs no deployment, mutation, release-secret access or live data inspection.
- For current work, do not point the old GAS or Google Sheets at Workers, do not enable incomplete RPC routes and do not modify original source records.

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
