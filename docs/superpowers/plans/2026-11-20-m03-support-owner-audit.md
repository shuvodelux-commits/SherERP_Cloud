# M03 Owner-readable Support Audit Run 5 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:executing-plans and superpowers:test-driven-development. RED test → expected failure → minimal GREEN → full CI → independent /super qa and /super review.

**Goal:** Give each authenticated Shop Owner a strictly read-only, own-Shop view of the Super Admin's START/READ/END support history, with the hosted endpoint disabled by default.

**Architecture:** One Control D1 SQL query checks current Owner bearer, enabled access, absolute Owner session deadline, Shop identity, immutable database ID and marker, then joins at most 50 recent support events for that Shop. Before querying Control D1, the trusted Owner Worker verifies physical Shop D1 identity. Existing Owner HTTP interface exposes a default-off GET endpoint returning strictly redacted audit metadata.

**Tech stack:** Hono private Owner Worker, JS, SQLite/D1 STRICT, Workerd and node:test.

**Spec:** GitHub issue #765, previously merged #759, #775, #778, #781 and #784.

## Global constraints

- Base main@0319b58e87819da49a33aff9b725da7cc4bca3b4. Frozen original Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
- Exclusive paths: NEW src/auth/m03-support-owner-audit.js, existing src/m03-owner-redemption-worker.js, NEW tests/integration/m03-support-owner-audit-workerd.spec.mjs, NEW .github/workflows/m03-support-owner-audit.yml, this plan.
- No changes to public Worker, original ERP/Owner frontend, migrations, Wrangler, shared D1 finance code, private Admin Worker, or grant writer.
- No remote D1, production activation or Cloudflare deployment; OWNER_SUPPORT_AUDIT_ENABLED must remain unset in all hosted profiles.
- Owner route GET /api/owner/support/audit only if OWNER_LOGIN_ENABLED=true AND OWNER_SUPPORT_AUDIT_ENABLED=true. Anonymous/off/not migrated fail closed.
- One Control D1 SQL snapshot joins enabled Owner access, valid current session (OWNER_SESSION_FRESH_SQL), matching immutable Shop ID/database UUID/marker and up to 50 recent support events.
- Return only eventType (START/READ/END), eventAtMs, operationId (receipt), reason and actor string "Platform Super Admin". No issuer/subject/token hashes/Owner credentials or customer, Party, ledger, invoice, price or product row content.
- The prior grant/event schema is TEST-ONLY. A separate migration + M11 backup/review is mandatory before any hosted access.
- Preserve Owner login, setup, catalog GET/POST and logout; original ERP remains unchanged.

## Review focus

1. Shop A cookie at Shop B origin/Worker must never read either Shop's events; physical binding swap must deny.
2. Disabled, expired, revoked or wrong bearer Owner sessions must not access audit events.
3. Valid Owner with zero support activity returns empty events, not a fabricated "all okay" status.
4. Admin Google subject, Shop database IDs, token hashes and financial values never leak into API response.
5. Missing audit tables must be unavailable, not represented as empty.

## Task 1 — RED integration test

- [ ] Create tests/integration/m03-support-owner-audit-workerd.spec.mjs using two physical disposable Shop D1s and one Control D1 seeded with distinct Owner sessions and support grants.
- [ ] Assert default 404, enabled own-Shop read, cross-Shop/mismatched D1/disabled/expired/revoked denial, empty audit and missing migration behavior.
- [ ] Add new PR-only no-secret/no-deploy workflow; observe actual missing-module/export RED on GitHub Actions.

## Task 2 — GREEN

- [ ] Implement src/auth/m03-support-owner-audit.js to validate physical Shop identity, hash Owner bearer and query enabled current Owner session and own-Shop support audit in ONE Control D1 SQL statement.
- [ ] Map strictly allowlisted response fields, 50 max and bounded strings.
- [ ] Add explicitly default-off route to existing Owner Worker; use existing origin, rate limiting, session cookie, and no-store protection. No writes.

## Task 3 — verification/review

- [ ] Run focused Workerd suites and full exact-head GitHub CI. Compare active PR reservations.
- [ ] Independent /super qa → /super review, M04/M11 security and new workflow review.
- [ ] PR stays draft without human approval; no remote D1 writes or hosted activation.
- [ ] Follow-on milestone: approved migration, Owner-visible audit widget, Cloudflare Access-bound native Shop resolver and second-account release rehearsal.
