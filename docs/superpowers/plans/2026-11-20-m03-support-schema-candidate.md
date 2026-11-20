# M03 Support Audit Control D1 Migration Candidate — Run 7

> For agentic workers: REQUIRED SUB-SKILL: superpowers:executing-plans/test-driven-development. RED first, verify actual failure, minimal GREEN, exact-head CI then /super qa and /super review.

**Goal:** Prepare an auditable local D1 SQL schema candidate for Control Center five-minute support grants and START/READ/END event history without changing any deployed migrations, config, auth or Worker route.

**Architecture:** A single SQL script in staging-migrations/platform-support, NOT a configured migrations_dir for any Worker, mirrors merged LOCAL_SUPPORT_READ_DDL. Disposable Control D1 applies existing auth + reservation and binding schema, then candidate. Tests prove Shop-scoped authorization, current MFA session, immutable events and no cross-Shop reads. Promotion requires independent M11 backup/restore/migration approval.

**Tech:** SQLite STRICT and Workerd/D1 pinned Wrangler, JS ESM node:test. Spec: Issue #765 and M11 #306; grant implementation #775 and Owner audit #786.

## Constraints

- Base main b94f617045749256b3f410facc7ed59860798d04.
- NEW only: staging-migrations/platform-support/0001_support_grants_and_events.sql; tests/integration/m03-support-schema-candidate-workerd.spec.mjs; .github/workflows/m03-support-schema-candidate.yml; this plan.
- No live Cloudflare migrations_dir, Wrangler profile, Cloudflare account, remote D1, Worker route, Owner UI or finance/stock changed.
- Statements use existing -- next statement delimiter; byte-normalized identity with LOCAL_SUPPORT_READ_DDL is a test requirement.
- Enforce immutable grant Shop ID/database ID/marker/admin hash, operation replay, immutable START/READ/END audit, and 300000ms grant lifetime.
- Use real disposable Workerd Control with two physical Shop D1s and actual shop_identity, current Admin session, immutable reservations/bindings.
- No raw bearer or financial data storage.
- Promotion, rollback, backup/restore, version receipts and private Cloudflare Access route are independent security gates.

## Task 1 — RED

- [ ] Write test first reading missing candidate and checking exact schema equality, physical D1 creation, issue/read/revoke and immutable triggers.
- [ ] Add PR-only workflow using pinned Wrangler, no secret/remote writes.
- [ ] Observe expected missing-file GitHub RED (not fixture errors).

## Task 2 — GREEN

- [ ] Create SQL candidate identical to LOCAL_SUPPORT_READ_DDL with statement delimiters.
- [ ] Prove SQL-current Admin MFA, two Shop isolation, immutable audit and revoked denial on Workerd.
- [ ] Run old #775/#778/#786 tests and exact-head full repository CI.

## Task 3 — QA/Review

- [ ] Verify candidate is outside active Wrangler migration directories and no remote D1/Worker changed.
- [ ] Record M11 rollback/backup and migration-numbering gates.
- [ ] Independent /super qa and /super review; owner-approved merge only.
