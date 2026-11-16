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
