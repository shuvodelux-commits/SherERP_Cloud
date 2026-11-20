# Option A P2b — Shop D1 identity and pinned migration verification

**Scope:** Reuse the existing reviewed Owner-ready Shop migration and
PORT-P2 SQL receipt logic as a standalone *private* schema gate. There
are no HTTP routes, no Cloudflare API calls, no D1 credentials and no
production database writes in this PR.

`src/provisioning/shop-schema-initializer.js` exports
`prepareVerifiedShop({shopDb,scope,provider,plan})`. The provider is
**injected** and must be reviewed separately to verify a freshly
created Cloudflare D1 and execute the exact pinned migration sources.
This wrapper does not parse user-supplied SQL and cannot select D1 by
browser-provided ID.

It validates the exact immutable Shop UUID, database UUID and marker,
asks the trusted provider to verify the actual D1 object before and
after migration, reuses `pilotShopIdentityMatches`, and checks the
**full 13-entry** `OWNER_READY_SHOP_MIGRATION_PLAN` against the
immutable D1 migration ledger with `matchesPortP2MigrationPrefix`.
The last recorded schema snapshot must equal the current SQLite
schema. Only then does it produce a SHA-256 receipt digest and
`schemaRevision:'owner-ready-v1'` for the versioned binding roster.

All errors return only `SHOP_SCHEMA_NOT_READY`; no partial plan,
mismatched identity, swapped D1, changed schema or missing provider
can produce a publishable receipt. An idempotent re-verification of an
unchanged Shop produces an identical digest.

**Tests (isolated Workerd + real local D1):** 13 reviewed SQL migrations,
wrong Shop marker, wrong database target, partial receipts, schema drift,
unreviewed plan, provider failure and no DDL on wrong identity. The
existing `port-p2-shop-bindings` and `m03-hosted-prebound-pilot`
regressions remain in scope.

**Not done:** This file is not a Cloudflare provider. The actual
migration executor and private service binding, current Admin MFA
authorization, Control D1 journaling, Cloudflare Worker Versions API
publisher, dynamic Owner routing and Admin UI activation remain
independent tasks requiring security and release review. No live D1
migration or Worker deploy is authorized by merging this PR.

**Compatibility:** The existing first Shop database is never
recreated or modified here. When parallel operational ERP migrations
add new tables, a separately reviewed schema-revision upgrade is
required; do not bypass the strict 13-step snapshot gate.
