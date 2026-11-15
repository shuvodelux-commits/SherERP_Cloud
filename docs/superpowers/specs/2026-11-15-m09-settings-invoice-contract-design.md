# M09 Settings and Invoice Design Contract Parity — Design (2026-11-15)

## Intent
Freeze the original Settings and Invoice Design API, permission, editable-key, upload and frontend-call surface against the pinned Mohim_ERP source before enabling any M09 Worker RPC. Catch accidental loss of receipt and print configuration while M03/M04 and finance work continue.

## Source of truth and boundaries
- Original commit: `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` via `docs/baseline/source-manifest.json`.
- Inputs only: `legacy/source/Settings.gs`, `Invoice.gs`, `settings.html`, `invoiceDesign.html`.
- No modification to those files, Worker/runtime/RPC, `src/db`, D1, auth, UI or Cloudflare preview. No actual upload or print operation is executed.
- Preserve exact original page handlers and backend contracts. Setting writes and logo upload remain unavailable until authorized, atomic real-D1 replacement exists.

## Approaches
1. Activate Settings/Invoice RPC now: rejected because authorization, asset storage, and operational migration gates are incomplete.
2. Hand-maintained mapping: rejected because it can drift without detection.
3. **Selected:** frozen-source lexical audit and deterministic checked-in JSON, with Node tests for source mutations, permission drift, UI call drift and stale snapshot rejection. Reuse the existing M09 Reports inventory pattern.

## Contract to capture
- Five public Settings RPC functions and their exact `settings:view` / `settings:edit` gate.
- Editable, numeric, and boolean setting-key allowlists; max decoded logo bytes and accepted MIME list.
- Direct Settings backend group reads; both Settings HTML pages' `serverCall` function names and DOM IDs.
- Invoice renderer's literal `settings['...']` reads including footer, payment terms, receipt size and visibility options.
- Deterministic source SHA and method warning: static lexical inventory, not behavior, security, D1, or print parity proof.

## Acceptance and negative cases
- Fail closed if a public function or permission check disappears; fail if a required source or SHA is missing.
- Commented-out RPC references are ignored; live UI RPC additions and editable-key changes alter the snapshot.
- `--check` fails on stale manifest, `--write` is explicit; normal tests do not rewrite inventory.
- Real Node suite and pinned-source build pass in GitHub Actions after RED test evidence.

## Deferred gates
Implement and verify Worker/D1 settings reads and guarded edits under M03/M04 ownership; separately provide safe asset storage and authentication for invoice logos, exact visual/PDF/print parity and browser checks. Actual M09 SQL reports depend on M05/M07/M08. No main/production D1 or original GAS writes.
