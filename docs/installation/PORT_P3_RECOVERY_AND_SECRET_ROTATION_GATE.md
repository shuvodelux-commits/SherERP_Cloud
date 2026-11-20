# PORT-P3 — Super Admin MFA setup, interrupted activation and recovery gates

**Status: DESIGN / NO-GO.** This is an offline operator checklist and approval contract, **not** a live installer, automatic account reset, SQL procedure or permission to access any existing Cloudflare account or D1. See PORT-00 #699, M04 #23, M03 #22, M10 #312 and M11 #306.

## What the repository actually has

| Proof | What is verified | What it does **not** provide |
| --- | --- | --- |
| PORT-P3 Run 1 (#782) | Local operator-only 10-minute setup-ticket issue/revocation; hash stored in Control D1; single first-admin binding | Installer authorization, Cloudflare Access, TOTP secret installation |
| PORT-P3 Run 2 (#787) | Local first-factor `platform_admin_auth` version 1 activation after verified Google identity and TOTP; replay and SQL time guards | Fresh activation-specific nonce, online attempt throttling, hosted secret-version consistency |
| PORT-P3 Run 3 (#789) | **Nondeployed local-only** distinct Google challenge nonce with a 2-minute SQL deadline, one active challenge, global five attempts per original ticket, exactly-once verification | Automatic MFA activation, role/session granting, account recovery, production migration |
| Existing M04 sessions | 15-minute Google+TOTP sessions tied to `platform_admin_auth.factor_version` | Safe second-account configuration or recovery from lost authenticator |

Run 3's `tests/fixtures/port-p3-activation-challenge.sql` is deliberately **TEST ONLY**. It is not installed in hosted Control D1, is not part of the numbered migration series and must not be copied into production. This is a security proof to review, not an exposed login API.

## Simple decision tree for a sole operator

1. **Before initial Google enrollment:** if a setup ticket is expired, it may be replaced only by the separately authorized trusted operator after verifying the intended Cloudflare account, Control D1 and Google subject. A replaced ticket does not recover any account.
2. **After immutable Google enrollment, before TOTP activation:** if the ticket expires or is lost, stop. The issuer intentionally cannot mint another setup ticket while the first-admin singleton exists. Do not delete the singleton, edit its subject, lower the authentication version or create an emergency user.
3. **After TOTP activation, when the authenticator is lost:** stop login attempts; Google sign-in alone is **insufficient** to reset MFA. Use only a future reviewed offline recovery ceremony, with **two independent proofs** (for example authenticated Cloudflare account ownership and an offline escrow recovery key). These proofs may be controlled by the same sole owner; separation of the proof channels matters.
4. **When a secret was rotated outside the application:** treat that as a lockout/release incident. Do not silently reuse a previous Worker/secret combination or reset factor version downward.
5. **If the protected Control D1 or second Cloudflare account cannot be authenticated:** no recovery action is permitted. Restore contact with the verified account owner and incident process first.

## Preflight record required before *any* future remote recovery

Record a reviewed operation ID and approval in a protected offline journal: reason, operator identity, Cloudflare account fingerprint, Control D1 UUID, exact private Worker version/release SHA, first-admin immutable Google subject fingerprint, current factor version, schema version, backup manifest digest, verified Access application/allowed origins and recovery evidence type. **Never** include the Google ID-token JWT, raw ticket, TOTP seed, offline recovery secret or D1 authentication token in the journal, GitHub PR, CI logs or screenshots.

Verify: latest authorized release, disabled public previews/alternate hostnames, no unapproved second writer, current D1 backup and tested restore in a **disposable account**, expected existing login/session behavior and explicit owner signoff. A green repository CI is not remote-account verification.

## Candidate safe rotation protocol — not implemented

1. Authorize the *trusted recovery operator* using independently verified Cloudflare account identity **and** a protected offline recovery proof. Google account access by itself never suffices.
2. Freeze privileged platform writes and new sessions in private, approved infrastructure. Record the current Control D1 factor version and the deployed private Worker secret identity (fingerprint only, not the secret).
3. Back up Control D1 under M10, verify schema and restore capability on a disposable target. Pin a reviewed GitHub release SHA, Access policy and a one-time operation ID with an append-only audit record.
4. Generate a fresh TOTP secret in an approved secret manager or protected operator environment. Do **not** insert its plaintext in D1, GitHub or browser logs, and do not send it through ChatGPT.
5. Design/approve a **pending-secret slot** that proves the new authenticator code while the old version stays fenced; a Cloudflare secret write and D1 row update are **not** one atomic transaction. Current code has no approved pending slot.
6. The M03 schema owner and M04 security owner must approve a single SQL-atomic *compare-and-set* that advances `platform_admin_auth.factor_version` to a strictly larger value, records the authorized recovery operation and invalidates all sessions from prior versions. Existing session validation joins the current factor version; confirm this in local Workerd/D1 with a pre-rotation and post-rotation session.
7. Promote only the reviewed private Worker revision matching the new secret/factor version; separately verify Cloudflare Access and Google origin restrictions with permitted and denied test users.
8. Prove a new TOTP login and old-session denial. Prevent rollback to a previous active secret/version; any recovery from a failed cutover requires a **newer** factor version and a new audit event, not a downgrade.
9. Unfreeze only after M04, M10, M11 and owner signoff; archive redacted operation evidence.
10. If any phase fails, **remain locked**. Rehearse recovery/restore offline, check for split-brain Worker revisions and use a reviewed roll-forward procedure. Never bypass the immutable first-admin singleton or create a public recovery endpoint to repair the incident.

## Separate activation challenge gate

A future hosted first-MFA ceremony must **replace**, not simply sit beside, Run 2's original setup-nonce proof. The final MFA enabling SQL must consume the separately verified challenge and set `platform_admin_auth` in the **same atomic D1 operation**, while checking the fresh Google subject, original ticket, exact challenge nonce, SQL current time, global attempt budget, TOTP proof and trusted operator/audit state. A stand-alone `verifyAndConsume...` boolean cannot serve as a privileged bearer capability. Reusing a consumed challenge, issuing unlimited new challenges, or completing activation after the original ticket expires must be denied.

## Production acceptance checklist

- [ ] M03 approves a **numbered** challenge and recovery journal D1 migration with immutable audit/unique idempotency rules; local fixture alone is not the migration.
- [ ] M04 proves fresh signed Google JWT, nonce, subject, issuer, client audience, OTP, server-side 5-attempt budget and exactly-once **combined** activation in real Workerd/D1; no public setup route.
- [ ] Trustworthy operator approval, Access boundary and exact Control D1 account binding are independently checked and audit-recorded.
- [ ] Secret store rotation, pending-secret pairing and version fencing are proven against approved private Worker deployment ownership; plaintext secrets remain out of D1 and GitHub.
- [ ] Old sessions are revoked by monotonic version change, including under concurrent login/rotation.
- [ ] Lost-ticket-before-activation and lost-factor-after-activation cases are rehearsed without changing the immutable first-admin identity.
- [ ] M10 backup/restore and M11 release/rollback, cross-account portability and preview isolation proofs pass on a disposable, otherwise empty Cloudflare account.
- [ ] Full exact-head GitHub CI and separate Workers Builds/Cloudflare hosted checks pass; owner explicitly approves the appropriate migration, secret, deployment and merge operations.

**Until all gates are evidenced, PORT-P3 is not deployable and the ERP MVP is not production-ready on the strength of this local proof.**
