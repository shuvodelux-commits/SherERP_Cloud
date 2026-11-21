# M09 Owner Invoice Studio — Private Shop D1 profile

Issue #870. Source UI pinned at `shuvodelux-commits/hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`. Predecessor merged PR #871. This is an isolated M09 adapter and frontend continuation; it does not enable a hosted API, customer data mutation, or print redesign.

## Overview and user-visible scope

The private Owner Settings UI now has an optional real preference client. If its backend is absent (current hosted default), the entire Invoice Studio remains preview-only, with no Save action and no false confirmation. Once a separately reviewed private Owner route is enabled, the current signed-in business can read its own settings, change a three-template preview, paper size, language or nine content visibility toggles, and explicitly save **preview preferences**. A successful response must match the exact intended profile and Shop; the client then checks the current Owner session before displaying a confirmation. Stale conflicts, revoked sessions, mismatched Shop IDs and network uncertainty do not show success.

The D1 adapter stores one canonical JSON value under `settings.key='HisabIQ Invoice Studio v1'`. It requires an already trusted current Owner session token and exact verified Shop D1 tuple, and performs the Shop identity + active, expiring write-grant authorization within the *same SQL statement* as each SELECT/INSERT/UPDATE. Concurrent saves with the same previous JSON revision cannot overwrite each other. No separate database, migration or mock persistence exists. The external HTTP adapter is a private route installer and is intentionally not imported into the deployed Owner Worker or public RPC registry in this PR.

## M03 integration handoff (not performed on this branch)

M03 owns `src/m03-owner-redemption-worker.js`, private flags, session/Shop identity, and the staged test deployment. Integrate after active M03 PR #862 and subsequent Owner Worker edits are reconciled:

```js
import {registerOwnerInvoiceProfileRoutes} from './modules/m09-owner-invoice-profile-routes.js';
// Register only in the already protected private Owner Hono application:
registerOwnerInvoiceProfileRoutes(app,{
  protectLogin,
  limitBody,
  currentOwnerContext: c => verifiedOwnerPurchaseContext(c,true)
});
```

`verifiedOwnerPurchaseContext` must continue to resolve the HttpOnly Owner cookie through current Control D1 session authority and verify the Shop D1 binding. Never accept browser-supplied Shop identity, role, token or D1 binding. The routes remain 404 unless `OWNER_INVOICE_PROFILE_ENABLED=true` **and** `OWNER_WRITE_GRANTS_ENABLED=true`; production must not enable the flag without separate review and a real authenticated hosted smoke test. The exact API is `GET /api/owner/invoice-profile` and `POST /api/owner/invoice-profile`. GET returns `{success:true,data:{shopId,profile,revision}}`. POST accepts only `{expectedRevision,profile}` (application/json), and confirms the same response shape. Return 409 on stale/ambiguous failed compare-and-set; clients must reload before retrying.

**Important scope restriction:** Preferences are inert preview data. They do not affect current invoices, existing receipts, logo storage, payment terms, numbering, A4/thermal/Business Pad rendering, or actual printer controls. Original `Receipt Size`, `Invoice Footer`, `Invoice Show Signature` and other source Settings are intentionally untouched. Modern/Elegant/Bold designs remain unsupported. A future reviewed M03/M09 print-mapping PR is required before claiming functional Invoice Studio print parity. Business staff invitation and sign-in remains M04 issue #867.

## Tests and CI

- Superpowers RED: missing M09 profile module; GREEN exact-normalization test 2/2.
- Real isolated local Workerd/D1: **8/8** tests across Shop A/Shop B, persistent read/write, concurrent CAS, invalid presets, wrong Shop/token, lease rotation and expiry, corrupted database value, private Hono route security, no public route.
- Chromium browser: **6/6**, including mocked authorized HTTP save/reload, stale conflict, cross-Shop response denial, absent API preview mode, revoked Owner during save and original 320/390/768/1024/1440 layouts. These are *local synthetic* tests, not a deployed Cloudflare proof.
- `npm run verify:source`, `npm run docs:check`, `npm run build:owner-frontend`, `npm test` and the pinned Wrangler workflow form PR acceptance; hosted authenticated acceptance is blocked pending M03 route registration.
- File ownership: M09-only `src/modules/m09-owner-invoice-*`, UI bridge, tests and CI. Does **not** edit `src/m03-owner-redemption-worker.js`, `src/db`, `migrations`, `src/rpc` or the shared `scripts/build-owner-frontend.mjs`. Check current PR reservations before any merge.

Rollback is safe: leave the private route disabled and stop displaying the optional Save control; existing printing and money remain untouched.
