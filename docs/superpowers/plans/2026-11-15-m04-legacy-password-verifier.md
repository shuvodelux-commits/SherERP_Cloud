# M04 — legacy password verifier implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or test-driven-development; never enable public login in this PR.

**Goal:** Add exact source-compatible verification for the old salted SHA-256 hashes so M04 can later migrate accounts to a stronger, D1-backed credential scheme.

**Architecture:** One small `src/auth/legacy-password.js` module uses Worker Web Crypto `crypto.subtle.digest` with UTF-8 `password + salt`; rejects malformed inputs and compares lowercase digest hex with a fixed-length XOR loop. No persistence, import/export of credentials, cache, RPC or automatic password replacement.

**Tech Stack:** JS ESM, Node `node:test`, `node:crypto` independent test vectors, Web Crypto available in Workers.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-legacy-password-verifier.md`; immutable `legacy/source/Auth.gs`; M04 contract docs and `AGENTS.md`.

## Global Constraints
- Source `Auth.gs` byte unchanged; no real account/secret data.
- No new password-hash generation based on legacy SHA-256.
- Exact UTF8 concatenation; no trim, lowercasing password or salt.
- Fixed-iteration compare on lowercase 64-hex input; malformed storage denies.
- No D1, public Worker, registry, Cloudflare or schema changes.

## Task 1 — test-driven source parity
- [x] Created `tests/m04-legacy-password.test.mjs` with independent Node SHA256 vectors for ASCII, Bangla/emoji, whitespace, wrong credentials/salt, tampered digest, uppercase/malformed and non-string inputs.
- [x] RED verified: missing `src/auth/legacy-password.js` module.
- [x] GREEN: internal `src/auth/legacy-password.js` exports async `verifyLegacyPassword(password, hashHex, salt)`.
- [x] Targeted tests: 7/7; combined with existing M04 preflight: 11/11.
- [x] No logging, network, persistent state, RPC registry or legacy password-hash generation.

## Task 2 — verify integration boundaries
- [x] Existing M04 preflight asserts login RPC stays 501; new tests assert helper is not imported into Worker/RPC or wired to D1.
- [x] `npm test`: 134/134; `verify:source`: 84 original files; frontend build, 47-module audit, syntax and diff check passed.
- [x] Documented limitations in `docs/M04_LEGACY_PASSWORD_VERIFIER.md`.

## Task 3 — PR and merge gate
- [ ] Review changed files and source SHA; push isolated branch.
- [ ] Open a single-objective PR to main; require all GitHub Actions and successful DB-free Cloudflare Preview before merge.
- [ ] Do not claim M04 complete or enable login.
