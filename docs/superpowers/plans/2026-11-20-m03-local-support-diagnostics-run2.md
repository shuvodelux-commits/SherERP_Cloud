# M03 Issue #765 — Local audited Shop diagnostics (Run 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development, superpowers:executing-plans and independent /super qa → /super review. Test each new behavior RED before GREEN.

**Goal:** Reuse the merged #775 read-only support grant to prove a genuinely authorized, audited, Shop-scoped *minimal catalog diagnostics read* against two disposable physical D1 databases.

**Architecture:** New internal module only, not imported by any public/hosted Worker. The trusted Shop D1 scope goes through #775's immutable identity + current Super Admin session and support-token READ audit before reading any catalog metadata. Only fixed, whitelisted catalog schema/count queries are permitted; missing tables report unknown rather than zero.

**Tech Stack:** Existing JS ESM, Cloudflare Workerd/D1 via pinned wrangler@4.161.0, node:test, current auth, Control DB migrations, original catalog SQL, GitHub PR-only Actions.

**Spec:** [Issue #765](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/765). User selected one-person, KISS Control Center, secure support without using Owner credentials; #759 directory and #775 audit-grant foundation are merged. This milestone does NOT open tenant ERP in production.

## Global constraints

- Base `main@0deb878e003a6cc643e8a1231a1e7cc1c00c499d`, frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Exclusive NEW files: `src/modules/m03-local-support-shop-diagnostics.js`, `tests/integration/m03-local-support-shop-diagnostics-workerd.spec.mjs`, `.github/workflows/m03-local-support-diagnostics.yml`, this plan. All other sources read-only.
- No prod/staging Worker import, Admin UI toggle, public RPC, Shop data writes, database binding/migration, remote Cloudflare action or Owner impersonation.
- Do not claim counts imply an operational ERP. A missing catalog schema yields an explicit `schema-incomplete` without invented zero counts.
- Every authorized read must append immutable READ audit via the merged #775 gate first; denied reads must never query private catalog rows.
- Treat a grant/session/action event ID as single-use. Revoked MFA, reused events, changed Shop scope and swapped D1 all deny.
- Never return customer, Supplier, money/ledger, sale, invoice or Product names; catalog counts only.
- Existing original UI, cash/permission, finance and source IDs unaffected.
- Independent M04/M11 security review before merge, separate operator approval for production activation.

## Source consistency checklist

- Match existing `src/modules/m03-local-support-read-grants.js` call signature `authorizeLocalSupportRead(controlDb,scope,{eventId,sessionToken,supportToken})`.
- Scope is trusted `{shopDb,shopId,databaseId,databaseMarker}`; no client-selected database or arbitrary SQL.
- Fixed queries `sqlite_master` exact two approved tables and `COUNT(*)` of `product_categories` / `product_units` only.
- Use `textContent`/sanitized output for future UI, do not build UI this run.
- Use current session/role and immutable binding checks from the grant, not client claims; return only `allowed` / `denied` / `invalid` / `unavailable` status and bounded counts.
- Test allowed two-Shop counts, no grant, wrong Shop/marker, malformed/duplicate event, revoked Admin and grant, schema-incomplete, no leaking raw tokens/DB identifiers.

## Review focus

1. Unauthorized request must not access `product_categories` / `product_units` or create READ audit.
2. Cross-Shop and swapped-D1 identity fail closed despite a valid bearer.
3. Duplicate event IDs return denied without another diagnostics read or audit event.
4. Missing catalog tables must not report zero/ready and never return sensitive source fields.
5. Admin MFA rotation and token revocation block all subsequent reads.

## Task 1 — RED real Workerd test

**Create:** `tests/integration/m03-local-support-shop-diagnostics-workerd.spec.mjs`.

- [ ] Seed two distinct Shop D1s and verified Control D1 reservations/bindings; apply #775 support DDL.
- [ ] Create valid 5-minute token via existing issue function; assert 2/1 categories/units for Shop A and 1/2 for B, immutable audit and no output of names/tokens.
- [ ] Assert unauthorized/wrong Shop, swapped D1, bad event, duplicate, revoked grant/session and schema-incomplete.
- [ ] Commit RED test and PR-only workflow; confirm actual GitHub Actions run fails for missing module.

## Task 2 — GREEN minimal internal diagnostic service

**Create:** `src/modules/m03-local-support-shop-diagnostics.js`.

- [ ] Expose `inspectLocalSupportShop(controlDb,scope,{eventId,sessionToken,supportToken})`.
- [ ] Authorize and durably audit READ via #775 before any catalog query.
- [ ] Use only fixed table-name allowlist and read-only COUNTs; never read labels, account values or customer data.
- [ ] Return `{status:'ok',shopId,catalog:{status:'available',categories,units}}` or `{status:'schema-incomplete',shopId,catalog:{status:'missing'}}`, or fail-closed status.
- [ ] Observe exact-head hosted real Workerd/D1 GREEN, then run all repo CI.

## Task 3 — /super QA, review and handoff

- [ ] Recheck open PR/file reservations and confirm no imported path in deployed Worker entry points.
- [ ] Require independent M04/M11 security and CI workflow review; report failed Cloudflare build quota separately, never waive.
- [ ] Leave PR draft until all checks pass and explicit merge authorization.
- [ ] Next separate reviewed step: a private Auth/Access-protected support API with safe Shop routing, Owner-visible Support Mode, expiry/revoke and end-to-end authorization; production D1/Worker approval still required.
