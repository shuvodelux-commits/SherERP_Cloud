# SherERP SaaS tenant onboarding pilot

Status: proposed for M03, M04 and M11 review. This change adds a local feasibility test. Live account enrollment, shop data access and remote provisioning require their own reviewed implementation.

## First business setup

- Bootstrap a single platform Super Admin through a one-time controlled operation using a verified Google identity and its stable issuer and subject. Persist authorization in Control D1. Apply the platform admin MFA release gate from the SaaS requirements before granting live authority.
- Use the existing native Google signature verification and nonce checks. The production platform session implementation must issue revocable opaque sessions and validate them against Control D1. Retain the 5 ms per-request CPU acceptance check on hosted Cloudflare with cold and warm requests.
- Let the Super Admin reserve an immutable shop ID, record the provisioning operation and choose an approved Owner recipient. Provision only the approved shop database, apply its migrations, verify its identity and record readiness before enabling membership or routing.
- Use a single-use, expiring Owner invitation bound to the shop and verified intended recipient. Consume it and create the Owner membership atomically in Control D1 with an auditable actor and operation ID. Replays cannot create another membership or grant platform roles.
- Derive shop access from a current server-validated session and active membership. Platform Super Admin authority governs provisioning. Access to a shop's ERP data requires an explicit shop membership.
- Privileged provisioning and migration credentials belong outside the tenant-facing Worker. The application starts with one codebase, one Control D1 and a separate D1 binding per shop. Protect against retries, stale configuration and wrong database mappings before turning on provisioning automation.

## Local feasibility evidence

`tests/integration/m03-tenant-binding-pilot-workerd.spec.mjs` runs a Worker with three freshly generated local-only D1 bindings. It models a minimal Control D1 with sessions, membership and tenant status and a sentinel row in each shop. It accepts a user with memberships in both shops, rejects cross-shop and unverified requests, denies implicit access for a synthetic platform identity, rejects expired and revoked sessions and stops on a mismatch between the selected shop and its stored marker. This tests marker mismatches and membership denial. It does not verify hosted database UUIDs or exercise platform RBAC. This read-only fixture has no deployments or business APIs.

Run with the pinned local Wrangler used by M03 CI:

```sh
node --test tests/integration/m03-tenant-binding-pilot-workerd.spec.mjs
```

Before opening the Owner flow, prove atomic invite acceptance and overlapping provisioning retries, test actual sessions with two nonproduction shops, rehearse backup and recovery, and measure binding changes and limits at the planned scale. Keep historical SQL import separate from account configuration and point the business import at the intended shop database only after reconciliation.

## First-admin enrollment proof

The internal bootstrap uses a trusted Control D1 binding and OAuth client ID. A future operator flow must preapprove the exact Google issuer and subject, mint a random 256-bit setup token and a unique Google nonce, and cap ticket validity at ten minutes. The proposed schema stores the token digest. Keep setup tokens out of URLs, logs and GitHub. The bootstrap checks the signed credential against the ticket nonce and the preapproved subject. Its conditional D1 insert consumes the ticket by recording it in the permanent first-admin enrollment row. The row stays immutable as an audit record, including if future operational access is revoked or recovered.

The bootstrap SQL is exercised locally from the isolated Control D1 staging migration queue. The bootstrap issues no session, opens no HTTP endpoint and grants no shop membership. Live enrollment still requires an approved Control D1 migration, a reviewed ticket issuance and recovery workflow, platform MFA, and the hosted CPU release check.

```sh
node --test tests/integration/m04-platform-superadmin-bootstrap-workerd.spec.mjs
```

## Platform session proof

The private session service requires the enrolled Google subject, a browser-bound nonce, and a six-digit authenticator code. The trusted server supplies the OAuth client ID, the factor version, and a separate 160-bit authenticator secret through its protected configuration. It keeps the authenticator secret out of D1. Native Web Crypto verifies RFC 6238 codes in the current or immediately previous 30-second step. D1 limits the single admin to five Google-verified OTP attempts per rolling minute and allows one attempt per browser challenge. The limit is enforced after Google verification. The private ingress must independently limit traffic before verification and Google signing-key fetches. The final insert rejects already-used or older code steps and any challenge that is no longer current. The session expires after 15 minutes. D1 stores only its digest and checks current admin state and factor version on every validation. Protected writes must recheck authorization at their atomic write boundary.

The fixture uses monotonically increasing factor versions so re-enabling the account cannot restore prior sessions. Advance the version with factor rotation, disablement and re-enablement. Keep successful session/step evidence during this pilot. A future cleanup must preserve replay protection and cannot clear the active attempt window. TOTP does not provide phishing-resistant MFA. Before any remote route, review the separate admin origin, public ingress limits, challenge creation, secure cookies, CSRF, secret enrollment and recovery, and the hosted CPU release check. This module and fixture do not attach a route, provision a shop or issue a client Owner invitation.

```sh
node --test tests/integration/m04-platform-superadmin-session-workerd.spec.mjs
```

## Private browser transport

The separate `src/m03-private-platform-auth-worker.js` entry exposes JSON routes only. It requires a dedicated HTTPS origin, the Control D1 binding and a configured ingress limiter. The origin must match exactly on the request URL and on browser POST requests. The route rejects query parameters. Use the following endpoints from the same origin:

| Method and path | Browser action |
| --- | --- |
| `POST /api/platform/setup/challenge` | Submit the privately issued setup ticket in JSON as `setupToken` and receive the Google client ID and nonce. |
| `POST /api/platform/setup` | Submit the signed Google `credential`. The setup cookie supplies the ticket. This records enrollment without creating a session. |
| `POST /api/platform/auth/challenge` | Start a browser-bound Google login challenge. D1 permits eight issued challenges per rolling minute for this single-admin pilot. |
| `POST /api/platform/auth/login` | Submit the Google `credential` and authenticator `code`. The Worker returns the role and sets the session cookie. |
| `GET /api/platform/auth/session` | Restore the role from the D1-backed session cookie. |
| `POST /api/platform/auth/logout` | Cancel a pending browser challenge and revoke any related session, along with the session cookie presented by the browser. |

All auth cookies are host-only, Secure, HttpOnly and SameSite=Strict. Sign-out and queued login are serialized by D1, so a login cannot leave a valid session if it races sign-out with the same challenge. Preserve cancellation records until the associated challenges can no longer be used. The Cloudflare limiter executes before reading credential bodies or looking up Google keys. Its per-location allowance is approximate and does not authenticate the caller. Before attaching any route, establish a private-host admission control, verify its limits, and approve a distinct Control D1 binding, migrations, ticket and authenticator provisioning, associated Google client settings, and the hosted CPU and recovery checks. The default Worker remains database-free and has no platform auth route. The private page and isolated Control D1 rehearsal are documented in the [platform auth staging runbook](../runbooks/M03_PLATFORM_AUTH_STAGING.md).
