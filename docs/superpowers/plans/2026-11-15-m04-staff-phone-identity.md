# M04 Staff Phone Compatibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, test-driven-development and verification-before-completion.

**Goal:** Prepare source-faithful staff-login mobile-number compatibility and a fail-closed duplicate-match detector without enabling authentication.

**Architecture:** Pure ESM `src/auth/staff-phone-identity.js` mirrors GAS `Utils.gs` phone normalization. A separate matcher consumes a trusted, complete server-loaded staff snapshot and signals no/one/multiple/malformed matches; it never authenticates or accesses a database.

**Tech Stack:** Node 22+ ESM, node:test, vm-extracted immutable GAS reference.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-staff-phone-identity-design.md`

## Nonnegotiable constraints
- New code only in the 4 target files: module, tests, spec and plan.
- No Party/customer identity linking or modifications; phone equivalence is only staff-login lookup behavior.
- No D1 schema/runtime, RPC routing, frontend, auth token, throttle, credential, Cloudflare or legacy source edits.
- The matcher returns no user object or unreviewed unique login authority. Empty user array must only arise from successful DB query.
- Phone display and search must have independent source-equivalence tests, no hardcoded real phone numbers in fixtures.

## Task 1 — Source parity and staff phone ambiguity
**Files:** `tests/m04-staff-phone-identity.test.mjs`; `src/auth/staff-phone-identity.js`.

- [ ] Add tests first using synthetic mobile examples and independently evaluated `Utils.gs` pure helper functions in `vm`, preserving source Unicode/phone arithmetic and strict bool equality.
- [ ] Include malformed/inherited/accessor records; duplicate normalized staff numbers must be `ambiguous`; only one match returns index, no auth/user object.
- [ ] Verify RED (new implementation module unavailable).
- [ ] Implement minimal pure helpers; verify focused GREEN.
- [ ] Run `npm test`, `npm run verify:source`, `npm run build:frontend`, syntax and `git diff --check`.
- [ ] Commit only these four files, push isolated branch and open draft PR for independent review and CI. No deployment of real staff login.

## Release note
This is not a staff login module; M04 D1 sessions, trusted staff IDs, disable/revoke, throttling, last-admin CAS and idempotent security writes remain blocked. `PARALLEL-MODULE-READY` is unchanged.
