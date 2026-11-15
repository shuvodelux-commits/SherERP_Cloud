# M02-P Real Local D1 Party Identity Invariant Proof

## Objective (2026-11-15)
Test the already-merged `migrations/0002_party_identity.sql` in **actual Cloudflare workerd + local D1**, not just Node SQLite. This supplies an independent M02-P gate without taking ownership of shared `src/db`, finance DDL or transactions.

## Frozen contract
- Original source: Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; approved ADR-007 single identity and seven descriptive Party roles, separate financial directions, no automatic merge.
- Existing M02 migrations `0001_core_catalog.sql` and `0002_party_identity.sql` are consumed **unchanged**.
- Workerd is isolated by dedicated `wrangler.m02-party-test.jsonc`, hardcoded synthetic UUID, `workers_dev: false`, only local D1 binding, and a test fixture Worker that never serves business or user data. No remote or staging credentials.
- New `tests/integration/m02-party-workerd.spec.mjs` uses real `createTestHarness`, `applyD1Migrations('DB')`, `getEnv()`, and local prepared statements.
- New PR-only `.github/workflows/m02-party-d1-workerd.yml` pins Node 22 and Wrangler 4.161.0 on an ephemeral runner, explicitly runs the isolated suite. No alternate deployment workflow, remote DB operations, secrets, or production routes.

## Tests and safety gates
1. Real D1 migrations yield exactly seven declared app tables, 4 identity triggers, two migration records, and **zero** financial account/settlement/journal tables.
2. Same name/phone may belong to different Parties. All seven roles may attach to one Party; staff `Administrator` forbidden; duplicate roles and missing parent FK rejected.
3. Second source identity linked to a Party requires human-verified status and nonblank reviewer/date. No name/phone-based merge. `source_group/source_id` cannot be attached to two Parties.
4. Immutable source identity links reject UPDATE or DELETE; inactive historical role rows cannot be removed, and Party parent deletion with links is prohibited. Source sheet-row provenance is unique within each source group.
5. Identity review records remain non-authoritative, require review metadata to mark confirmed, and cannot create a link implicitly.
6. Real D1 `batch` failure injection rejects one invalid link in a batch and leaves **zero** prior new links. Two overlapping writes for the same source record cannot both succeed.
7. No real/synthetic financial postings, account balances, Cash Book or Cash Session side effects. No test endpoint is exposed to production Worker, static assets or auth.

## Anti-claims
These tests are only identity constraints. A green run does not prove real import, data parity, persistent authenticated approvals, idempotent financial postings, or manual settlement correctness. No SQL schema change or remote D1 write is authorized. The source transaction identity and financial-account design remain gated by future owner-reviewed PRs.

## Alternatives
- Extend M03 suite's shared aggregator: rejected because M03 owner has multiple concurrent PRs editing it.
- Change M02 schema now: rejected because the intended identity constraints exist, and adding finance tables is not approved.
- **Chosen:** independent M02 local-workerd fixture + PR-only workflow, with pinned migration proof and synthetic records.