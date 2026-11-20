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
