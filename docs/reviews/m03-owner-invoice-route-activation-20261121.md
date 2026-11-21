# M03 — Private Owner Invoice Studio routing (21 Nov 2026)

**Workstream:** M03 integrated private Worker; M09 owns the imported business profile adapter. **Tracks:** #870. **Predecessors:** #871 (HisabIQ Settings UI), #873 (two-Shop D1 adapter, HTTP installer and browser save bridge), both merged. **Base:** GitHub main after #864. **Non-goals:** M04 staff login #867; actual sales invoice rendering; logo/terms storage; public RPC; production D1 migration.

## What this change does

Register the already-reviewed `registerOwnerInvoiceProfileRoutes` inside the existing private `src/m03-owner-redemption-worker.js`, passing its unchanged `protectLogin`, `limitBody` and trusted `verifiedOwnerPurchaseContext(c,true)`. No new credential, cookie, account directory, router, standalone Worker or database binding is introduced. The server chooses the authenticated business from current Control D1 session and exact immutable Shop D1 identity, never from the submitted body. Existing Owner origin, rate limit, no-query-string, strict cookie, CSP and JSON-body checks remain in force.

**A merge does not activate saving in hosted ERP.** The endpoint continues to return 404 unless both flags `OWNER_LOGIN_ENABLED=true` (private middleware), `OWNER_WRITE_GRANTS_ENABLED=true` and the new, separate `OWNER_INVOICE_PROFILE_ENABLED=true` hold, and its verified Shop binding, SQL-time active grant and session checks pass. Current hosted profiles have not been modified to enable the new flag. The Settings browser UI automatically stays preview-only and offers no Save control while the endpoint returns 404.

When explicitly activated after a release review, `GET /api/owner/invoice-profile` returns only this business's validated preview profile and CAS revision; `POST /api/owner/invoice-profile` accepts only `{expectedRevision,profile}`. The M09 adapter writes one inert `settings` key `HisabIQ Invoice Studio v1` using existing schema. SQL checks immutable Shop identity and current Owner lease in the exact write, not in a separate preflight. Replayed outdated revisions fail closed. Browser cross-origin POST is rejected before reading a Shop and cannot post to another business.

The original source Invoice Design bootstrap, receipt printing, invoice logo, terms, paper and language output, plus other financial workflows remain unchanged. **Saved preview preferences do not redesign actual printed invoices.** The UI label changes only after a verified same-Shop bootstrap to explain that preview preferences may be saved but printing is unaffected.

## RED → GREEN

- Initial isolated wiring contract fails without the private Owner Worker integration and linked client notice.
- Current wiring contract 2/2 green; M09 profile contract 2/2; old Settings compiler and client contract 3/3.
- Real local Worker+Control D1+Shop D1 test: authenticated Owner read, true Owner cookie, current immutable Shop identity and current Shop token write grant; original M02 Settings key, persisted read/save/reload, conflict on stale CAS, strict body/Origin, wrong client Shop, wrong Owner cookie, direct disabled flag, Owner lease revoked and session revoked.
- M09 two-Shop Workerd adapter tests remain separate and cover cross-business isolation at the actual SQL boundary.
- Existing HisabIQ Settings/Invoice Studio Playwright six tests cover viewport 320/390/768/1024/1440 and browser save/reload/conflicts/wrong-Shop/revocation.
- No production secrets, remote D1 migrations, Cloudflare credentials or actual release activation.

## Future release gate

The M03 integrator must approve current Owner session/Shop D1 identity and data scope, check feature-toggle staging configuration and current GitHub Actions on exact PR head, and run hosted authenticated pilot Owner login → Settings → Invoice Studio → save → reload → sign out → access denial. Validate a different Shop owner cannot view or write that pilot business. Require shop backup and rollback notes before enabling the feature flag. Rollback sets `OWNER_INVOICE_PROFILE_ENABLED` absent/false; inert persisted preference row remains safe and does not affect invoices. UI never claims printed invoice parity until M09 renderer/branding/terms mapping is separately proven.

## Ownership / remaining

- M03: current Owner Worker private route integration and feature-gate release.
- M09: template parity, print renderer compatibility, settings validation, Invoice Studio accessibility.
- M04: separate business-scoped staff invitation, role permission, login and revocation #867.
- M01: preserved source browser/print regression and design parity.
