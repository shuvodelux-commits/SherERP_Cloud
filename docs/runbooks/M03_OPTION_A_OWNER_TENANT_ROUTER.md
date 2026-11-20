# M03 Option A — Server-side Owner Shop D1 resolver

**Status:** Reusable Owner Worker authorization component and isolated Workerd
tests. **Not deployed or integrated into the live Owner Worker entrypoint.**
The first-Shop Google login, Supplier/Cash Session and ERP handlers remain
untouched by this PR.

## Reuse instead of rebuilding

`src/auth/m03-owner-tenant-router.js` composes existing components:

- `prepareCurrentOwnerPlacement` — the currently valid, per-Shop opaque
  Owner session from Control D1 and existing Owner access grants;
- `verifyReleaseRoster` — the reviewed complete, unique, append-only D1
  bindings from PR #832, not an untrusted Shop selector;
- `platform_shop_provisioning.stage='ready'` **and** immutable
  `platform_shop_bindings` rows in the existing Control D1;
- `pilotShopIdentityMatches` — exact immutable Shop UUID, D1 UUID and
  database marker from the **actual bound D1 object**;
- The existing PORT-P2 SQL checkpoint/receipt logic and reviewed 13-step
  Owner-ready migration plan.

A server-injected, private runtime release profile must supply exact
Cloudflare account, Control D1 UUID, immutable active Worker version and
reviewed source SHA. These are not request headers or browser parameters.
The original physical binding `PLATFORM_PILOT_DB` stays in the complete
roster, while additional Shop keys are uniquely derived from Shop UUID.
The feature flag `OWNER_MULTI_SHOP_ROUTING_ENABLED` defaults **off**.

On each request, the resolver reads the scoped Owner session, then the
Control D1 ready placement, the published version roster and physical
Shop D1 identity. It checks the complete pinned SQL receipts and SQLite
schema snapshot; for new Shop D1s it additionally checks their published
SHA-256 receipt digest and `owner-ready-v1` revision. It then **rechecks
Owner access and the Control D1 placement after the Shop D1 read** to
reject any intervening revocation or incompatible release.

The result is exclusively an internal
`{status:'ready',shopId,shopDb,schemaRevision}` with a D1 object held
in the Worker process; client callers never receive the D1 object or
its IDs. Bad, revoked or expired sessions return `denied`; mismatched
bindings, a missing/stale release, incomplete schema, unauthorized
placement or swapped physical D1 return `unavailable`.

## Integration into real Owner Worker (not yet completed)

This component is not sufficient by itself to enable multi-Shop sign-in.
The original Owner login and product/payment endpoints still use one
prebound pilot configuration; they must **not** be modified by simply
overwriting `env.PLATFORM_PILOT_DB` on a shared request environment.
That would risk cross-request data leakage. Use per-request scoped
bindings, not global/mutable Worker environment state.

Next review and implement:

1. Add explicit Shop selection during Google sign-in when one verified
   Gmail identity owns more than one Shop; issue only a Shop-scoped
   session, never route from email alone or accept a client D1 ID.
2. Scope the existing Owner ERP reads/writes and finance gates per
   request through this exact resolver, keeping original accounting
   algorithms and session fencing; verify runtime authorization on
   every ledger/stock write.
3. Introduce a publisher-generated, immutable active roster and verify
   real Cloudflare Worker Versions API readback. Do **not** synthesize
   an active version from a mere browser/header/flag.
4. Expand the pinned migration contract when reviewed Supplier/Cash
   schema upgrades exceed 13 migrations. A mismatched schema must
   withhold access until the revised reviewed release is published.
5. Test 2 distinct Owner identities/Shop D1s, shared Gmail with explicit
   Shop selection, revocation during request, version rollback,
   suspended Shop, wrong binding, and original first-Shop login.
6. Never enable the runtime multi-Shop flag or D1 publication on the
   live `shererp` Worker until the service-bound provisioning pipeline,
   reviewer-approved release and real two-Shop acceptance have passed.

## TDD/QA

A true isolated Workerd two-Shop fixture creates independent D1s,
applies all 13 reviewed SQL files to both, seeds current private Owner
sessions and ready Control D1 placements, and reads the **same logical
data key** with different values from the two Shop DBs. Tests deny
wrong/stale Worker version or code SHA, missing/reassigned D1, wrong
marker, disabled access, changed schema and access revoked **between**
the Shop D1 read and the final Control D1 authority check.

This is the missing routing **contract**, not a claim that the live Owner
Worker is multi-tenant. Existing first-Shop runtime and Supplier/Cash
paths remain exactly as deployed.
