# M03 — Visit Shop for Support (hosted first-Shop pilot)

**Scope:** Connect the already-built local M03 five-minute Support Mode to
the deployed, authenticated `admin.hisab.workers.dev` Control Center.
This initial implementation works **only for an existing, prebound, fully
verified Shop D1** and displays read-only catalog setup diagnostics inside
Super Admin. It is **not** impersonation, a full live ERP visit, staff
access, or permission to change sales, prices, stock or finance.

## UI workflow

1. Sign in to Super Admin with the existing verified Google + TOTP.
2. Expand **Recent businesses**. A business must be `Ready` in Control D1.
3. Select **Visit for Support** for the ready shop.
4. Type a support reason (12–180 characters), then choose **Start read-only
   support**. The grant is tied to the current Admin D1 session and one exact
   Shop D1 identity, and expires in five minutes.
5. Read category/unit setup counts without raw Owner credentials or a
   financial API. The audit records START and every permitted READ.
6. Choose **End support**. The grant is revoked and END is durably logged.
   Other Shops cannot use the same token. A revoked, expired, or MFA-invalid
   Admin cannot perform further support reads.

**Current limitation:** A true browse-through of every existing Owner ERP
page requires a separately reviewed, support-scoped **read-only Owner API
proxy and per-tenant routing**. Never obtain this by using the Owner cookie,
changing the Owner's Google identity, removing role checks, or allowing
client-selected D1 bindings. Only the first prebound Shop can currently be
inspected. Additional shops require their own verified private binding and
routing.

## Existing components reused without reimplementation

- `src/modules/m03-local-support-read-grants.js`: one-time bearer,
  five-minute expiry, current MFA-backed Admin session, reason, immutable
  START/READ/END SQL events and fail-closed D1 checks
- `src/modules/m03-local-support-shop-diagnostics.js`: restricted,
  read-only Shop catalog setup counts
- `staging-migrations/platform-support/0001_support_grants_and_events.sql`:
  reviewed, immutable support grant/audit schema; unchanged
- Existing Admin business list, Shop D1 prebound identity and setup gates

The **new** adapter `src/auth/m03-hosted-support.js` verifies the exact
prebound pilot and its current `ready` state for each operation. Only
`PLATFORM_HOSTED_SUPPORT_ENABLED=true` plus the existing verified pilot
binding can expose this private feature. The old test-only Support Mode
gate remains inaccessible in the hosted Worker.

## Release checklist

1. Review GitHub branch/PR checks and other active workstreams. Do not
   modify the Owner Worker, public Worker, finance or RPC routing.
2. Check `admin` still binds the correct `CONTROL_DB` and
   `PLATFORM_PILOT_DB`, with Shop immutable identity and 13 reviewed
   migration receipts. Confirm Admin MFA and the Shop's `Ready` state.
3. Export **Control D1 before schema changes** and verify a local
   SQLite restore with `PRAGMA integrity_check=ok`. Keep the backup
   private; never upload it to GitHub or expose temporary export URLs.
4. Run `node scripts/m03-hosted-support-migration.mjs --generate
   .wrangler/hosted-pilot/migrations` in the authorized deployment checkout.
   It checks the SHA-256 of the existing reviewed SQL and produces only
   `0014_hosted_support_grants_and_events.sql` under ignored `.wrangler`.
5. Apply the **one** reviewed, pending Control D1 migration with Wrangler
   after confirming it is the only pending migration. There are no Shop D1
   changes and no financial or product table mutations.
6. Set the Admin-only Worker variable
   `PLATFORM_HOSTED_SUPPORT_ENABLED=true` while retaining the existing
   Google/TOTP security secrets, D1 bindings and all previous flags. Do
   not activate on `shererp`, public previews, or another unverified Shop.
7. Deploy **only** the Admin Worker. Verify anonymous Support API calls
   reject access, current login and MFA remain operational, and the Shop
   list shows **Visit for Support** for Ready businesses.
8. In a real authenticated browser, start a support session, inspect
   counts, end it, and confirm corresponding immutable Control D1
   START/READ/END records. Repeat the attempted read after END and
   verify 403. Test wrong Shop ID, logout and MFA/session revocation.
9. Keep a pre-deployment Admin Worker version available for rollback.
   A Worker rollback disables the feature but **does not delete** the
   immutable audit history or unapply the migration. Those should be
   preserved. Never delete/reset the actual first Owner or Shop.

## QA performed locally

- Workerd tests check same-Shop issuance, replay, cross-Shop denial,
  five-minute expiry, session rotation, source D1 mismatch, immutable
  audit, read-only diagnostics, and disabled local support test gate
- Browser test confirms **Visit for Support**, scope, reason, diagnostic
  counts, End Support, and mobile layout
- Generator test verifies reviewed source hash, repeatability, and
  private-only output path

**Not a production ERP signoff:** Full Owner ERP support browsing,
sensitive transactional reports, dynamic multitenant D1 routing, and
financial write access remain independent releases.

## M03 extension: Visit the *actual* ERP, not just setup diagnostics

The original diagnostic panel is retained, but **Visit for Support** now
adds **Open actual Shop ERP · Read only** while a 5-minute audited grant is
active. The protected `/support/erp` Admin route serves a fresh build of
`buildOwnerFrontend` (same legacy HTML, native navigation and dashboards),
with an explicit read-only banner and **Shop Activity Log** action. There is
no Owner session, Google impersonation or Owner D1 write permission.

`node scripts/build-support-owner-erp.mjs` is a deterministic packaging
step. It outputs ignored `dist-support/owner-erp.html` and the same
allowlisted product-preview assets as the Owner build. The private Admin
release config must bind these assets with
`assets: {directory:'../../dist-support', binding:'ASSETS', run_worker_first:true}`
from the existing `.wrangler/hosted-pilot/` directory. The original login
page continues to use the imported `frontend/platform-auth` assets.
Never upload `dist-owner` or the *public* frontend as Admin Worker assets.

The Admin GET API `/api/platform/support/erp/*` is hardcoded to existing
Shop D1 read adapters for app-shell, Products, Suppliers, Purchases, Cash
Session, POS and Return lookups. Every read requires the current MFA-backed
Admin D1 session, active support grant and verified prebound Shop D1, and
writes an immutable READ audit event. **No business POST route exists**, and
replay or browser-supplied Shop selection cannot change the D1 binding.
Requests after End Support, token expiry, or Admin session revocation fail.

**Shop Activity Log** displays real Shop receipt events *only when their
reviewed operational tables exist* (product creation, credit purchases,
cash POS sales, cash returns, and Cash Session openings); it also displays
immutable START/READ/END support events from Control D1. It does not
fabricate missing history, claim to show all staff actions, or expose Owner
Google identity. It is a bounded recent-activity view, not a full accounting
audit export. Untested/unmigrated ERP modules remain unavailable in the
existing UI, even though the original navigation is present.

### Extra acceptance checks

1. Rebuild `dist-support` from the exact reviewed GitHub revision.
2. Verify anonymous `GET /support/erp` is denied; no public path can fetch
   its raw `owner-erp.html` through static assets.
3. Confirm an authorized Support session opens the *actual* Owner UI with
   Dashboard/Products navigation and a read-only banner. Click **Shop
   Activity Log** and verify D1-backed events and timestamps.
4. Attempt POST to every visible financial/product route and verify 404/405
   or 403: no purchase, sale, refund, product, supplier, cash or bank write.
5. End support; reload `/support/erp` and Shop data endpoints, verify access
   denied. Recheck expiry and MFA rotation. Logs retain START/READ/END.
6. Verify unchanged Owner `/app` sign-in and Google/OAuth; do not touch the
   Owner Worker, its compiled `dist-owner`, finance migrations or public RPC.

**Release boundary:** This extension is currently for the *single* immutable
Shop D1 deployed as the pilot; other tenants require verified D1 routing.
The existing `verifiedPreboundPilot` helper also checks the exact 13-step
owner-ready schema snapshot. Additional reviewed operational migrations may
need a coordinated, safe upgrade of that verification contract **before**
Support Mode continues to work; do not disable the snapshot check as a
shortcut or write to financial schemas in this support PR.

The live Admin deployment remains a separate, reviewed action after PR CI,
Admin D1 backup/restore verification, exact private Cloudflare bindings,
and signed-in browser acceptance. Any Admin Worker rollback must preserve
previous audit rows and the Shop Owner login. Never enable financial writes
in a support release.
