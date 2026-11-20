# M03 Option A — Existing Super Admin UI → Private Provisioner service

**Status:** Integration code reviewed locally, **not deployed**. Reuses original
Create Business, Resume Setup, business directory and Google+TOTP sessions.
The existing first Shop prebound pilot is deliberately unchanged.

## Boundary and prerequisites

The Admin Worker will invoke the isolated Provisioner Worker only when all
of these are present, **simultaneously**, in its deployment environment:

- `PLATFORM_PRIVATE_PROVISIONER_ENABLED=true`
- `PLATFORM_SHOP_RESERVATION_ENABLED=true`
- `PLATFORM_SHOP_DIRECTORY_ENABLED=true`
- Neither `PLATFORM_HOSTED_PILOT_ENABLED=true` nor
  `PLATFORM_LOCAL_PROVISIONING_ENABLED=true`
- A **real Cloudflare service binding** named `PLATFORM_PRIVATE_PROVISIONER`
  with a callable `fetch`
- A protected 64-character `PLATFORM_PROVISIONER_INTERNAL_KEY` secret,
  whose value matches the Provisioner Worker's independent
  `PROVISIONER_INTERNAL_KEY` secret
- Reviewed Control D1 migration
  `0012_hosted_shop_provisioning_journal.sql`, after an approved backup

There is **no** Cloudflare API token on the Admin Worker. The existing
Admin Google+TOTP session is validated before each service call, and the
Provisioner independently validates the same current session against
Control D1. The service URL `https://provisioner.internal` is an
internal request target, **not** a public Cloudflare route. The request
contains only the exact allowed fields plus a protected service secret
and opaque current Admin session. No private service response, token,
D1 database ID, binding key, marker or receipt is returned to the
browser. The browser sees only the current, Admin-scoped Control D1
`operationId`, `shopId`, display name, Owner Gmail and safe stage.

## Existing API contract, not a second UI

| Original Admin endpoint | Hosted private behavior |
| --- | --- |
| `POST /api/platform/shops` | Privately reserve immutable Shop + Owner Gmail and journal |
| `POST /api/platform/shops/resume` | Normally read journal only; D1 creation needs a **separate** `PLATFORM_HOSTED_D1_CREATE_APPROVED=true` gate |
| `GET /api/platform/shops/setup/:operationId` | Verify Admin scope; read journal + existing immutable Shop reservation |
| `GET /api/platform/shops/list` | Reuse existing max-50 private business directory, overlay non-secret journal stages |
| `GET /api/platform/auth/session` | Expose `hostedProvisioningEnabled` capability only when binding, key and flags are all configured |

The old frontend form and status panel remain in use. A separate
`hostedProvisioningEnabled` capability selects the existing Owner Gmail
form; all original local-only and prebound pilot behavior remains in its
previous path. Stage translations are `reserved` → Reserved,
`creating` / `outcome-unknown` → Allocating,
`database-created` → Allocated (Preparing database). **None of
these states grants Owner login**. Only the existing Control D1's
separately verified `ready` stage can show Ready. An inconclusive
Cloudflare creation is shown as a safe database-creation issue.

## Before enabling anything on a live account

1. Get independent security review and merge of private Provisioner and
   full-Worker-binding publisher contracts. Configure **one**
   Cloudflare Worker publication owner, not competing Cloudflare Builds.
2. Implement and test the real pinned remote D1 migration executor,
   exact 13-step receipts/Shop identity and completed shared Owner Worker
   version upload/promotion and readback.
3. Finish the already-existing PORT-P2 two-Shop Owner routing and verify
   the full Owner read/write lifecycle for each separately authorized
   Owner identity, with revoked/suspended Shop and swapped database tests.
4. Verify the existing Control D1 and first Shop D1 backups are
   restorable, and only then apply the reviewed Control D1 migration.
5. Bind the Admin Worker to the private Provisioner via a **service**
   binding, not a public URL; install matching internal secrets. Ensure
   `PROVISIONER_RELEASE_ENABLED=false` and
   `PLATFORM_PRIVATE_PROVISIONER_ENABLED=false` throughout
   preflight. Keep `PLATFORM_HOSTED_D1_CREATE_APPROVED=false`.
6. Approve staged two-Shop release, verify rate limiting, callbacks,
   Create/Resume from the real Google+TOTP Admin, separate Owner Gmail
   login and original ERP, and independent D1 ledger/stock isolation.
   Only then explicitly enable approved flags in a controlled release.

**This PR does not change the current Cloudflare live Admin/Owner
configuration, D1 bindings or credentials.** It does not create a
database or complete multi-Shop onboarding by merging. It is a
fail-closed integration boundary with the provider already developed
in PR #834, retaining the existing UI and database source of truth.
