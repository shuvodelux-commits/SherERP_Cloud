# M01 — Browser fixture must use real Worker API responses

**Scope:** original compiled SherERP HTML browser QA, public inert Worker API only. M01 fixture is an unauthenticated loopback process with no secrets, D1, production imports or live ERP session.

## Observed regression gap

The existing `qa/serve-compiled-ui.mjs` manually emulates `/api/rpc` and `/api/health` rather than using `src/index.js`. For example, `GET /api/rpc` receives 501 from the fixture but 405 with `Allow: POST` from the actual Worker; `POST /api/health` receives fixture 200 but Worker 405. This can mask or invent frontend integration failures while M04 authentication remains disabled.

## Acceptance contract

- The existing Chromium desktop/mobile/login/A4 tests keep using the unchanged legacy compiled frontend.
- All loopback `/api` routes exercise the **actual** inert public Worker entrypoint, not a parallel response implementation. No real D1/auth adapter is attached.
- Synthetic loopback parity tests compare status, JSON envelope and relevant response headers against direct `src/index.js.fetch` for health GET/POST, RPC method/content-type/JSON validation, disabled login, unregistered method, cross-origin denial and unknown API route.
- Static HTML / and /index.html remain served from the build-generated, transport-patched original markup; any other non-API path stays 404.
- No migrations, business code, source UI modifications, remote services, credentials, Cloudflare configuration or package additions.

## Implementation boundaries

Only `qa/serve-compiled-ui.mjs`, a new Node regression test and these two docs. The fixture's HTTP-to-Fetch adaptation should be simple, loopback only, preserve request method/headers/body, and relay response status/headers/body without synthetic success. M01 browser workflow and package scripts stay unchanged. Exact-GitHub-HEAD CI, original source SHA verification and existing Chromium suite are mandatory. Not a proof of authenticated login or finance readiness.
