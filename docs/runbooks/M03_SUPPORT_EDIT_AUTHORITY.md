# M03 — Support Edit authorization foundation (not active in production)

Issue: #765 — the one-operator Super Admin must be able to visit an actual Shop ERP for troubleshooting, and—when separately authorized—perform corrections with an auditable Support identity.

## Current production baseline

The original first-Shop Support Mode is now deployed at
`https://admin.hisab.workers.dev` using the **actual existing Owner ERP UI**
compiled into an Admin-only read-only asset bundle. It requires the existing
Admin Google + MFA-backed session, a 5-minute Support START grant and the
immutable Control D1 ↔ physical Shop D1 binding. Read APIs audit every
permitted access; business POST requests remain denied. The existing
`m03_local_support_grants` and audit schema is already installed in Control
D1. The deployment did not alter Shop D1 data.

## New implementation in this PR

`src/modules/m03-support-write-authority.js` provides two internal-only
functions:

- `requestSupportEditGrant(env,{readGrantOperationId,writeGrantOperationId,scope,reason,otpCode,sessionToken})`:
  must start from an **active, immutable, verified 5-minute read grant**.
  Requires the same current Admin session and actor, exact ready Control D1
  binding, matching physical Shop D1 identity, and **fresh current authenticator
  TOTP**. One OTP time step is accepted at most once per Admin session.
  Attempts (including wrong codes) are throttled to five per 60 seconds.
  Produces an immutable, actor-scoped, one-Shop, one-module edit grant that
  cannot outlive its parent Support session.
- `authorizeSupportWriteIntent(env,{grantId,action,intentId,intentHash,sessionToken})`:
  checks that the support grant, same Admin, actual Shop D1 and chosen
  module scope all remain valid. Appends a uniquely idempotent
  **authorization intent** and immutable audit event. A repeated intent is
  accepted only when its actor, action, grant and digest match. A different
  payload, revoked grant, rotated MFA, stale Shop D1 or another module is
  denied. Nothing from the browser selects a D1 database or receives an
  Owner session.

A separate additive **Control D1-only** migration is staged at
`staging-migrations/platform-support/0002_support_write_authority.sql`.
It creates protected attempted-MFA receipts, edit grants, action intents and
append-only START/INTENT/RESULT/REVOKE-capable audit records. It does not
alter Shop D1 business tables or create new financial posting APIs.

### Critical release boundary

**THIS PR DOES NOT GRANT WRITE ACCESS TO THE ERP AND MUST NOT BE ACTIVATED
ON THE LIVE ADMIN BY ITSELF.** The flag `M03_SUPPORT_WRITE_ENABLED` is
absent/false on all deployed Workers, and no HTTP route calls the functions.

In particular, `authorized-intent` is *not* authorization to directly
execute any Shop SQL. It only proves the Control D1 intent was approved.
Every future write adapter must:

1. Receive a private request-scoped **Support actor** distinct from Owner
   (never issue or impersonate an Owner token).
2. Check the exact Shop D1 and active operation grant **inside the same
   atomic Shop D1 SQL write transaction**, preserving the original M03
   idempotent receipt, stock, cash-session, posting and reversal rules.
3. Persist an action/result receipt in the Shop D1 with actor, tenant,
   operation ID, canonical payload fingerprint and authorized Support
   intent ID. A verified platform audit **RESULT** must reference the
   Shop receipt. No silent/cross-D1 blind retry or repeated sale/payment.
4. Deny unsupported modules and sensitive actions unless explicitly
   approved. Scope is separate for Products, Parties, Purchases, POS,
   Returns and Finance. Historical opening balances stay excluded from
   cash-flow posting per the existing ERP accounting contract.
5. Recheck the current Admin Google+MFA session, Shop Ready state, support
   grant, device/session revocation and five-minute expiry. End Support
   must instantly fence both read and write intents.
6. Provide an explicit Support Edit UI with reason, module selection,
   fresh TOTP, visible actor/Shop, persistent audit and a confirmation
   step for irreversible financial actions. Default remains READ ONLY.
7. Require independent M03/M04/M08 and M11 review, a protected Control
   D1 backup/restore rehearsal and full two-Shop isolation/regression
   tests before *any* real financial or business write can be activated.

## Workerd TDD

The new tests first failed with a missing module. After implementation,
seven isolated Control D1 + physical Shop D1 tests pass: default-off,
incorrect TOTP, throttling, OTP replay, correct single-Shop MFA grant,
immutable actor identity, scope-limited operation intent, exact replay,
read-grant revocation, Admin logout, physical D1 swap, no Owner session,
and no Shop D1 business mutations.

No production migration, Cloudflare deployment, new secrets or Owner
operational module changes are included. Parallel Party UI and
Products/POS/Finance development continues without ownership conflict.
