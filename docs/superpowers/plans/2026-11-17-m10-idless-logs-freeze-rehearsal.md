# M10-10 — Genuine id-less LOGS provenance in 49-group source-freeze rehearsal

Date 2026-11-17. Tracks M10 #312, remains production NO-GO. Source pin `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. GitHub branch based on `SherERP_Cloud/main@aa11a2f814d6cb60fed1a9695e168398314540ed`.

## Twelve-sentence overview

1. The reviewed frozen `LOGS` legacy sheet has `Timestamp`, `Context` and `Message` but no authentic original source row identifier.
2. Existing M02 and M10-09 evidence therefore represents `LOGS` provenance with `positionDigest` and `identityKind:'SOURCE_ROW_POSITION_ONLY'`, never an `idDigest`.
3. M10-01 rehearsal summaries currently require `idDigest` for all 49 groups, which prevents genuine `LOGS` evidence from reaching the full rehearsal gate.
4. M10-03 two-pass source-freeze summaries likewise require an invented `idDigest` for `LOGS`, contradicting the reviewed M10-09 contract.
5. This narrow change makes both existing M10 preflights accept that one proven id-less group through explicit positional provenance, without fabricating identifiers.
6. All other group evidence retains the current strict original-ID digest contract pending its own independently reviewed source mapping.
7. A valid M10-01 or M10-03 input for `LOGS` must contain exactly `sheetKey,rowCount,rowDigest,positionDigest,identityKind` with the fixed positional identity kind.
8. A `LOGS` entry with an `idDigest` or mixed identity fields must be rejected before any summary is deemed valid.
9. A non-`LOGS` entry must reject a position-only downgrade and continue to require its existing `idDigest` field.
10. The freeze gate must identify changes in `LOGS` row positions across independent captures, and the rehearsal gate must reject source-versus-D1 positional mismatches.
11. Regression tests are committed first and expected to fail under the old implementation in GitHub Actions; then the minimal implementation and affected synthetic fixtures are updated, followed by exact-head CI.
12. The result is still an **offline summary checker**, not real 49-group import, source access, D1 readback, authenticated evidence, approval to migrate live data, or permission to cut over.

## Impact, acceptance and boundaries

- New: `tests/m10-idless-logs-rehearsal-compat.test.mjs`, this plan.
- Scoped implementation: `src/migration/m10-source-freeze.js` and `src/migration/m10-rehearsal-gate.js`; adjust existing synthetic M10-01/M10-03 fixtures to reflect authentic `LOGS` semantics.
- Add a brief note to `docs/MIGRATION_PLAN.md` only if useful for provenance policy.
- Preserve fixed diagnostic counts and messages; never log raw business data, source IDs, hashes, customer details or sensitive errors.
- Run GitHub Actions RED and GREEN; no local desktop required, no schema/transaction/Cloudflare config/deployment edits, no GAS/Sheets, no real D1 or customer data, no final GO.
- Existing M10-09 `assessM10ReviewedGroupParity` remains unchanged, as it already has the correct provenance semantics.
- Target negative tests: forged `idDigest`, missing position proof, mixed fields, wrong kind, duplicate group, positional change during freeze, source-vs-D1 position mismatch, non-LOGS spoof.
- Production continues NO-GO until all 49 actual groups are imported/reconciled and reviewed independently with real source and D1 evidence.
