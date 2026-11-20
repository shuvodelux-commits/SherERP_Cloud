# PORT-P3 Run 2 — First Super Admin MFA Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Prove first platform Super Admin Google+TOTP factor activation exactly once on disposable local Control D1 after merged PORT-P3 ticket issuance and first identity enrollment.

**Architecture:** A new, nondeployed M04 helper uses the existing Google ID-token verifier and Control D1 `platform_setup_tickets`, `platform_first_superadmin`, `platform_admin_auth` tables. It authenticates a fresh signed credential with the original setup nonce, checks a TOTP proof against D1 time, then performs one SQL-time-guarded insert of version 1. No shared module, migration, production Worker, binding or installer is modified.

**Tech Stack:** JavaScript ES modules, Web Crypto HMAC-SHA1/TOTP, Hono Google JWKS verifier, Cloudflare Wrangler 4.161.0 Workerd/D1 test harness, Node 22 test runner.

**Spec:** PORT-00 issue #699 P3; source contract at `src/auth/platform-superadmin-bootstrap.js`, `src/auth/platform-superadmin-session.js`, and `staging-migrations/platform-auth/0001_platform_bootstrap.sql` / `0002_platform_sessions.sql`.

## Global Constraints

- Base: `main@0319b58e87819da49a33aff9b725da7cc4bca3b4` (merged #782), with **zero open PRs at reservation**.
- New M04-owned files only: `src/auth/port-p3-first-factor-activation.js`; `tests/integration/port-p3-first-factor-activation-workerd.spec.mjs`; `.github/workflows/port-p3-first-factor-activation.yml`; this plan.
- No change to original or public Worker routes, private auth Worker, `src/db/**`, migrations, `src/rpc/**`, `wrangler*.jsonc`, UI, cash/posting or Cloudflare deployment.
- This internal helper expects an independently approved **trusted operator** already holding verified Control D1; it is not an authorization, enrollment page or remote installation mechanism.
- **Never** commit/log a real token, secret, OAuth credential, production D1 UUID, email, or authenticator QR. All tests use synthetic ephemeral keys and secrets. No Cloudflare API calls or remote D1 writes.
- Secret provisioning, recovery, audit of operator identity, hosted Cloudflare Access and actual private deployment stay blocked until separate M03/M04/M10/M11 review and owner authorization.

## Review Focus

- Already-enrolled Google identity does not itself prove the current actor: require a **fresh verified Google ID token** with the original nonce and stable subject before factor activation.
- Ticket expires or is revoked between credential verification and final SQL: final D1 mutation rechecks the SQL clock and token hash; no activation.
- TOTP time changes during crypto verification: final SQL validates that the matched step is current or previous against its own current time.
- Multiple valid calls race: at most one `platform_admin_auth` singleton row can be created; duplicates and replays deny without incrementing version.
- This local proof cannot atomically install/rotate the Cloudflare TOTP secret. No activation in hosted environment until the external secret and recovery ceremony are separately designed, reviewed and approved.

---

### Task 1: RED — local first-factor activation contract

**Files:** Create `tests/integration/port-p3-first-factor-activation-workerd.spec.mjs`, `.github/workflows/port-p3-first-factor-activation.yml`.

**Interface:** `activateFirstPlatformFactor({controlDb,setupToken,clientId,credential,totpSecret,code}) => Promise<boolean>`.

- [ ] Write tests that run against real disposable local Workerd Control D1, apply existing two auth migrations, use synthetic signed Google ID JWT and synthetic 20-byte TOTP secret.
- [ ] Reject malformed secret/code/token without querying D1, missing first-admin enrollment, wrong Google subject/nonce/audience, wrong OTP, and expired ticket.
- [ ] Verify concurrent attempts commit exactly one `platform_admin_auth` singleton; assert version 1 enabled, no stored secret, no replay.
- [ ] Simulate ticket expiry between verified preflight and SQL insert; fail closed with zero auth rows.
- [ ] After positive activation, use existing `issuePlatformSuperAdminSession` and `validatePlatformSuperAdminSession` with a real local D1 challenge; no new auth path.
- [ ] Commit test and PR-only workflow before implementing feature.
- [ ] Observe exact RED failure (`ERR_MODULE_NOT_FOUND`) in GitHub Actions Workerd run; report if RED was not observed.

### Task 2: GREEN — atomic initial factor activation

**Files:** Create `src/auth/port-p3-first-factor-activation.js`.

- [ ] Validate exact 40-hex secret and six digits before DB access.
- [ ] Hash the approved 64-hex setup token with existing `hashOpaqueSessionToken`; inspect current ticket+enrollment+nonexistent auth using Control D1 SQL time and nonce.
- [ ] Reuse `verifyGoogleLoginIdToken` with trusted clientId and ticket nonce; compare issuer/subject.
- [ ] Verify HMAC-SHA1 6-digit TOTP for D1 step and previous step, with code comparison not dependent on JS Date.now.
- [ ] INSERT enabled first factor version 1 through SQL-time predicates on live ticket, nonce, Google issuer/subject, matched TOTP step and `NOT EXISTS(platform_admin_auth)`; concurrent/replay returns false.
- [ ] Watch exact GREEN focused Workerd run pass and existing platform bootstrap/TOTP session regressions pass.
- [ ] Run full GitHub exact-head CI; fix security or policy findings with new RED→GREEN cycles, preserve failed external Workers Builds status.

### Task 3: Review / release handoff

- [ ] Verify only four new paths in PR; compare against any new open PR file reservations.
- [ ] Independently inspect caller privilege requirements, database-time races, secret lifecycle, and original auth/session compatibility.
- [ ] Document known blocked recovery: factor rotation needs an approved secret store, D1 monotonic version bump, session revocation and rollback; no automatic reset based only on Google account or setup token.
- [ ] Leave PR draft/unmerged until independent M04/M11 review, full exact-head CI and explicit owner approval; never activate production resources.
