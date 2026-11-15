# M04 Opaque Session Token Primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans (inline) or superpowers:subagent-driven-development, plus test-driven-development and verification-before-completion.

**Goal:** Produce Worker-native secure opaque token creation and one-way token hashing without persisting sessions or enabling public login.

**Architecture:** Independent `src/auth/session-token.js` ESM with two side-effect-free APIs (other than OS secure randomness). Existing Worker routing, M03 D1 and M04 credential code remain untouched.

**Tech Stack:** Node 22+ ESM, `node:test`, Web Crypto (Workers + Node), independent Node crypto reference hashes in tests.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-session-token-design.md`

## Global Constraints
- Read immutable `legacy/source/Auth.gs`; source SHA and full 84-file manifest unchanged.
- No password, role or public RPC implementation; no secret fixtures or live source/staging D1.
- No schema, `src/db`, `src/index.js`, `src/rpc`, `src/auth/legacy-password.js`, frontend or Cloudflare config change.
- Never use insecure randomness/fallback, global token caches, local time or client-provided actor identity.
- Preserve 64 lower-case hex bearer token shape; only digest stored in future D1.

## Review Focus
- RNG failure/missing service must throw, not return a guessable token.
- Deterministic digest must use token bytes exactly, with leading zeros maintained in lowercase hex.
- Invalid token shapes, non-string/uppercase/whitespace input must fail closed.
- No raw bearer token exposed via logging, persistent state or public RPC.
- Tokens do not constitute a valid authenticated session until D1 revocation/permissions/expiry policy is implemented.

### Task 1: Internal session token mint and hash
**Files:**
- Create `tests/m04-session-token.test.mjs`.
- Create `src/auth/session-token.js`.

**Interfaces:**
- Produces `createOpaqueSessionToken(): string` (64 lower-case hex random bearer).
- Produces `hashOpaqueSessionToken(token: unknown): Promise<string|null>` (lowercase SHA-256 digest or null on input validation failure).

- [ ] Write failing test file with source-contract check, 32-byte CSPRNG token format/uniqueness, exact independent `node:crypto` SHA-256 digest, invalid token denial and unavailable crypto rejection. Include RPC isolation assertions.
- [ ] RED: `node --test tests/m04-session-token.test.mjs` reports module missing.
- [ ] Implement minimal Worker-native token and digest functions. No Node `crypto` import in production.
- [ ] GREEN: focused tests pass. `npm test`, `npm run verify:source`, `npm run build:frontend`, syntax/diff checks pass.
- [ ] Commit only new spec/plan/module/test, push separate branch, create draft PR with impact/gates.

## Release guard
Does **not** implement login/logout, token storage, session validation, expiry, revocation, rate limiting, or role checks. Follow M04 real Worker/D1 test and shared SQL owner gates before any activation.
