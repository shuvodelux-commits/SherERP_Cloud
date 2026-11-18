# M04 — Diagnose unavailable sign-in; local D1 Administrator smoke

**Status:** private Workerd/D1 integration proof only; **public ERP sign-in is still disabled**.

## Why the deployed site says sign-in is unavailable

On main, `src/index.js` calls `handleRpc(request)` without `authAdapter`. The public `src/rpc/registry.js` is empty, and `wrangler.jsonc` does not bind the operational D1. The exact 503 message comes from the intentional fallback in `src/rpc/handler.js`. The error occurs **before** the user's password is checked; it is not a bad-password or newly created account issue.

The verified historical archive contains exactly one Active Administrator whose original ten-digit mobile normalizes to the owner's intended eleven-digit Bangladesh staff login. That account is **not yet provisioned into operational D1**; it has no live session. Do not create another Administrator, rewrite the original mobile, or lock/disable the historical Owner to bypass these gates.

## What this PR proves

The isolated `src/auth/m04-private-auth-smoke-worker.js` invokes only the reviewed `createD1LegacyAuthRpc` via `handleRpc`, and uses the original staff phone normalizer. It requires a fixed localhost-only `127.0.0.1:8787` POST path, no Origin/Cookie, a private high-entropy operator token, and an exact, explicitly selected synthetic or private-staging D1 resource identity.

The `wrangler.m04-private-auth-smoke-test.jsonc` config is **synthetic** and only binds an isolated test D1; it never refers to the live archive or real operational D1. Tests import synthetic Administrator-first staff with the historical Owner deferred, verify first-login one-time SHA-256-to-PBKDF2 upgrade, persistent session restore and logout/revocation, wrong passwords and unknown business RPCs denied, and public/local access boundaries. No private source row, phone, password, token, or SQL export is committed.

The public `src/index.js`, RPC registry, Wrangler production config, shared `src/db/**` and `migrations/**` **remain untouched**. The private test must not be interpreted as permission to attach a public D1 binding.

## Exact remaining activation sequence

1. Independent M03/M04/M11 review and full exact-head CI for this proof.
2. Review the actual source provenance (source workbook revision/timezone), fresh staging SQL export with successful restore, Time Travel bookmark, and a single exclusive private operator. Do not reuse stale backups as permission for new writes.
3. Separately authorize a single private staff import using already merged #636, #637 and #638. Expect **2 eligible historical staff, 2 original roles and 2 pending legacy verifiers**, zero old sessions; one historical Active Owner remains unchanged in source and deferred from D1.
4. Read back the actual staging D1 identities, roles and credential state privately. If the outcome is ambiguous, stop; never blindly retry.
5. M03 integration owner must approve a distinct **private staging runtime binding/auth adapter**, validate genuine Administrator sign-in with the old password (first-login upgrade), session restore and logout, then the preserved UI login envelope. Never log the password.
6. A future *separate owner GO* and security review must explicitly authorize public authenticated RPC and tenant protection. Financial posting remains blocked until the shared ledger/stock/Cash Session gates pass.

**No current automatic GitHub merge, CI run, or preview deployment activates the user's real ERP login.** The website's existing 503 response is correct for its present fail-closed public configuration.
