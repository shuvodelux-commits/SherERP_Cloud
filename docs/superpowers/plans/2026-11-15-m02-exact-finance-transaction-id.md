# M02-P Exact Finance Transaction ID Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Test first, observe RED in GitHub Actions, apply minimal GREEN, then verify full CI.

**Goal:** Do not silently coalesce distinct original Finance transaction IDs during offline gross Party balance validation.
**Architecture:** Preserve exact nonblank `Finance ID` source string for the local duplicate-check Map; continue to trim only to identify blank IDs.
**Tech Stack:** Node.js ES modules, `node:test`, GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-exact-finance-transaction-id-design.md`

## Non-negotiable constraints
Frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; unchanged frontend and GAS deployment. No D1/production import, schema, Worker RPC, account posting, financial netting, staff authorization, or automatic Party merging. Dedicated GitHub PR, Superpowers RED → GREEN, KISS, real CI evidence and owner review. `PARALLEL-MODULE-READY=false`.

## Review focus
- The raw original Finance transaction ID is a source provenance key, not a text search query.
- Padded original IDs are distinct unless human/source review separately proves otherwise.
- Truly blank IDs cannot be imported.
- Identical literal IDs still block as duplicates.
- Checkpoints stay gross per original Finance Person and account; source and output effects unchanged.

---

### Task 1: Preserve Finance IDs byte-for-byte in duplicate preflight

**Files:**
- New: `tests/m02-party-finance-transaction-id-provenance.test.mjs`
- Edit: `src/party/gross-balance-preflight.js` (one Finance ID grouping expression)
- New: this plan and corresponding spec.

**API:** `prepareGrossPartyBalances({sourceRows,approvedGroups=[],financeRows})` and report shape remain unchanged.

- [ ] **RED:** commit tests of two distinct padded/unpadded IDs that both affect a single original finance account and separately across two Person accounts; assert readiness, exact summed checkpoints, and input immutability. Include exact duplicate, blank and deleted-row controls.
- [ ] **RED evidence:** create draft PR without implementation, observe expected Node test failures in Foundation GitHub workflow; distinguish independent unrelated CI failures.
- [ ] **GREEN:** replace `.trim()` in Finance ID group key with exact `string(row['Finance ID'])`, test `!id.trim()` only for blank. No other business logic changes.
- [ ] **GREEN evidence:** verify full Foundation Node/source preservation/frontend assembly, M02 Party Workerd/D1, M02 local synthetic/staging, M03 Workerd/D1, M04 Workerd/D1, M01 Chromium and Cloudflare PR-only safety checks. Review four-file diff.
- [ ] **Review:** record exact RED/GREEN SHA, runs, safety/rollback and blockers; leave PR draft/unmerged until owner approval.
