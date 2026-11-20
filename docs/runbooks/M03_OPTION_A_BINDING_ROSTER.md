# M03 Option A P2 — Complete Owner Worker D1 binding roster

**Status:** Private, provider-injected release contract and local Workerd
proof. **NOT a production Cloudflare version uploader or deployment.**
No remote API request, Shop D1 migration, Owner route or financial writer
is enabled in this change.

## What the new modules establish

- `src/provisioning/verified-binding-roster.js` preserves the exact
  `CONTROL_DB` and existing `PLATFORM_PILOT_DB` D1 bindings in the
  currently verified Owner Worker release.
- A new binding name is derived deterministically from the immutable Shop
  UUID: `SHOP_<32 uppercase hex>`. The browser never chooses a Worker
  binding, database UUID or schema manifest.
- A new Shop placement requires an exact Cloudflare account ID, Shop UUID,
  D1 UUID, immutable marker, 64-hex pinned migration receipt digest,
  `owner-ready-v1` compatibility revision and proof of 13 reviewed
  migrations. Every prior Shop binding, marker, receipt and schema revision
  is retained unchanged; aliases and reused D1 UUIDs are rejected.
- `src/provisioning/owner-worker-release-publisher.js` drives a private,
  injected version provider: read current active version → prepare
  append-only candidate → upload immutable Worker version → independently
  read back entire roster and reviewed code SHA → verify active version has
  not changed → promote exactly once → verify final active version.
- A lost upload response cannot be assumed successful. A lost promote
  response is resolved **only** by independently reading the exact active
  version. A stale release, lost first Shop, wrong Cloudflare account,
  altered Shop marker, duplicate binding or invalid private publisher lease
  denies the operation.

## Proof

Contract tests cover malicious roster edits, stale Builds Worker, missing
D1 binding, wrong version SHA, invalid schema/receipt, duplicate Shop
assignment and unknown network outcomes. An independent Workerd test
starts with the existing Shop D1 and an additional D1 bound under its
deterministic name. It verifies both immutable Shop identities and shows
that the same product ID can hold different Shop data without crossing
the binding boundary.

## Critical pending integration

1. **Task 1:** approve and activate one private release publisher; prevent
   old Cloudflare Builds from automatically promoting the pilot-only
   Worker. Merely changing `wrangler versions upload` is insufficient
   without an authorized version promoter.
2. **Task 3:** build the internal, service-bound provisioner with real
   Cloudflare D1 migration and version APIs, a durable publisher lease
   and an independently verified Shop schema/identity receipt.
3. **Task 4 finishing work:** implement the actual Cloudflare Worker
   Versions multipart upload and deployment provider, preserving all
   static assets, binding types, protected secrets, rate limits and
   reviewed code from a verified immutable artifact. A synthetic test
   provider **does not** prove that this remote API is operational.
4. **Task 5:** route each authenticated Owner session to the exact
   server-published Shop binding in the shared Worker; continue to reject
   any browser-provided Shop/database selection. Keep the old first Owner
   login path valid until acceptance.
5. **Task 6:** wire the existing Admin Create/Resume UI to these trusted
   backend milestones. Do not show Ready after database creation alone.
6. **M10/M11:** test a two-Shop rollout and backup/recovery on an approved
   Cloudflare account before allowing automatic provisioning or finance.

**Do not enable multi-Shop Owner APIs or change live Cloudflare Worker
versions based solely on this contract PR.** The current first Shop D1
and Owner login remain authoritative.
