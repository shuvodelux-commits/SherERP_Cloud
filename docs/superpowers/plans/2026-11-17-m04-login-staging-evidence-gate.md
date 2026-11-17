# M04 private staging login evidence gate — Superpowers plan

> REQUIRED: superpowers:executing-plans, superpowers:test-driven-development, superpowers:verification-before-completion.

**Goal:** Provide a deterministic, no-secret, read-only **documentary** M04 private login staging preflight. Do not mistake locally tested synthetic authentication for real staff readiness.

**Design:** `docs/superpowers/specs/2026-11-17-m04-login-staging-evidence-gate.md`.
**Implementation:** `scripts/check-m04-login-staging.mjs`.
**Tests:** `tests/m04-login-staging-evidence-gate.test.mjs`.
**Branch:** `m04/private-login-staging-evidence-gate-20261117`.
**Changes:** one script, one test, design, plan, optional independent GitHub check. No current M04 #421 edits.

## 14-sentence overview

1. Login on the deployed Worker is deliberately disabled.
2. M04 synthetic private D1 login tests do not establish a functioning real environment.
3. M04 source identity migration requires protected users and roles.
4. The remote staging migration guard still permits only the first two migrations.
5. Authentication needs the two additional reviewed schema versions 0003 and 0004.
6. The deployed preview must continue to have no database binding.
7. A private staging Worker must use its independently approved D1.
8. Offline evidence can report migration names and aggregate staff counts without raw credentials.
9. The evidence checker will reject malformed shapes and extra fields.
10. It will demand a double-frozen source snapshot with identical SHA-256 values.
11. It will demand source-to-D1 counts and an active Administrator.
12. It will demand explicit documentary references from the owner and reviewer.
13. Every report will state that it does not authorize deployment, import or cutover.
14. No remote writes, credential exposures, or live user changes are within this task.

## RED — test first

- [ ] Commit tests for missing evidence (stable blockers, no thrown exception), malformed/secret-bearing values, preview/staging isolation, missing required migration names, missing auth tables, staff count mismatches, weak/fake freeze, zero Administrator, approvals missing, and synthetic documentary-complete scenario that STILL cannot authorize deployment.
- [ ] Add CLI tests that ensure missing private manifest produces stable redacted failure with exit code 1; never log supplied input.
- [ ] Verify GitHub Foundation RED due to missing module. Do not add implementation until expected failure is observed.

## GREEN — minimal checker

- [ ] Implement `assessM04LoginStagingEvidence(input,options)`, fixed enumerated blockers, strict plain own-value descriptors, explicit array/count/hash parsing, call both existing Wrangler config validators, and deterministic report.
- [ ] CLI reads `wrangler.preview.jsonc`, `wrangler.staging.jsonc` and one **operator-local private** manifest path; source/release SHA trusted explicit args; no printing input or secrets, no remote queries/writes. Keep fake synthetic values confined to unit tests.
- [ ] Re-run complete GitHub Foundation tests, linter/source verification, and check all exact-head required GitHub Actions. Fix failures before declaring GREEN.

## Review gate

- [ ] Open independent owner-review draft PR with RED SHA and exact-head evidence.
- [ ] Explicitly state: the checker only assists a later private staging authorization decision. Existing public login continues 503. Never auto-deploy, add a preview DB binding, migrate 0003/0004 remotely or import real staff in this PR.
