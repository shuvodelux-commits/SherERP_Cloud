# Superpowers RED → GREEN plan: M09 D1 Day Book source readiness

**Spec:** `docs/superpowers/specs/2026-11-16-m09-daybook-source-readiness-d1-design.md`.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `DayBook.gs`. **Dependency:** #403 merged read-only source composer.
**Goal:** Make incomplete D1 Day Book data observable to authorized internal diagnostics while **never treating physical table names as certified data**.

## Task 1 — RED on actual Workerd D1
1. In new GitHub branch, add spec/plan, an isolated Workerd test under `tests/integration/m09-daybook-source-readiness-workerd.spec.mjs`, and a dedicated local-only PR Actions workflow `.github/workflows/m09-daybook-source-readiness-workerd.yml`.
2. Reuse existing `wrangler.m09-daybook-authorized-test.jsonc` plus migrated M04 auth tables. Add synthetic admin and clerk sessions, one denied role, expired/revoked/stale authority. Use exact test D1 tables and prepared statements; do not change migrations or public Worker.
3. Test no missing physical legacy financial tables in current schema; inspect must return **NOT_READY** and twelve ordered missing groups for valid Administrator and daybook:view Clerk; denied actor must receive no list.
4. Test when some or **all** dummy legacy tables exist in isolated D1, the inventory changes but `ready` stays false due absent certified source snapshots. Test malformed request/accessors/token and no public endpoint, no changes to actual transaction data.
5. Commit tests/workflow before reader, create draft PR and record actual expected RED failing job log (missing module/export; no source deployed).

## Task 2 — minimum GREEN
6. Add only `src/modules/m09-daybook-source-readiness-d1.js`. Use `requireD1Binding`, M04 `AUTH_POLICY` and `tokenFingerprint`; server-owned `nowMs`, strict request descriptors; one static SQL query with authorized CTE joined to ordered legacy table names. Never rely on `allowed_modules` as authority.
7. Exactly validate D1 12-row own-data result, required ordinal/group names and boolean table presence, reject malformed/partial SQL responses and duplicates. Output only ordered group names, status and `ready:false`.
8. Run new isolated Workerd real D1 check and baseline Node/Chromium/source integrity/Cloudflare preview safety, reading *exact-head* logs to prove results. On unexpected RED, diagnose before modifying code.

## Task 3 — review
9. Compare four/five changed paths to latest main, record exact RED/GREEN SHA and verification links. Keep PR draft/unmerged for owner.
10. Next **separate** slice: reviewed full D1 import/mapping of all source groups with tenant-safe auth and source ID/digest provenance; only then authorize Day Book composer and reconcile real Cash Book/Bank Book and independent Party role accounts. M10 staging import and M11 production cutover still separately approved.
