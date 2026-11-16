# M04 protected staff export and cutover readiness — owner-review runbook

**Status: DRAFT / NO LIVE EXPORT OR CUTOVER APPROVAL.** This document specifies prerequisites and acceptance evidence only. No protected USERS/ROLES export, staff credentials, remote Cloudflare D1 migration, public login rollout, source GAS write freeze or traffic switch has been performed by this plan.

**Read first:** `AGENTS.md`, `docs/MIGRATION_PLAN.md` (P10/P11), `docs/WORKSTREAMS.md` (M04/M10/M11), `docs/M04_AUTH_SOURCE_CONTRACT.md`, `docs/CLOUDFLARE_STAGING_D1.md`, `docs/architecture/ADR-007-unified-party-relationships.md`. **Frozen behavioral source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Config.gs`, `Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`.

## Source-to-D1 design overview (15 sentences)

1. Legacy USERS contains User ID, Full Name, Mobile Number, salted SHA-256 verifier, Role, Status, Created By, Created At and Last Login.
2. Legacy ROLES contains original Role ID, Role Name, Allowed Modules, Permissions, Status and Created At.
3. The original source production GAS deployment and Sheets data remain the authority until separately authorized cutover.
4. The approved M04 offline importer requires complete provenance and preserves source staff and role identities in an atomic D1 batch.
5. The source freeze audit compares two caller-supplied protected exports but does not itself prove those reads occurred independently.
6. The actual protected exports must be performed only after the owner authorizes the source account, operator, scope and retention.
7. Any source Date object or Sheets serial must be converted and verified as the original canonical UTC instant rather than guessed from the export date.
8. Staff/role snapshots and their salts/hashes must never be committed to GitHub, attached to PRs, pasted into chat or emitted in CI logs.
9. A private backup and export-integrity record must be protected outside GitHub, with no reusable secrets included in the public readiness report.
10. An M04 rehearsal must use a disposable local D1 instance with all approved migration versions and exact redacted source-to-D1 reconciliation.
11. A source write-freeze must not be attempted until owner-approved maintenance and a bounded recovery plan exist.
12. The existing remote staging workflow intentionally refuses schema application while migration count differs from its two approved core migrations.
13. Original GAS sessions with `Expires At = Never` require a new explicit security/expiry decision, not silent internet-facing session carryover.
14. Any production traffic switch requires M10 full financial/account/stock reconciliation and M11 rollback planning, not just successful staff login.
15. No live source or Cloudflare state can be changed on the strength of this document or a passing source-freeze helper.

## Phase A — Explicit approvals and protected export contract (NOT AUTHORIZED)

**Owner decisions to record privately before any live action:**

- [ ] Named owner and trusted export operator with authorization to read exact USERS and ROLES fields; source snapshot inventory and its frozen code SHA agreed
- [ ] Maintenance window, business write policy, freeze entry/exit conditions, recovery contact and maximum acceptable interruption agreed
- [ ] Explicit permission for a **read-only** protected source export; separate approval would be needed for source write-freeze, remote staging migration and any user authentication activation
- [ ] Source timestamp timezone, JSON serialization method and ambiguous/invalid Sheets dates reviewed with evidence; never fill history with current time
- [ ] Private encrypted destination, authorized readers, encryption key custody, retention and deletion schedule approved; no plaintext source exports or credentials in GitHub/CI/PR artifacts/assistant messages
- [ ] Secret handling policy and legacy salted SHA-256 to modern password-upgrade or user-reset behavior approved; no hash/salt/password logging
- [ ] Legacy `Never` sessions policy approved (recommended: do **not** migrate unbounded bearer tokens; require new server-issued sessions under an explicitly reviewed expiration and idle policy)
- [ ] Source rollback and resumed-write authority agreed; staff identities and role history preserved without inferred Created By IDs
- [ ] Source-first read consistency procedure: two complete independent reads with no unintended intervening writes, or a supervised write freeze; record timestamps and operator identifiers in a protected log

**Protected export shape:** `{users:[...],roles:[...]}` with exact original source columns and source data values; final serialization must have canonical `YYYY-MM-DDTHH:mm:ss.sssZ` strings for real timestamps; blank source `Last Login` stays `''`. Do not export `SESSIONS` bearer tokens for import, and do not copy private credential values into analysis fixtures.

## Phase B — Private double-read and dry-run (NO PUBLIC NETWORK)

1. The owner-authorized operator captures **two independently acquired** complete source snapshots into the restricted environment with an approved consistent-read/freeze procedure. The app does not supply or verify an independent-export attestation; the operator must retain this evidence.
2. Run `auditLegacyStaffProvenance` on each snapshot and `auditStableLegacyStaffFreeze` on the pair **when that helper is actually merged into main**; reject all non-pass issues. If source rows change, do not pick a winner or silently sort/rewrite.
3. Keep original file integrity proofs, access log and privately held content checksums in the restricted evidence vault. The GitHub PR receives only aggregate counts, fixed issue codes, test-run reference, operator sign-off and a nonsecret evidence identifier.
4. Record an **offline D1 backup and restore drill** on a disposable local test database, then run the versioned migrations and the one-shot private importer. Do not use production or remote D1 for a dry-run.
5. Compare each imported role/user ID, permissions, source Created By/At/Last Login and pending legacy verifier through `reconcileLegacyStaffSnapshotWithD1`, in addition to the aggregate counts. Verify active Administrator safeguards, exact authorization, and credential-upgrade behavior under local Workerd tests.
6. Inject rollback/failure tests (late SQL exception, concurrent import, replayed import, role permission drift, incomplete/changed source, stale preflight). A failed D1 batch must leave zero imported staff and legacy verifier rows.
7. Archive only redacted evidence: user count, role count, number of pending credentials, source-freeze pass/fail, D1 readback pass/fail, local test-run ID and fail-closed outcome. **Never publish source hashes, phone numbers, User IDs, actor/timestamp values, raw snapshots or raw error bodies.**
8. If any mismatch remains, STOP; preserve the original GAS deployment and do not start a live cutover.

## Phase C — Distinct remote staging review and future M10 gate (NOT AUTHORIZED)

Before any remote staging D1 attempt, require all items below and an owner-approved **separate** PR/change:
- [ ] Current `main` contains exact M04 migration and importer implementation, with all current-head checks GREEN and no 0004 migration-name collision from draft #280
- [ ] Remote database identity verified against the owner-controlled Cloudflare account, secrets scoped to staging environment, no exported credential data in the repository
- [ ] Explicit approval of a **revised** staging-migration workflow and rollback; current `.github/workflows/remote-d1-staging.yml` still uses `EXPECTED_REMOTE_MIGRATION_COUNT=2` and MUST NOT be bypassed manually
- [ ] Backup or D1 Time Travel capability, applicable retention, restore point and restore *rehearsal evidence* independently verified against current Cloudflare capabilities, not assumed
- [ ] Staging schema/import plan plus import-only security isolation, never a shared public Preview Worker; existing Preview D1 binding remains absent
- [ ] Auth login/logout/permission/role disable/last-admin/throttle/legacy upgrade tests validated in private staging without leaking tokens; no public RPC before explicit authorization
- [ ] M10 reconciles **all** source sheets, stock lots/FIFO, sales/purchases/returns, cash/bank/session, source IDs, and separate gross Party role accounts against source truth (no cross-role auto-netting)
- [ ] M10 security, concurrency, browser/print, performance, backup/restore, discrepancy ledger and owner sign-off complete; no financial posting cutover with unresolved differences

## Phase D — Future M11 traffic and rollback decision (NOT AUTHORIZED)

The operator must have a written, time-bounded, owner-approved sequence for:
- Applying a source write-freeze only after business users are notified, then capturing a *final* source snapshot and committed source write checkpoint under the same protected process
- Reconciling every migration area at that checkpoint and recording mismatch disposition without auto-correction
- Preparing both **traffic rollback** and **new-write rollback/replay** plans; changing DNS alone is insufficient when D1 has accepted new accounting or stock postings
- Defining who can pause new writes, restore/replay a verified database snapshot, compensate or hand-reconcile changes, and when to re-enable old GAS writers; never enable two uncoordinated authoritative posting systems
- Validating first-user login, forbidden roles, account disable, one each sales/purchase/return/finance readback, stock, receipts/printing, responsive UI and error monitoring under a defined, limited observation window
- Recording owner go/no-go decision, staff support route, backup location (not in GitHub), rollback owner, failure threshold and audit evidence ID
- Keeping source GAS/Sheets intact and recoverable; never delete it as a deployment shortcut

## Programmatic guardrails currently expected

- Public `src/rpc/registry.js` stays empty and deny-by-default; no import or source export API.
- `wrangler.preview.jsonc` contains no `d1_databases`.
- `.github/workflows/remote-d1-staging.yml` retains `EXPECTED_REMOTE_MIGRATION_COUNT=2`, so third/fourth SQL migrations block remote apply.
- Existing GitHub CI exercises the four SQL migrations in **isolated local D1 only**.
- The offline importer must keep its private D1 boundary, source provenance validation, SQL atomicity and redacted reconciliation.
- Draft conflicting `#280` uses another `0004` filename and MUST NOT merge unchanged.

## Deliverables and release authority

**This PR provides:** an owner-review runbook for protected staff export and the staged M04/M10/M11 release boundaries. It adds no deployed code, import script, credentials or data.

**Not provided:** live exported rows, real production backup, independent double-read attestation, staging account access, remote migration, user activation, reviewed session retention, M10 acceptance or M11 rollback drill. Those are separate approvals and execution work.

**STOP rule:** A missing approval, unknown data provenance, mismatched source hash or role, failing reconciliation, incomplete backup rehearsal, unresolved business ledger/stock mismatch, or unsupported session policy keeps **both import and public auth disabled**.
