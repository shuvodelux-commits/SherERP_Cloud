# M04 Legacy Password Verifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development to implement this plan task-by-task; follow TDD and verification-before-completion.

**Goal:** Build a non-serving, source-compatible verifier for migrated legacy staff password hashes with no D1 or RPC changes.

**Architecture:** Export one async helper from a new ESM module that computes SHA-256 through Worker-compatible Web Crypto. Compare decoded digest bytes against a strictly validated stored lower-case SHA-256 hash. Test against independent synthetic vectors and the pinned GAS formula.

**Tech Stack:** Node 22+ `node:test`, Web Crypto, unchanged pinned GAS reference.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-legacy-password-design.md`

## Global Constraints
- No auth endpoint activation, no runtime registry/Worker changes, no cloud deployment.
- No new credentials/hashes or secret material committed. Tests use synthetic passwords and salts.
- No shared `src/db`, SQL migrations, Party/finance or Cloudflare edits.
- Preserve original concatenation `password + salt` and UTF-8 encoding; reject malformed stored hashes.
- Keep PR #30's permission-policy files untouched.

## Review Focus
- Unicode combining characters, emoji and whitespace must be compared byte-exactly and must not be silently normalized.
- Hash comparisons must process all bytes, and digest length/hex encoding must reject confusing malformed values.
- Absence of a usable Web Crypto digest must never allow successful verification.
- Source-defined capitalization of digest hex must not be transformed into a success.
- Current public `login` and auth RPC methods must remain blocked until the D1/security gate passes.

### Task 1: Source-compatible internal legacy credential verifier

**Files:**
- Create: `tests/m04-legacy-password.test.mjs`
- Create: `src/modules/auth/legacy-password.js`

**Interfaces:**
- Consumes: exact stored source columns `Password Hash`, `Password Salt` as opaque lowercase SHA-256 digest / UUID-like string (does not write them).
- Produces: `verifyLegacyPassword(password: unknown, storedHash: unknown, salt: unknown): Promise<boolean>`.

- [ ] Write failing tests using `node:crypto.createHash('sha256')` **in test only** for independent known vectors, plus source regex parity and malformed/rejected-secret cases.
- [ ] Run: `node --test tests/m04-legacy-password.test.mjs`. Expected: module not found (RED).
- [ ] Implement `verifyLegacyPassword` in `src/modules/auth/legacy-password.js` using `TextEncoder`, `globalThis.crypto.subtle.digest`, strict input checks and full-byte comparison; no side effects.
- [ ] Run: `node --test tests/m04-legacy-password.test.mjs`. Expected: all tests PASS.
- [ ] Run: `npm test`, `npm run verify:source`, `npm run build:frontend`, syntax checks and `git diff --check`. Expected: all zero exit.
- [ ] Commit only these four isolated files (including spec and plan); self-review changes, then push and create a draft PR for owner approval.

## Release guard
The verifier alone does **not** implement M04. Modern KDF upgrade parameters, sessions, throttles, last-admin CAS and real local Workerd+D1 security tests remain blockers. The helper must not be wired to `src/rpc` until those gates pass.
