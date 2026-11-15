# M02-P Country-Code-Aware Phone Review Suggestions — Plan

> **For agents:** use Superpowers test-driven-development and executing-plans; inspect source, commit tests before production, observe GitHub RED, implement minimal GREEN, verify full exact-head checks.

**Goal:** Do not silently miss Bangladesh shared-phone candidate reviews when one original master stores a local number and another stores its exact `+880` form.
**Architecture:** Change `normPhone` to recognize only `^8801\\d{9}$` after digit extraction and convert to `0` + the digits after `880`. Keep the normalized key private to suggestion indexing. All Party linking remains human-reviewed.
**Tech:** JS ESM, Node `node:test`, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-bd-phone-review-suggestions-design.md`.

### Constraints
- Immutable `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; original source and production untouched.
- No guessing actual identity from phone; no automatic merge, role-account netting or settlement.
- Scope limited to one pure `normPhone` helper and direct contract test, plus spec and plan; leave all parallel PR-owned files untouched.
- GitHub branch, test-first RED, minimal GREEN, all impacted CI and review. `PARALLEL-MODULE-READY=false`.

### Task 1 — Normalize candidate review keys only
1. **RED:** create synthetic Party master cases with distinct names: local and `+880` identical number; bare international number; punctuation around international number. Assert `SHARED_PHONE` review suggestion while identities/role accounts remain separate. Controls for different country code, other number and approved manual link. Commit with production source unchanged; observe failing GitHub Foundation tests.
2. **GREEN:** adjust the existing phone normalization helper to canonicalize only exact 13-digit Bangladeshi mobile international form to its 11-digit local form. No exported function, imports or dependencies added; no stored phone mutation.
3. **Verification:** collect exact-head Foundation Node/source/frontend checks, M02 Party Workerd/D1, M02 synthetic/staging and reviewed D1, M03/M04 real local D1, M01 Chromium and secret-free Cloudflare preview safety; report partial/pending honestly.
4. **Review:** four-file diff, conflict-free latest main, PR explanation, RED/GREEN evidence, rollback by PR revert and explicit human-review-only safety. Leave PR draft pending owner.
