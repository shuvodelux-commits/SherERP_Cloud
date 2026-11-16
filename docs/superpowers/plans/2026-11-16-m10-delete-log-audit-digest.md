# M10-06 DELETE_LOG audit digest — Superpowers TDD plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Use test-first RED → GREEN, verified exact-head GitHub CI and scoped draft PR.

**Goal:** Independently verify synthetic original DELETE_LOG rows and readback in isolated Workerd/D1 using physical source-row and authentic Log ID hashes without compromising audit immutability.

**Architecture:** Pure M10 digest helper consumes reviewed M02 source projection; a new M10 Workerd test exercises the existing M02 atomic immutable importer, queries persisted D1 and calculates independent source/readback digests. Add one step to M10 PR-only local-D1 workflow.

**Tech Stack:** Node 22 `node:test`, `node:crypto`, existing Wrangler 4.161.0 local Workerd/D1.

**Spec:** `docs/superpowers/specs/2026-11-16-m10-delete-log-audit-digest-design.md`.

## Constraints
- GitHub-first dedicated branch, draft PR for owner review; no direct main commit/auto merge.
- Pinned original commit `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; frozen 49-group inventory.
- Only M10-only helper/tests/docs/CI step; do not touch existing M02 D1 importer, SQL, Worker binding, auth, finance, source Sheets or production.
- Preserve nine columns, Unicode reason spacing, leading-zero mobile text, immutable DELETE_LOG triggers, opaque original references.
- No production readiness claim or live private data.

## Task 1 — RED test
- [ ] New `tests/m10-delete-log-digest.test.mjs` checks expected canonical hashes from independent direct `node:crypto` SHA-256 computations, validates original IDs vs content drift, immutable input and invalid source redaction.
- [ ] New `tests/integration/m10-delete-log-digest-workerd.spec.mjs`: importer → fixed SQL D1 readback → independently computed digests, real UPDATE/DELETE rejected, copy drift detectable and no routes.
- [ ] Add a new local-only Workerd step to existing `.github/workflows/m10-catalog-digest-local-d1.yml`, commit tests and open draft PR.
- [ ] Verify expected GitHub Foundation RED `ERR_MODULE_NOT_FOUND` before adding helper.

## Task 2 — GREEN minimal helper
- [ ] Add `src/migration/m10-delete-log-digest.js`, using existing `verifyDeleteLogMapping` and `prepareSourceDeleteLog`, exact 49-group validation, canonical field ordering, no extra runtime dependencies.
- [ ] Run full Foundation CI and dedicated new local D1 test against exact SHA, demonstrate no failures, preserve original catalog/log gates.
- [ ] Verify source and D1 isolation, no financial journaling changes, note limits and rollback.

## Task 3 — Review
- [ ] Recheck latest main and exact PR file inventory for overlaps.
- [ ] Document RED/GREEN job URLs, failures/limitations and scope in draft PR; do not merge.
