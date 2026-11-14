# SherERP Cloud M03 — Read-only D1 repository foundation

**Status:** Internal adapter slice only; **not** the complete M03 runtime port or a public backend activation.

## Verified preceding milestone

Staging D1 remote migration run [#43631947633](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/43631947633) succeeded after exact UUID, empty database and Time Travel recovery-bookmark checks. Remote D1 now contains 7 application tables, 2 migration records and 4 Party protection triggers.

## What this slice adds

- `src/db/d1-binding.js`: `requireD1Binding(env)` explicitly requires the Worker binding `env.DB` and rejects missing or fake bindings. No fallback, second database or request-global cache.
- `src/db/read-only-catalog.js`: `createCatalogReader(env)` exposes only `listCategories(limit)` and `listUnits(limit)`. The prepared SQL queries select reviewed non-secret identifiers, names and status, sort by persistent row ID and use a bounded bound parameter (`LIMIT ?`, 1–100). **No Settings values are exposed**, avoiding potential secrets.
- `src/db/party-identity-read.js`: `resolveLegacyPartyId(env, sourceGroup, sourceId)` resolves only an **exact, active source-group+source-ID link** from `party_legacy_links`; recognizes the five frozen original master groups, never fuzzy matches, never merges by name/phone and never handles money.
- `tests/m03-d1-readonly.test.mjs`: in-memory SQLite queries via a deliberately minimal async D1-compatible bridge. Tests verify parameter binding, ordering, bounded reads, nullable lookup, injection rejection, missing D1, bad result handling and no write statements.

**There is no change to `src/index.js`, `src/rpc/`, `wrangler.preview.jsonc` or `wrangler.staging.jsonc`.** Consequently the public website remains an inert shell with `/api/health` saying `database:not-connected`, and all business RPC methods returning 501. This is intentional until M04 authentication.

## Verification levels

1. **TDD unit/in-memory SQLite bridge:** 5 adapter tests (RED missing modules; GREEN after implementation); not a real D1 Worker API test.
2. **Existing CI:** Node test suite and `wrangler@4.161.0 d1 migrations apply --local` schema verification using actual Wrangler D1. These local D1 checks validate migration schema, **not the new Worker adapter in a live D1 runtime**.
3. **Still required before M03 acceptance:** an isolated Worker-runtime D1 integration test calling these adapters against actual Wrangler/Miniflare D1, representative authorized legacy data fixture parity, full async port of Database.gs and related methods, M04 authorization and audited write/atomic transaction contracts.

## Next

Build an isolated runtime adapter test harness that invokes `createCatalogReader` and `resolveLegacyPartyId` against the actual local Cloudflare D1 binding without opening public routes. Begin M04 auth design, not business postings. All customer/Party financial accounts and optional cross-role offsets remain separately gated.
