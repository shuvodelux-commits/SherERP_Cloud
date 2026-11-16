# Authorized Day Book bootstrap — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans, superpowers:test-driven-development and superpowers:verification-before-completion; follow test-first RED → GREEN and owner review.

**Goal:** Return source-shaped Day Book bootstrap only when the same D1 statement authorizes current M04 `daybook:view` and reads the allowed Settings rows.

**Architecture:** Build an independent, internal reader that joins M04 session/users/roles with the two read-only Settings keys and calls the already-merged pure `projectDayBookBootstrap`. Keep the public registry and original UI unchanged.

**Tech Stack:** ES modules, Node 22 `node:test`, GitHub Actions, Wrangler 4.161.0 isolated Workerd/D1.

**Spec:** `docs/superpowers/specs/2026-11-16-m09-daybook-authorized-design.md`

## Global constraints
- One dedicated M09 branch; no shared auth, migrations, RPC, D1 posting, source GAS, frontend or Cloudflare runtime edits.
- Exact frozen source response and literal role permission; `allowed_modules` not authorization.
- No public endpoint or D1 preview binding. No live source data or remote SQL migrations.
- RED test-only commit, then minimal GREEN production code, actual CI evidence before completion claim.

## Review focus
- Forged client actor, role, permission and invalid time must be denied before D1.
- Settings query and staff authorization must be the **same SQL statement**.
- Stale session after permission toggle, disable, role change or logout must not reauthorize.
- No private Settings row or sensitive role payload exposed.
- No public Day Book transactions/edits available through this bootstrap.

### Task 1 — RED contract
**Files:** spec, this plan, `tests/m09-daybook-authorized.test.mjs`, `tests/integration/m09-daybook-authorized-workerd.spec.mjs`, `wrangler.m09-daybook-authorized-test.jsonc`, `.github/workflows/m09-daybook-authorized-workerd.yml`.

**Interface:** `createM09AuthorizedDayBookBootstrapReader({DB}).getBootstrap({token,nowMs})` returns the original four-field Day Book payload, or rejects without data on denial.
- [ ] Commit tests and local-D1 CI before implementation.
- [ ] Run exact test-only head GitHub Foundation checks. **Expected:** six or more new tests fail only because reader is missing.
- [ ] Record RED SHA and linked GitHub run. Correct test errors rather than accepting a false RED.

### Task 2 — GREEN implementation
**File:** `src/modules/m09-authorized-daybook-bootstrap.js`.
- [ ] Write minimal strict request validation, SHA-256 decoded bearer hash, one CTE SELECT and limited row decoder, reusing merged pure source projection.
- [ ] Verify exact-head full `npm test` passes via GitHub Actions.
- [ ] Verify dedicated isolated Wrangler/Workerd real D1 suite. Report failures accurately; no fake mocks presented as real D1.

### Task 3 — PR evidence and review
- [ ] Confirm branch diff contains only seven additive M09-owned files and no schema, original HTML, source or live auth mutations.
- [ ] Document source/RPC/table contract, RED/GREEN counts, CI/workerd links, preview status, no public exposure, remaining M09/M04 dependencies and rollback in the draft PR.
- [ ] Owner reviews/merges separately; no automatic production activation.
