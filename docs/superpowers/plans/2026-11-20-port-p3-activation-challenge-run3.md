# PORT-P3 Run 3 — One-time Activation Challenge and Recovery Gate Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Verify a separately nonce-bound, expiring, bounded-attempt, single-consumption Google identity challenge on isolated local Control D1 without enabling MFA, changing existing login or creating a recovery bypass.

**Architecture:** M04-only internal helper uses the merged first-admin ticket, immutable first platform admin and Google JWKS verifier. An explicit **test-only D1 table** stores a SHA-256 challenge token hash, independent nonce, original ticket hash, approved issuer/subject, SQL-time expiry and five-attempt counter. Challenge issue and consume use SQL predicates and unique/atomic writes. The helper is not imported by the deployed Workers. Production migration and atomic MFA activation with this challenge are separately blocked for M03/M04 integration.

**Tech Stack:** Cloudflare Workerd, D1 SQLite STRICT, JavaScript ES Modules, Hono JWKS verifier, Node 22 test runner, Wrangler 4.161.0 test harness.

**Spec:** PORT-00 P3 issue #699, M04 issue #23, coordination #456, prior PORT-P3 Run 1/2 merged PRs #782/#787, security TODOs in Run 2 PR #787.

## Global constraints
- Base: `main@447034b01d34333c935305f393ed97e1ee7d579e`, including merged #787; current active M03 PR #785 disjoint.
- New paths ONLY: `src/auth/port-p3-activation-challenge.js`, `tests/fixtures/port-p3-activation-challenge.sql` (TEST ONLY), `tests/integration/port-p3-activation-challenge-workerd.spec.mjs`, `.github/workflows/port-p3-activation-challenge.yml` (PR only/no secrets), `docs/installation/PORT_P3_RECOVERY_AND_SECRET_ROTATION_GATE.md`, and this plan.
- No shared `src/db`, `migrations`, `staging-migrations`, `src/rpc`, `src/index.js`, `wrangler*.jsonc`, public/private Worker entry, existing M04 session/activation module, frontend, production D1/secret, GitHub deployment, or shop/finance mutation.
- Challenge verification grants **no session, no privilege, no auth row, no recovery**. A later reviewed SQL-atomic factor-activation integration will need to consume challenge in the **same** SQL write as enabling MFA; this run deliberately does not claim that property.
- Precondition: trusted independently authorized operator already selected the exact Control D1 and obtained an already approved 10-minute original setup ticket and enrolled first admin. Possession of the setup ticket and a Google login alone MUST NOT enable MFA or reset a factor.

## Review focus
- Fresh challenge nonce must be independent of original setup nonce; limit to ≤2 minutes and original setup ticket remaining lifetime using SQL clock.
- SQL rejects incorrect first-admin subject, revoked/expired ticket and any existing active platform MFA before issuing a challenge or consuming it.
- Wrong Google issuer/audience/nonce/subject and malformed challenge tokens cannot succeed; verified signed Google JWT is required.
- Every attempted verification (including invalid credential) counts toward a SQL-time bounded allowance (at most 5); concurrent successes consume exactly once.
- Revoked, expired and consumed challenges cannot be replayed, even if verification races expiration; no plaintext token or factor secret in D1.
- Recovery procedure must prevent Google-account-only TOTP resets; require two-person/cloud-account approval, protected secret install, epoch bump, session invalidation and verified rollback — deferred, not implemented.

## Implementation tasks
### Task 1 — RED verified in GitHub
- [ ] Commit this plan and the TEST-ONLY STRICT fixture schema, never a staging/production migration.
- [ ] Commit Workerd/D1 acceptance tests importing a missing internal `issueFirstPlatformActivationChallenge` and `verifyAndConsumeFirstPlatformActivationChallenge` module.
- [ ] Test independent nonce/hash/TTL, initial-enrollment requirement, wrong subject/nonce/audience, five-attempt cap, concurrency, replay, expired/revoked setup and challenge, old MFA already active, and no session/auth row side effects.
- [ ] Add dedicated PR-only, no-secrets workflow; create draft PR and observe hosted RED `ERR_MODULE_NOT_FOUND` before implementing.

### Task 2 — GREEN minimum helper
- [ ] Implement the two functions plus `revokeFirstPlatformActivationChallenge` in a **new** M04 auth file. Only accept 64-hex opaque challenge/setup tokens.
- [ ] Use `createOpaqueSessionToken` and `hashOpaqueSessionToken`; mint an independent 32-byte base64url nonce; store only challenge hash and nonce, not plaintext token.
- [ ] SQL insert with joined original ticket and immutable first admin; reject active duplicate challenge and post-MFA issue, expiry=min(now+120000,original ticket expiry).
- [ ] SQL attempt-CAS increments before contacting Google, capped at 5; JWKS verifies nonce/client/audience/issuer/subject; final SQL update consumes once only if all current invariants still hold.
- [ ] RED-GREEN verified real local Workerd/D1, rerun existing PORT-P3 ticket/first-factor and M04 Google/TOTP session checks; full exact-head repository CI. Fix findings by new RED→GREEN cycle.

### Task 3 — recovery runbook and review
- [ ] Add human-oriented offline recovery gates, backup/rollback checklist, MFA secret/epoch atomicity limitation, and precise no-go decisions without any new token-reset backdoor.
- [ ] Compare exact file list against new parallel PRs, inspect auth/attempt races and expiry checks, document independent review and remote infrastructure approvals.
- [ ] Leave PR DRAFT/unmerged until independent M04/M11 review, full exact-head checks and human merge approval. Cloudflare external build failure separate.
