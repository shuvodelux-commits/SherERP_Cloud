# M03/M04 Minimal Control Center — local read-only Support Grant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development, superpowers:executing-plans and independent /super qa → /super review. Check each task RED before GREEN.

**Goal:** Prove a short-lived, audited, single-Shop, same-session read-only Super Admin support authorization on two real disposable Shop D1 databases.

**Architecture:** A private M03-only internal module exports strict local SQL schema and issue/read/revoke functions. The existing platform Super Admin session, not an Owner credential, authorizes SQL mutations; a matching immutable Shop ID + D1 ID + marker is required. Tests execute against real Workerd/SQLite through the current private auth local harness; no deployed entry point imports the module.

**Tech stack:** vanilla JS/ES modules, current `src/auth/platform-superadmin-session.js`, `src/auth/session-token.js`, SQLite STRICT + triggers, wrangler@4.161.0 local Workerd, node:test and GitHub PR-only CI.

**Spec:** [Issue #765](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/765). Owner approved KISS single-admin Control Center; this is first security-only Run 1 after merged #759, not final support access or Owner/ERP routing.

## Global Constraints

- Branch `m03/local-audited-support-read-grants-20261120` based on `main@e81e243b94ff7712ae6c42392ae4fc4c763faf8d`; frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Exclusive new paths: `src/modules/m03-local-support-read-grants.js`, `tests/integration/m03-local-support-read-grants-workerd.spec.mjs`, `.github/workflows/m03-local-support-read-grants.yml`, this plan. M03/M04/M11 issue/coordination as tracked on #456.
- Private module **must never** be imported from `src/index.js`, `src/m03-private-platform-auth-worker.js`, Owner Worker or public `src/rpc/**`; no public or hosted endpoints in this PR.
- ZERO financial writer, tenant impersonation, permissions override, remote D1 migration, Shop D1 mutations or production deploy.
- **Only** SQL-current Admin actor/session from Control D1 may issue, record a read or revoke, and exact immutable Shop D1 identity must match the trusted scope each time.
- One support grant is READ-ONLY, 5-minute max, same Admin session, one Shop and immutable binding; short reason required; only SHA256 token digest persisted; no raw bearer token in audit or API logs.
- Audit append-only START/READ/END; data read must not be performed merely because a token exists without SQL-current approval and recorded audit.
- Existing #769 first-purchase permission correction, M05 #767, M02 #772, M10 #773, M01 #771 and #774 cleanup must not overlap.
- Cloudflare build limit: never weaken required checks, never claim failed Cloudflare preview is a code error without logs; M11 needs to review new PR-only CI.

## Source pattern checklist

- Reuse `CURRENT_PLATFORM_ADMIN_FROM` SQL and `hashOpaqueSessionToken`, `createOpaqueSessionToken`; decode session bearer hash exactly like existing auth.
- Use SQLite SQL time for all authorization/expiry, NEVER client time.
- Reuse existing `platform_shop_reservations` + `platform_shop_bindings` with approved Super Admin subject; no auto-matching by name/email.
- Validate the real Shop's immutable `shop_identity` against trusted `scope={shopDb,shopId,databaseId,databaseMarker}` before any authorized grant/read/revoke. These caller scope values are trusted, never a user-supplied arbitrary D1 binding.
- Use `db.prepare().bind().first()` and SQL SELECT inside INSERT/UPDATE for write-time auth, not a JS preflight alone.
- Audit trigger insert should atomically abort grant issuance on failure; audit rows cannot be edited/deleted.
- Deny unknown/expired/revoked/changed-intent/foreign Shop tokens without disclosing tenant records.
- Protect staff/Owner sessions, money and Account ledgers as separate systems; no delegated financial write granted.

## Review focus

1. Creating for Shop A with Shop B's live D1 or marker must deny; token cannot be used for Shop B.
2. Same operation replay cannot reveal or mint another bearer token; changed reason/identity must deny.
3. Session revoke, MFA version change, grant expiry and grant revoke must deny any subsequent read, including previously logged-in sessions.
4. Two simultaneous grants to the same Shop cannot both become active; synthetic same operation remains one grant/audit.
5. Late audit trigger abort must leave zero orphan grant/receipt; START/READ/END immutable and actor-attributed.

## Task 1: RED real Workerd/D1 test

**Create:** `tests/integration/m03-local-support-read-grants-workerd.spec.mjs`

**Consumes:** existing `wrangler.m03-platform-auth-local-test.jsonc`, real Super Admin/Shop binding migrations, current auth-token hash, future `LOCAL_SUPPORT_READ_DDL`, `issueLocalSupportReadGrant`, `authorizeLocalSupportRead`, `revokeLocalSupportReadGrant`.

- [ ] Write real local Workerd/D1 fixture for two distinct Shop DBs, seeded Control DB current Super Admin auth session and verified Shop identity.
- [ ] Assert create/read/replay/changed-intent/second active/revoke, cross-Shop, wrong marker, invalid/expired token and revoked MFA/session cases plus immutable audit.
- [ ] Run target tests with `node --test tests/integration/m03-local-support-read-grants-workerd.spec.mjs` via PR-only GitHub Actions; verify failing RED because the exported module is missing.

## Task 2: GREEN minimum local-only module

**Create:** `src/modules/m03-local-support-read-grants.js`

**Produces:** `LOCAL_SUPPORT_READ_DDL` plus three async functions. Calls return only statuses, opaque token once, and anonymous audit references (no Owner token).

- [ ] Build STRICT grant/event tables, SQL triggers for immutable audit and grant revocation, 5-minute lifetime enforced by SQL.
- [ ] Implement issue with exact approved Shop binding and current Super Admin login session inside SQL mutation, strict operation ID/reason validation, one active grant per Shop, raw bearer disclosed ONLY on new grant.
- [ ] Implement read audit insert as authorization step, verifying same Admin session, grant token, Shop D1 identity, record READ exactly once, and fail closed on any mismatch.
- [ ] Implement revoke of exact grant with current Admin authority and audit END trigger.
- [ ] Run focused real Workerd/D1 green, then full Node, original UI, M03 integration/Google session suites and source/preview guards.

## Task 3: verification + independent review

- [ ] New PR-only workflow with pinned Wrangler, no Cloudflare API token, no live D1 and no deployment; M11 CI owner review.
- [ ] Verify exact final-head CI, compare merge base and all active PR filenames, and request independent /super qa → /super review.
- [ ] No merge without owner approval; no Admin Worker deployment or hosted capability activation.
- [ ] Follow-on work only after security gate: reviewed authenticated Support Access endpoints, role-scoped read API, support-mode UI, audit and shop/Owner notification; still no financial mutation until M08/M11.
