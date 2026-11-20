# M03 Read-only Support Local HTTP Contract — Run 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, superpowers:test-driven-development, and independent /super qa → /super review. Steps use checkboxes for each verifiable gate.

**Goal:** Exercise the existing reviewed local Control Center support-grant and per-Shop catalog diagnostics through a narrow private HTTP contract, with ZERO deployment or new production route.

**Architecture:** An internal, test-only request dispatcher accepts a `Request` and a separately trusted local environment. The environment holds an exact origin, opt-in feature flag, Control D1 and an allowlisted array of physical Shop D1 bindings. Each request must be POST with exact origin, content type, size limit, no query params, and a valid existing secure cookie; only three hard-coded actions are possible: start, inspect, end. It delegates authority and audit to #775 and #778. This module is not imported by any deployed Worker.

**Tech Stack:** JavaScript ESM, native Request/Response, existing M03 D1 support modules, Workerd local harness, node:test, GitHub Actions PR-only pinned Wrangler.

**Source/Spec:** issue #765. Merged PRs #759 directory, #775 grant, #778 diagnostics. Source freeze `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Constraints

- Base `main@f7f36da1cc84cb0bfaae0775cd610cdfe7ec3d12`. Reserved NEW files only: `src/modules/m03-local-support-http-contract.js`, `tests/integration/m03-local-support-http-contract-workerd.spec.mjs`, `.github/workflows/m03-local-support-http-contract.yml`, and this plan.
- Do not touch `src/index.js`, `src/m03-private-platform-auth-worker.js`, `src/m03-access-platform-auth-worker.js`, Owner Worker, `frontend/**`, `src/rpc/**`, `src/db/**`, migrations, `wrangler*.jsonc`, shared CI, money/stock code or remote hosted services.
- The handler is **local test-only**, opt-in `SUPPORT_TEST_MODE_ENABLED === true`; explicit absence returns 404. Real Cloudflare/Access deployment is still unauthorized.
- Browser origin exactly equals configured trusted HTTPS origin. No query params or arbitrary host aliases. Validate `Content-Type: application/json`, `Content-Length`/actual bytes <=2048, three fixed action paths and required fields only.
- Cookies are exact-name `__Host-shererp-platform-session` and only an existing Super Admin current SQL session; never allow token in URL, log or Owner credential.
- Select Shop only from the server-supplied allowlist that supplies physical `shopDb`, `shopId`, `databaseId`, `databaseMarker`; disallow client-selected database/binding. Real Shop D1 immutable identity is verified by #775.
- `start`: body `{shopId,operationId,reason}`; delegate #775 issuer; raw support bearer returned once, no cache; replay no token.
- `inspect`: body `{shopId,eventId,supportToken}`; delegate #778 authenticated/audited counts; never financial, invoice, Party or user data.
- `end`: body `{shopId,operationId}`; delegate #775 revocation; immutable END audit.
- Error responses must not leak opaque token, actor subject, physical D1 ID or internal SQL errors. Use consistent no-store, strict JSON response, CSP/default-deny, nosniff.
- Proof is not a hosted authorization grant: cross-D1 audit + metadata read are separate transactions; M04/M11 must decide how to handle a revoke race before enabling any user-facing endpoint.

## Task 1 — RED

**Create:** `tests/integration/m03-local-support-http-contract-workerd.spec.mjs`. A real disposable Workerd Control D1 plus two physically distinct Shop D1s using existing platform, reservation, binding, shop-identity and catalog fixtures, and #775 test-only support schema.

- [ ] Test private route flag disabled and denied unknown route, GET, cross-origin, missing cookie, extra body fields/DB ID, malformed JSON, oversized requests, query string.
- [ ] Test two-Shop start→inspect→end, isolated non-sensitive category/unit counts and START/READ/END audit; retry never returns raw bearer.
- [ ] Test cross-Shop/token swap, reused event, revoked grant and MFA rotation fail closed.
- [ ] Commit failing tests before implementation. Dedicated PR-only workflow `.github/workflows/m03-local-support-http-contract.yml` uses pinned Wrangler and no Cloudflare credentials/deploy.
- [ ] Confirm actual hosted RED due missing `src/modules/m03-local-support-http-contract.js`.

## Task 2 — GREEN

**Create:** `src/modules/m03-local-support-http-contract.js`.

- [ ] Export `handleLocalSupportHttpRequest(request,env)`.
- [ ] Accept only exact registered actions and required JSON fields; if environment is missing test flag or untrusted origin return 404/403.
- [ ] Resolve D1 only from trusted inventory, validate session cookie and body lengths; no raw secrets in logs.
- [ ] Call #775 issue/revoke and #778 inspect; only forward allowlisted results.
- [ ] Run the original RED test to GREEN in real Workerd/D1. Regression verify #775 + #778 original tests in PR-only workflow.

## Task 3 — QA / review gate

- [ ] Exact branch HEAD full GitHub CI, no conflicts with #456 and newly opened PRs.
- [ ] Independent `/super qa` then `/super review` including security M04/M11 cross-DB race review and Owner-visible support attribution plan.
- [ ] No automatic merge, no changes to Cloudflare admin-hisabiq or hisabiq, no remote D1 or hosted auth/purchase activation.
- [ ] Subsequent, separately approved milestone: integrated server-validated Cloudflare Access private Worker route, explicit Shop routing and visible Support Mode plus Owner/audit visibility; production D1 writes and finance permissions remain out of scope.
