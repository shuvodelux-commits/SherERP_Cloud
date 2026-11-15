# M04 Login Throttle Policy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development task-by-task; RED→GREEN TDD required.

**Goal:** Create a pure, source-checked login-attempt throttle state machine for future atomic D1 session security without activating login.

**Architecture:** `src/auth/login-throttle-policy.js` exports immutable constants and `transitionLoginThrottle(prior,event,nowMs)`. State comes from a hypothetical successfully read server-side record; the function validates data descriptors, refuses unknown or malformed events and never writes/reads shared storage.

**Tech Stack:** JS ESM, Node 22+ `node:test`, pinned `legacy/source/Auth.gs`.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-login-throttle-design.md`

## Constraints
- Exactly four new files: spec, this plan, module and test.
- No `src/db`, SQL, Workers RPC/auth binding, real secrets, mobile normalization or staff credentials.
- No overlapping M04 files owned by draft PR #30, #34 or #35.
- Source constants and original GAS snapshot must not be changed.
- Later persistent concurrency-safe D1 rate limits remain a separate release blocker.

## Task 1 — source-parity state machine (test-first)
**Files:** `tests/m04-login-throttle.test.mjs`; `src/auth/login-throttle-policy.js`.

- [ ] Write tests for exact source constants 5 failures, 15-minute lockout, one-hour cache reset; independent simulated login attempts; lock expiry; no lock extension while blocked; successful reset; malformed/unknown events, inherited/accessor fields and time overflow; public Worker/RPC isolation.
- [ ] Run `node --test tests/m04-login-throttle.test.mjs` and record missing module **RED**.
- [ ] Write minimum pure `transitionLoginThrottle` function and constants. Throw on invalid state/time rather than treating a failed read as new state. Never mutate inputs or use platform clock implicitly.
- [ ] Run focused tests **GREEN**, then `npm test`, `npm run verify:source`, `npm run build:frontend`, new JS syntax check and `git diff --check`. Inspect exact diff for forbidden paths.
- [ ] Commit the four new files, push isolated branch and create a draft PR with merge order, source provenance and security gates.

## Release guard
No public server auth, D1 throttle persistence or concurrency proof. A separately reviewed SQL implementation must make state read/check/update atomic under concurrent attempts and reject state-store failures before authenticating. M04 readiness remains blocked.
