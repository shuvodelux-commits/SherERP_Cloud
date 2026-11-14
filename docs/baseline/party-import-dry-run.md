# M02-P2 — Safe Party import dry-run

> **Status:** Test-driven offline planning; no database writes, auth changes, financial posting or live data migration.  
> **Depends on:** [M02-P0/P1 identity PR #8](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/8) and [approved Unified Party ADR PR #7](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/7).

## Purpose

Plan how five existing, separately stored legacy Party master groups become unified identities **without silently treating shared names or phone numbers as the same legal person**:

- `CUSTOMERS` (Customer ID)
- `SUPPLIERS` (Supplier ID)
- `VENDORS` (Vendor ID)
- `FINANCE_PERSONS` (Person ID, supports Owner+Lender+Borrower)
- `EXPENSE_PAYEES` (Payee ID)

This planner does not read Google Sheets automatically. It accepts an **explicit, local JSON snapshot** in the original schema, preserves original source record IDs, and computes a proposed identity/link/review result **in memory**.

## Running only on synthetic examples

```bash
npm test
npm run party:dry-run -- tests/fixtures/party-import.synthetic.json
npm run party:dry-run -- tests/fixtures/party-import.synthetic.json tests/fixtures/party-approved.synthetic.json
```

The first run shows **5 source rows → 5 separate Parties, 7 role memberships and 2 pending identity-review reasons** despite identical Customer and Supplier names/phones. The second run uses a synthetic, explicitly reviewed link and reports **4 proposed Parties**, with Customer and Supplier roles on one Party. It **does not settle or combine their balances**.

Only source counts, proposed Party counts, legacy-link counts, role counts, quarantined rows, review counts and by-group row counts are printed. Names, phones, addresses and source IDs are **never printed by the CLI**; validation errors are intentionally redacted to avoid accidental PII leakage.

## Rules

1. **No auto-merges.** Every valid original master row becomes its own provisional Party unless a supplied, explicitly reviewed group links two or more source records.
2. **Human-approved links are input claims, not verified permissions.** For reviewed groupings, the dry-run requires source record references plus nonempty reviewer, date and decision reference. An eventual authenticated approval workflow must verify those claims and lawful eligibility before storing them.
3. **Quarantine ambiguous source rows.** Blank/invalid original IDs, missing names and duplicate source IDs create review items. Rows with invalid/duplicate IDs do not receive active Party links; the summary exposes their count instead of silently discarding them.
4. **Candidate matches are only review suggestions.** Same name or phone across distinct Party identities creates OPEN review items; no link or balance update follows.
5. **Deterministic ID proposals.** Proposed Party and review IDs are derived from a stable SHA-256 digest of the source group + original ID (or source row index for missing IDs). These are *provisional import IDs*; actual persisted Party IDs and reviewed remappings must be managed by the dedicated approved importer/transaction path.
6. **No financial account work.** Vendor Due/Receivable, customer/supplier advances, Owner capital, Lender debt, Borrower loans and Payee-only identity remain separate and unposted. There are no accounts, journal writes, cash movements or cross-role settlement side effects.
7. **Source integrity.** The input is never modified. Legacy `_rowIndex` is retained as a proposed provenance field, not treated as a stable SQL primary key.

## Completion / remaining gates

- TDD locally observed RED (missing importer and CLI); GREEN on full suite **36/36 Node tests** including same-phone conflict, reviewed grouping, quarantine, approval failures, PII-safe CLI, export-order determinism and the previous SQLite schema tests.
- GitHub CI must confirm the exact committed implementation and both synthetic dry-run modes.
- **Not finished:** Human-review UI and auditable approval enforcement, full existing ledger reconciliation, importer writes, real Wrangler/D1 runtime integration, large-dataset performance and production data cutover.
- Do not use this CLI to import production records or publish private snapshots to GitHub. The first real import remains explicitly approval-gated.

## Superpowers task record

- [x] RED: test source rows with shared phone/name; missing import module.
- [x] GREEN: dry-run returns distinct Parties and OPEN review candidates.
- [x] RED: tests for reviewed link evidence, missing IDs, duplicates and deterministic output.
- [x] GREEN: proposal-only link grouping, exact role memberships, quarantined data and stable IDs.
- [x] RED: CLI contract tests failed when command was absent.
- [x] GREEN: synthetic-only PII-safe CLI.
- [x] RED: missing-ID review ID changed when source row order changed.
- [x] GREEN: hash based on original source row index or stable content fallback.
- [x] Full local Node suite passed (36 tests).
- [ ] GitHub Actions green and reviewer acceptance.
- [ ] Real D1 import/transaction gate (separate later PR).
