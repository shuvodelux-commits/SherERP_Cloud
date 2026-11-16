# M01 browser-visible public RPC fail-closed regression

## Source, current scope and missing acceptance

M01 source-preserved UI runs against an inert, DB-free Cloudflare Worker route `/api/rpc`. The original `serverCall(fnName,...args)` is mechanically replaced only in compiled HTML by `scripts/patch-rpc.mjs`. The frozen `legacy/source/javascript.html` remains byte-identical to `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

Existing M01 Chromium tests assert failed login, session invalidation, mobile and invoices, but do not comprehensively cover the browser-to-public-Worker **negative API contract**. The new tests must distinguish actual public Worker routing from trusted local Workerd/D1 adapters used in M02–M09: there is **no** authAdapter, D1 or migration permission for public previews.

## Acceptance

1. In real Chromium, `GET /api/health` returns exactly the inert foundation service, database `not-connected`, and no-store/nosniff headers; no functioning database or authenticated ERP success.
2. The actual same-origin `/api/rpc` POST endpoint refuses GET (405), foreign `Origin` (403), non-JSON (415), malformed JSON or invalid function name (400), overlarge body (413), unknown valid RPC and recognized-but-unmigrated `getProducts` (501), and login with no authAdapter (503), using stable structured failure objects and no-store/nosniff headers.
3. Calling the **real compiled frontend** `serverCall('getProducts')` rejects with the controlled Worker error rather than resolving or leaking an exception stack. The original login overlay remains visible and protected `#app` remains hidden after every probe.
4. No business handler, dynamic arbitrary method invocation, private data or authenticated session is enabled by this regression.

## Safe test boundary

New standalone `qa/m01-rpc-failclosed.spec.mjs`, minimal `package.json` browser-script addition and two docs. No changes to frozen original HTML/CSS/JS, Worker handler, registry, frontend transport patch implementation, D1/auth/Party finance, Cloudflare builds or bindings. Test-first CI on the exact GitHub PR head. Passing immediately is additional coverage (not fabricated RED); failures must be diagnosed against actual Worker source before proposing a separate production fix.

Synthetic request bodies and credentials only. No live business data. Rollback by reverting scoped PR.
