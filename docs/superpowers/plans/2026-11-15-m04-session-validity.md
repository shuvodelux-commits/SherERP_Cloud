# M04 Session Validity Predicate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or subagent-driven-development for this plan, with TDD and verification-before-completion.

**Goal:** Add a pure, fail-closed check for server-loaded session timestamps and revocation under explicitly configured (not hardcoded) idle/absolute time limits.

**Architecture:** No DB or RPC wiring; a small stateless ESM helper accepting a proposed D1 session record, a server-owned policy and trusted server clock. Deny malformed and inherited data. The predicate is only one future authentication precondition, not identity or permission verification.

**Tech Stack:** Node 22+ ESM, `node:test`, unchanged pinned GAS reference.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-session-validity-design.md`

## Global Constraints
- Only create new `src/auth/session-validity.js`, its tests, spec and plan. Do not modify M03 DB owner files, production Worker, RPC, frontend, source snapshot or Cloudflare configs.
- Do not choose production idle/absolute duration or bless old GAS `Never` sessions. Future policy requires separate approval.
- Do not read/write cookies, bearer tokens, sessions, account/role state, D1, logs or caches.
- Keep public auth fail-closed, with explicit owner/CI/real D1 gates.

## Review Focus
- Exactly at idle/lifetime/absolute expiry must deny (strict boundary).
- Missing or inherited `revokedAtMs` must not be treated as active.
- `Never`, ISO strings, float/NaN/infinity, negative or unsafe integer timestamps fail closed.
- Last-activity future clocks or activity before session creation fail closed.
- Arbitrary policy durations or zero/undefined policy cannot silently become a default or bypass guard.

### Task 1: Internal timestamp eligibility predicate
**Files:**
- Create `tests/m04-session-validity.test.mjs`
- Create `src/auth/session-validity.js`

**Interfaces:**
- Produces `isSessionWithinPolicy(session: object, policy: object, nowMs: number): boolean`.

- [ ] Write tests first with synthetic clock and explicit `maxLifetimeMs` / `maxIdleMs`; assert valid, expired, revoked, boundary, missing config/fields, inherited/getter traps, and M04 RPC isolation.
- [ ] Run `node --test tests/m04-session-validity.test.mjs`; observe expected missing-module RED.
- [ ] Implement minimal pure function, returning boolean only and refusing any invalid/inherited/proxy fields.
- [ ] Run `node --test tests/m04-session-validity.test.mjs` GREEN; run full `npm test`, `npm run verify:source`, `npm run build:frontend`, JS syntax checks and `git diff --check`.
- [ ] Commit exactly four new files and push separate branch. Open draft PR with base SHA, source provenance, tests, read/write scope and reviewer gates.

## Release guard
Not authorization: session has to exist in real D1, be bound to a trusted actor/active role, and survive server-side expiry, token hash lookup, revoke/disable, throttle and concurrency protections. M04 and PARALLEL-MODULE-READY remain incomplete.
