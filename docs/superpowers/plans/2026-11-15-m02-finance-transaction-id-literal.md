# M02-P Finance Transaction Literal-ID Preflight — Implementation Plan

> **For agentic workers:** Use Superpowers `executing-plans` and `test-driven-development`; observe GitHub RED then GREEN.

**Goal:** Prevent distinct original Finance transaction IDs from being collapsed when they differ only by leading/trailing whitespace.

**Architecture:** In the existing read-only `prepareGrossPartyBalances` source preflight, key `FINANCE_TRANSACTIONS` rows by their **literal** `Finance ID` source text. Trim only to classify all-whitespace IDs as missing. Do not change Finance Person source-ID mapping, Party links, account kinds, signed BDT minor units or output shape. The original frozen `FinanceModule.gs` uses `f['Finance ID']` directly for finance entry identity, and sorts using `String(a['Finance ID']).localeCompare(String(b['Finance ID']))`, without trimming.

**Tech Stack:** JavaScript ESM, Node 22 `node:test`, GitHub Actions, existing local Workerd/D1 regression jobs.

**Spec:** `AGENTS.md`, `docs/WORKSTREAMS.md` M02-P, `docs/architecture/ADR-007-unified-party-relationships.md`, `legacy/source/FinanceModule.gs` pinned to `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; previously merged Finance Person exact literal ID tests.

## Global Constraints
- GitHub-only branch, commits, PR, CI; no local PC use, original GAS changes, schema/RPC or production posting.
- Preserve every original source ID byte; distinct IDs like `F-001` and ` F-001 ` are **not** duplicates, unlike two identical `F-001` rows. Never auto-merge Party master source IDs.
- Missing/whitespace-only `Finance ID` still raises `FINANCE_ID_REQUIRED`; identical active transaction IDs still raise `FINANCE_ID_DUPLICATE`; soft-deleted transactions still excluded.
- Gross per-role Owner/Lender/Borrower balances remain separate and no current cash/bank or ledger postings are introduced.
- Source-based results are private: tests use entirely synthetic IDs and should not print real PII.

## Task 1: RED → GREEN source transaction uniqueness
**Modify:** `src/party/gross-balance-preflight.js` (one expression after RED).
**Create:** `tests/m02-party-finance-exact-transaction-id.test.mjs` (focused source fixture test).
**Plan:** this document.

1. **RED:** commit the plan. Commit tests before modifying production: `F-001` and ` F-001 ` must independently contribute amounts under the same Owner account; a padded transaction ID may not silently erase a Lender checkpoint; true identical IDs must still be quarantined; blank ID and deleted-row safeguards must persist; changing transaction row order must not alter gross amounts; source snapshots remain unchanged. GitHub Foundation must fail for the intended trimmed-ID collision cases while preserving controls.
2. **GREEN:** remove `.trim()` only from `const id=string(row['Finance ID']).trim()` and use `if(!id.trim())` for missing-ID branch; do not alter raw Person ID, monetary conversion or other code.
3. Run actual exact-head GitHub Foundation `npm test`, original source checks, M02 Party Workerd/D1 import tests, M03 Workerd/D1 integration, M04 auth D1, original UI Chromium, staging local and Cloudflare preview safety.
4. Review precisely 3-file diff and document RED/GREEN commit SHAs, run IDs, test totals and release safety. Keep PR draft until green.

## Review Focus
- Whitespace-distinct IDs never drop finance gross checkpoints.
- Exact duplicate IDs never double count or become an implicit merge.
- Blank and soft-deleted rows remain blocked/excluded respectively.
- Finance Person ID roles cannot be inferred from a reviewed Party cross-source role.
- No financial postings or production import authorized.

**Rollback:** revert additive 3-file PR; no D1 rollback. `PARALLEL-MODULE-READY=false`.
