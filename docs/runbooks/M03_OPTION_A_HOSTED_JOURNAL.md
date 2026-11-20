# M03 Option A P1 — Hosted D1 create journal and private Cloudflare provider

**Status:** Backend-only work on an isolated GitHub branch. NOT deployed or connected to the live Admin route. No remote Cloudflare write, SQL migration, Worker publication or Owner activation has been performed.

## Existing code reused

- `startLocalProvisioning` from PORT-P4 still reserves an immutable Shop UUID, operation ID, business name and approved Owner Gmail using the active Super Admin Google/TOTP session.
- `CURRENT_PLATFORM_ADMIN_FROM` still enforces current Admin session and factor version.
- PORT-P2 `validatedReceipt` validates the provider receipt before accepting any database ID.
- No product, purchase, POS, return or accounting module is modified.

## New private contract

`src/provisioning/hosted-shop-create.js` provides:
- `reserveHostedShop(controlDb,sessionToken,operation,{accountId})`: creates/reuses the existing PORT-P4 reservation and writes an immutable operation row in the **new Control D1 journal**. The database name is derived from the immutable Shop UUID, not from the business display name. Only a sanitized `{operationId,shopId,state,failedStage}` is returned.
- `readHostedShopCreate(controlDb,sessionToken,operationId)`: current Admin-scoped read, no D1 credentials, marker or receipt leaked.
- `advanceHostedShopCreate(controlDb,sessionToken,operationId,provider)`: private-service-only step; capacity preflight, atomic SQL claim **before** a create API call, validated receipt, idempotent reconciliation, and no premature Owner readiness.

`src/provisioning/cloudflare-d1-provider.js` exposes
`createCloudflareD1Provider({accountId,apiToken,maxDatabases,fetchFn})`.
It calls the Cloudflare D1 API only with a fixed, exact account URL;
validates server-constructed `shererp-shop-<32hex>` name and attempt ID,
checks account quota using GET, then makes one authorized POST. The
credential is never returned. It will **never** infer an existing
creation from a matching database name: Cloudflare's D1 list endpoint
does not provide the private operation attempt ID.

The reviewed additive schema is
`staging-migrations/platform-onboarding/0012_hosted_shop_provisioning_journal.sql`.
It references existing PORT-P4 records and protects operation ID, Shop
ID, account, name, attempt ID, creation receipt, and history through SQL
constraints/triggers. This is Control D1 metadata only, not an ERP
transaction schema.

## Failure and recovery semantics

| Event | Journal result | Provider behavior |
| --- | --- | --- |
| Valid first request | `reserved` | No provider call until `advance` |
| Same operation repeated | Same immutable Shop | No new Shop |
| Invalid Admin / revoked MFA | Denied | Zero create calls |
| Account D1 quota exhausted | `reserved` with `capacity` issue | Zero POST |
| First eligible advance | `creating` claim | At most one POST |
| POST returns exact verified receipt | `database-created` | Persist D1 UUID/evidence |
| Network timeout or response lost | `outcome-unknown` | Never POST again on retry |
| Retry with independently attributed receipt | `database-created` | No second POST |
| Retry with only a matching D1 name | Remains `outcome-unknown` | Operator reconciliation needed |
| Distinct operation with same name | Distinct Shop UUID/name | Separate journal and capacity check |

The `database-created` journal state **does not** imply Shop Ready.
Pinned migrations, immutable Shop identity, the complete shared Owner
Worker binding roster, active version readback, and an explicit Owner
approval must all succeed in later Task 3/4/5 stages before the
existing PORT-P4 Ready transition may run.

## Future live release gate (not done)

1. Review Task 1 private deployment owner, then finish Task 3 private
   service binding, exact Google/TOTP authorization, pinned migrations
   and Task 4 append-only Worker publisher.
2. Verify the *existing* Control D1 and first Shop data, take a protected
   Control D1 export and restore it successfully in isolated SQLite.
3. Apply the new journal migration to an authorized, backed-up Control D1
   only after reviewing current actual migration names and order.
4. Install the narrow Cloudflare API token as a **secret on the private
   provisioner**. Do not use an Owner Worker, browser, GitHub Build
   variable, public Workers Preview or source repository.
5. Test with two entirely new Shop D1s and the existing first Shop.
   Confirm all Owner and financial gates stay fail closed until the
   new database is fully provisioned and published.

The provider cannot automatically resolve a lost Cloudflare CREATE
response on name alone. A separately audited, attributable external
receipt mechanism must be implemented or an operator must reconcile
an `outcome-unknown` operation; do not silently create a replacement.

**Testing:** Both fake-HTTP contract and actual isolated Workerd/D1
migration/session tests exercise double submit, races, quota, revoked
MFA, timeout, exact receipt and no Owner approval before Ready.
