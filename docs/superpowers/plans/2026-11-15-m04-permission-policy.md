# M04 internal staff-permission policy implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development, plus test-driven-development and verification-before-completion. Keep every change on this isolated M04 branch.

**Goal:** Produce a reviewable internal source-faithful staff permission normalizer without enabling login, sessions, D1 access or public RPC handlers.

**Architecture:** A dependency-free ESM policy module consumes JSON permission maps. Tests cross-check its allowlists against pinned legacy GAS definitions and prove no privilege elevation from malformed input.

**Tech Stack:** Node 22+ ESM, `node:test`, immutable `legacy/source` reference.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-permission-policy-design.md`

## Global Constraints
- Preserve current M04 protected RPC 501 gate and no D1 public binding.
- Do not touch `src/db`, SQL migrations, `src/index.js`, `src/rpc`, `frontend`, or Cloudflare runtime config.
- Do not introduce authentication cookies/tokens or mutate staff/Party identities.
- Preserve source vocabulary; tighten acceptance of untrusted boolean fields to literal `true`.
- Run full `npm test`, `npm run verify:source`, `npm run build:frontend`, and `git diff --check`.

## Review Focus
- Prototype/inherited property keys must never elevate rights.
- Edit-only special rights must not create view/navigation rights.
- Only boolean true may grant a standard view/add/edit permission, not string `"false"`.
- Management delete uses a boolean grant, normal modules use allowed date-window codes.
- Legacy unlimited backdate is a documented internal fallback, not permission to activate public auth.

### Task 1: Pure permission sanitizer and source parity

**Files:**
- Create `tests/m04-permission-policy.test.mjs`
- Create `src/modules/auth/permission-policy.js`

**Interfaces:**
- Produces `STAFF_PERMISSION_MODULES: readonly {key,permissionMode?}[]`, `PERMISSION_WINDOW_CODES: readonly string[]`, and `sanitizeStaffPermissions(raw: unknown): Record<string,PermissionEntry>`.

- [ ] Write failing `tests/m04-permission-policy.test.mjs` with source-vocabulary parity, unknown-key denial, strict flags, own-data-only permissions, edit-only overrides, date windows, management deletes and fallback cases.
- [ ] RED: `node --test tests/m04-permission-policy.test.mjs` fails because the requested module does not yet exist.
- [ ] Implement the smallest self-contained ESM policy module with a fixed source-derived module allowlist. Never read a prototype grant or call a getter.
- [ ] GREEN: `node --test tests/m04-permission-policy.test.mjs` shows no failures.
- [ ] Commit the tested helper and tests; record exact source hash and no-runtime-activation boundary.

### Task 2: View-only module derivation and full gate

**Files:**
- Modify `tests/m04-permission-policy.test.mjs`
- Modify `src/modules/auth/permission-policy.js`

**Interfaces:**
- Consumes Task 1's normalized map.
- Produces `allowedStaffModules(normalized): string[]`.

- [ ] Add failing tests demonstrating that view-enabled modules appear in source order while edit-only and management-delete-only rights never produce navigation rights.
- [ ] RED: run `node --test tests/m04-permission-policy.test.mjs` and observe expected missing export/failing assertion.
- [ ] Implement minimal derivation without side effects.
- [ ] GREEN: repeat focused tests; run full `npm test`, `npm run verify:source`, `npm run build:frontend`, `git diff --check`.
- [ ] Commit independently if changed after Task 1. Self-review diff and open a draft PR with scope, tests and merge gate.

## Release boundary
This produces **only** an internal reviewed helper. No claim that M04 authentication is implemented. End-to-end Worker/D1 throttle, credential migration, session revocation, last-admin, and authorization tests remain mandatory.
