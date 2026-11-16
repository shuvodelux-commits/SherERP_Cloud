# M11-06 — Public preview Worker no-write runtime smoke gate (2026-11-16)

**Issue:** #306. **Base:** `SherERP_Cloud/main@71433612ed8885a9573fa6bfb24dc620c10d8ab8`. **Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Dependencies:** merged M11 PRs #309, #318, #328, #338 and #345. Follow `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/runbooks/M11_PRODUCTION_CUTOVER.md` and ADR-007.

## Twelve-sentence implementation overview

1. The connected `shererp-cloud-preview` Worker must remain an inert, DB-free public shell until the owner separately approves M10 and a production cutover.
2. Existing Wrangler checks protect preview bindings but do not exercise the actual Worker runtime to detect accidental business-RPC success or database access.
3. M11-06 adds a local process smoke check that imports the real Worker entry and sends synthetic HTTP requests without network, source data or remote D1.
4. The check reuses the reviewed preview-config guard and injects a transparent trap that records every access to a Worker environment property other than mock static assets.
5. The health probe must still return the exact `foundation/not-connected` response and safe no-cache/no-sniff headers.
6. Login and representative products, POS, purchase, returns, bank, stock and cash-ledger RPC probes must all return controlled non-success responses with no data payload.
7. A GET request to the RPC path, unknown API routes and malformed RPC bodies must also fail without side effects.
8. The test will reject even a Worker that catches its own attempt to access `env.DB`, preventing a false pass caused by swallowed exceptions.
9. Synthetic mutation tests will demonstrate failure on unexpected production-ready health, successful RPC, secret/environment access, unsafe headers or public D1 config.
10. The test module is committed first and must produce an expected missing-module RED in GitHub Actions before the smallest implementation is added.
11. The GREEN step wires this runtime check into the existing no-secrets PR-only preview validation job without adding a deployment owner or modifying the connected Cloudflare Worker.
12. This check certifies only local preview-contract behavior under synthetic probes; it cannot prove all possible operations are safe, real Cloudflare configuration or production readiness and never authorizes launch.

## Scope / acceptance

- **New:** `tests/m11-preview-runtime.test.mjs` (RED), `scripts/check-m11-preview-runtime.mjs` (GREEN), this scoped plan.
- **Changed:** `.github/workflows/cloudflare-preview.yml` to run the smoke CLI on PRs after the existing config safety checks; `docs/runbooks/M11_PRODUCTION_CUTOVER.md` to document limitations.
- **Unchanged:** original GAS/Sheets, source manifest, Worker entry/RPC handler, financial kernel, D1 migrations/schema, other CI workflows, `wrangler*.jsonc`, Cloudflare dashboard/API, real business data, deployment secrets and actual Worker routing.
- All test probes must run with dummy request values, no external calls and no real D1; they cannot replace M04 auth, M10 staging evidence or M11 owner approvals.
