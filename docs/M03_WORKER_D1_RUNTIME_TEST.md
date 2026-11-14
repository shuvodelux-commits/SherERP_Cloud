# M03 — local Cloudflare Worker runtime integration for read-only D1 adapters

**Status:** Separate test-only PR; **no public Worker routing, database binding, or remote D1 migration**.

## Why this test exists

PR #15 introduced safe catalog and exact-source Party identity readers. Its earlier contract tests executed SQL using Node in-memory SQLite with an async D1-shaped test bridge, which did not prove the adapters run correctly inside Cloudflare's actual `workerd` runtime.

The Cloudflare-recommended `createTestHarness()` API starts a local Worker, exposes local D1 via `worker.getEnv()`, and applies the original migrations with `worker.applyD1Migrations('DB')`. This PR adds that missing integration test.

References:
- https://developers.cloudflare.com/workers/testing/test-harness/get-started/
- https://developers.cloudflare.com/workers/testing/test-harness/prepare-test-state/
- https://developers.cloudflare.com/workers/wrangler/api/

## Files and behavior

- `wrangler.m03-test.jsonc`: **test-only** Worker `shererp-m03-workerd-test`, `workers_dev: false`, no routes/assets/secrets, synthetic local D1 UUID `00000000-0000-0000-0000-000000000001`, original `migrations/`.
- `tests/fixtures/m03-readonly-worker.mjs`: test-only isolated entry point imports the actual `src/db/read-only-catalog.js` and `src/db/party-identity-read.js` and exposes only synthetic validation routes. Never imported by `src/index.js`.
- `tests/integration/m03-workerd.spec.mjs`: uses **real local workerd/D1**, applies both source-reviewed migrations, seeds synthetic catalog/Party records, exercises the actual adapters through HTTP inside local Worker, and verifies exact Party source identities, rejection of malformed requests, stable row ordering and absence of test-route writes.
- `tests/m03-runtime-policy.test.mjs`: Node policy checks require exact test-only Worker name and synthetic D1 UUID, enforce no remote resources/preview binding, and ensure no secrets or production deployment in the new CI job.
- `.github/workflows/m03-d1-workerd.yml`: triggers on PRs only. Installs pinned `wrangler@4.161.0` **inside GitHub CI only**, runs the isolated harness; no Cloudflare auth or remote D1.

## Security and scope

**Unchanged:**
- `src/index.js`, `src/rpc/`, `wrangler.preview.jsonc`, `wrangler.staging.jsonc`, and SQL migrations.
- Cloudflare's publicly accessible PR/main Worker still returns `database: not-connected`. All ERP RPC methods remain blocked.
- Actual staging D1 database `shererp-staging-db` is never used in this new test, even if Cloudflare API credentials exist elsewhere in the repository.

**Not yet M03 completion:** The broader source-faithful async Database.gs port, identity import/writer adapters, representative data parity, authentication M04, and transaction correctness remain outstanding. Do not enable public data access without M04.

## Running checks locally

Run `npm test` without installing Wrangler to run the policy and existing Node tests. To test against the real Cloudflare Workers runtime, install `wrangler@4.161.0` locally (or via CI), then run:

```bash
npm install --no-save --package-lock=false wrangler@4.161.0
node --test tests/integration/m03-workerd.spec.mjs
```

`tests/integration/m03-workerd.spec.mjs` intentionally uses the `.spec.mjs` extension so the default `npm test` does not try to import Wrangler when it is not installed. CI invokes it explicitly.
