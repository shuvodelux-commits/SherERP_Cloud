# M08 internal cash read projection — design

**Status:** Isolated read-only internal implementation; **not** M08 finance release, not live ERP connectivity.
**Owner:** M08, no shared D1 schema/transaction/RPC ownership.
**Source pin:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, immutable under `legacy/source`.
**Prerequisite:** merged source behavior characterization #67 and #77.

## Objective
Provide a small, portable, source-faithful cash-balance and cash-session **read calculation** usable only after a later, separately authorized, authenticated repository integration. Characterization #77 already proves frozen GAS source behavior. The first internal JS code should match it rather than invent new accounting.

## Options considered
1. Wire Cash Session / Cash Book RPC now — rejected; M02-P/M03/M04/M06 and live posting gates remain incomplete.
2. Build a new journal, D1 schema, or dual-write engine — rejected; breaks single owner/accounting authority and has no cutover proof.
3. Add **pure, internal-only** cash projections with source-oracle parity and zero I/O (**selected**) — independent of shared kernel; no event writes, permissions, or app routes.

## Contract
- `cashBalance(activeCashRows)` takes an **already filtered, posting-order array of active** legacy Cash Book rows, ignores the stored per-row Balance, and returns `roundMoney(sum(Credit - Debit))`. Historical Opening contributes to the book balance; soft-deleted entries must be removed *by the future repository* before calling.
- `cashSessionSnapshot(session, sessionRows, activeCashRows)` returns `null` only when `session === null`, otherwise the legacy `cashSessionSummaryFromRows_` shape. Counts only rows **after** this session's `Session Open` reference marker; missing marker counts zero turnover. Excludes Historical Opening and all reconciliation-linked entry IDs (including JSON arrays and line/comma-separated legacy formats). While Closing, exclude same-session Day Close Adjustment, show stored Expected Cash if not empty and Counted Cash. Opening mismatch compares against previous Closed counted value and is hidden if book cash already matches current opening.
- Business dates are not session boundaries: a backdated transaction posted after the marker counts in that session.
- Exact money rounding follows frozen GAS `roundMoney_`: `Math.round((Number(value)+Number.EPSILON)*100)/100` with nonnumeric to zero.
- Reject non-array row inputs (including leaked promises); never silently assume bad data is empty. The future async D1 repository must explicitly load filtered active rows, validate access and enforce workerd-side auth. This pure module does none of that and must not be added to public RPC.
- No module-level state, writes, mutable caches, persistence, network or UI.

## Acceptance
A new `node:test` suite first fails without the module, then passes against hard-coded expected totals and **the original selected GAS functions** executed by the existing test-only VM helper. Run full `npm test`, source fingerprint, frontend build, and CI. No `src/index.js`, `src/rpc`, `src/db`, SQL migrations, auth, Cloudflare config, or historical source edits.

## Risk
These projections only handle already-loaded trusted rows. They do not establish real D1 atomicity, permissions, replay safety, transaction authorization, or source-data migration. Cash Session writes and bank transfers remain disabled pending mainline dependencies and owner-approved deployment.
