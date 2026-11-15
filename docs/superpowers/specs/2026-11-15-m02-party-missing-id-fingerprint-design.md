# M02-P — Stable Offline Missing-ID Review Fingerprints

**Authority:** SherERP Cloud `AGENTS.md`, M02-P workstream, owner-approved ADR-007 and frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Problem and root cause
The read-only `planPartyImport(sourceRows,approvedGroups)` creates a missing-ID review key from `hash(JSON.stringify(source))` when a legacy master row has neither a nonblank original ID nor a trusted `_rowIndex`. This hashes JavaScript property insertion order, not the source field/value identity. Two identical export rows with only reordered columns receive different `MISSING_ID` `reviewId` values, breaking deterministic human-review provenance.

## Decision
Canonicalize the **flat legacy master-row columns** (sort own field names lexically, preserve their exact values) only when computing the content fingerprint of a missing-ID row without `_rowIndex`. Do not alter source IDs, assign surrogate persistent IDs, auto-link names/phones, sort or mutate caller inputs, add DB writes, or change `_rowIndex`-based review IDs. Rows with different values remain distinct for this fingerprint, without asserting that content proves unique real-world identity. Identical rows with neither ID nor physical provenance must continue to fail closed on duplicate review provenance instead of silently merging.

## Acceptance criteria
- Identical missing-ID row values produce the same `MISSING_ID` `reviewId` across source field insertion orders, including row copies from different exports.
- Changing a source value changes the fingerprint; a missing ID still creates **no** import link.
- A stable `_rowIndex` remains the provenance anchor independently of column order.
- Identical no-ID/no-row-position duplicates continue to block as unresolvable (not coalesced as one Party).
- Full Github tests, local Workerd/D1 fixtures, original HTML, and secret-free preview safety are regression gates.

## Scope and safety
One pure helper expression in `src/party/party-import-plan.js`, one new Node contract test, design and plan. No `src/db/**`, migrations, `src/rpc/**`, auth, Worker config, UI, source GAS/Sheets, remote D1 or finance. `PARALLEL-MODULE-READY=false`. This fingerprint is an **offline quarantine aid**, not approval to import or cut over.
