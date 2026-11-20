# PORT-P3 Run 1 — first Super Admin setup ticket (offline-only)

**Tracking:** #699 (PORT-P3), #23 (M04), #456 (coordination), #306 (M11).
**Base:** main `f7f36da1cc84cb0bfaae0775cd610cdfe7ec3d12`.
**Scope:** new `src/auth/port-p3-first-admin-ticket.js`, new `tests/integration/port-p3-first-admin-ticket-workerd.spec.mjs`, and this plan. M04 owns authentication. No edits to `src/db/**`, SQL migrations, public/private Worker entry points, Wrangler, frontend, shared CI, or production Cloudflare resources.

## Security boundary and design
The existing private enrollment path consumes a setup ticket only after Google-signed ID-token verification with matching nonce/issuer/subject, and a permanent singleton in D1. What is missing is a reviewed first-ticket issuer. In this small slice the issuer runs **only in a separately authorized trusted operator process with an already authorized Control D1 binding**. It is not an HTTP handler, installer CLI, or deployment authorization. There is no privileged bootstrap endpoint. The caller must verify the Google subject and record operator approval outside this helper; the helper's input is **not** a proof of operator authorization.

The issuer generates a cryptographically random 32-byte bearer ticket and independent 32-byte base64url nonce using Web Crypto. Only the SHA-256 digest of the decoded ticket bytes and the nonce/issuer/approved Google subject are stored in `platform_setup_tickets`. Expiration uses the D1 server clock with a fixed 10-minute maximum. A **single conditional INSERT** denies a new ticket while any unrevoked, unexpired ticket exists, or after `platform_first_superadmin` exists; concurrent calls cannot both win. A holder may revoke an active unused ticket by digest. Expired/lost tickets may be replaced, never restored from D1. All rejected operations return fixed, non-secret outcomes; no token logging or public Worker import.

This is a **pre-enrollment** operation. It never inserts a Super Admin, `platform_admin_auth`, or any session; never sets `PLATFORM_TOTP_SECRET` and cannot prove factor enrollment. First-admin MFA pairing, atomic activation/recovery, Cloudflare Access, hosted Google sign-in, local/remote migration and release are separate gates. Existing immutable first-admin SQL and Google/TOTP/session contracts remain unchanged.

## Test-driven tasks
1. RED: add new Workerd/D1 integration tests importing the absent issuer. Confirm expected missing-module failure on the exact test path.
2. GREEN: implement only ticket issuance and unused-ticket revocation. Assert valid stored hash/nonce/subject, ≤600000 ms SQL-clock lifetime, no plaintext persisted, no duplicate active or concurrent issuance, expired/revoked replacement, no issuance after first admin, invalid subject zero-query denial.
3. Run the focused Workerd/D1 spec and relevant existing platform bootstrap/session specs. Run full repository CI on the exact head. Preserve external Cloudflare build status as a separate release gate.
4. Independent /super qa and /super review, security/ownership review by M04 and M11; request explicit owner approval before merge.

## Deployment / rollback / release
All changes remain unimported from deployed Workers. Revert this PR to remove the helper; previously issued tickets remain subject to the existing database expiry/revocation checks. No production setup ticket is created by code or CI. **PORT-P3, PORT-00 and M11 remain NO-GO** until a trusted installer and MFA seed recovery ceremony are independently approved and hosted, with two-user access-denial proof, end-to-end session/revocation tests and owner-approved migration and release procedures.
