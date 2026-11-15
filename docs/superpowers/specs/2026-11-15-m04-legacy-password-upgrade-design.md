# M04 — Atomic first-login legacy password upgrade (internal/test-only)

Date 2026-11-15. Base merged PRs #55, #60, #70 and pinned Auth.gs legacy password verifier. Public login is still disabled by intention.

## Problem
The reviewed D1 core accepts PBKDF2-SHA256 credentials but the pinned GAS Auth.gs uses SHA256(password + original UUID salt). Importing staff identities without an explicit upgrade scheme would lock existing staff out or tempt unsafe hash re-use.

## Chosen contract
- Add proposed **test-only** auth_users.credential_state with values Modern (default) or LegacyPending; keep the modern PBKDF2 credential columns strict. Pending accounts carry randomly generated, *unusable* modern placeholders, not the imported password hash. The imported legacy SHA256 hash/salt reside only in a separate auth_legacy_credentials table keyed by immutable source user ID. No legacy material appears in the deployed schema or in Git, log messages, browser responses, or tokens.
- loginWithD1 for LegacyPending users performs exact constant-time source verification through existing src/auth/legacy-password.js **after** checking the D1 throttle and active account/role. Wrong passwords are generic failures recorded in the same D1 throttle. On correct legacy password of at least 8 characters, generate a modern PBKDF2-SHA256 credential (210000 iterations, fresh random 24-byte salt), then CAS-upgrade the **same user** in **one guarded D1 UPDATE**, checking source user ID, status, role, user authority version, credential version, placeholder preimage, matching legacy hash+salt, active role+role version and current lock state. An SQL trigger deletes legacy credential data in the same statement that commits the upgrade. If the CAS loses a race, do not issue a session; a retry can use the upgraded password.
- After a successful upgrade, refetch the stored account and continue through *existing* modern PBKDF2 verification, CSPRNG token issuance, authority-bound D1 session insert and source-shaped adapter. No bypass path, no special auth cookie, no JS cache.
- D1 trigger deletes legacy table row only on pending->modern transition. Direct attempts to authenticate a pending user through its PBKDF2 placeholder are rejected. Invalid/missing legacy material does not turn into a modern session. The login response remains generic; old credential material is not returned.
- Intentionally do not migrate passwords shorter than 8 characters: they need operator-controlled secure reset. Import reconciliation must attest the source account before inserting placeholders and legacy material.
- A pending legacy credential row can be inserted only for pending user ID. Deleting the row before upgrade causes login denial, never fallback.

## Security/ownership
All SQL is in tests/fixtures/m04-auth-migrations/0001_auth_core.sql, not migrations/. M03 is exclusive schema owner and must approve any real rollout with backup/rollback, staff import (#42), source-normalized phone (#39), first-admin approval and IP-level rate limits. Do not change src/index.js, src/rpc/registry.js, deployed Worker, Cloudflare preview, real D1, source files, or CI workflows. In particular public login stays HTTP 503. This is only an internal source-compatibility step, not a production release.

## Evidence required
RED→GREEN against local Workerd/D1. Correct legacy hash upgrades once and removes legacy row; wrong hash, inactive user/role, short password, active lock, stale identity/credential CAS deny; two simultaneous successful upgrades yield exactly one credential upgrade but no duplicate privilege, all new sessions version-bound; pre-existing modern login unaffected. Full Node+source+frontend+original Workerd suites must pass; new PR draft for schema/security review.
