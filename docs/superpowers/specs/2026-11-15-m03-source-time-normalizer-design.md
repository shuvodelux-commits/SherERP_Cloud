# M03 — Source-faithful time-only normalization without GAS

**Frozen authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `legacy/source/Utils.gs::safeTimeOnly_` (identical read-only snapshot `legacy/source/Utils.gs`), with original `Session.getScriptTimeZone()` and `Utilities.formatDate()` used only for a genuine Date object.

## Problem

Google Sheets can represent a time-only value as a Date anchored to `1899-12-30`; serialized rows can therefore contain e.g. `1899-12-30T17:35:01`. Returning that date in an ERP clock/time field corrupts display parity. The frozen source strips it to `HH:mm:ss`; new Worker code cannot call `Utilities` or `Session`.

## Selected KISS implementation

New `src/modules/source-time-only.js` exports `safeSourceTimeOnly(value, timeZone)`. Exactly reproduce the source text path for null/falsy values, ISO-ish timestamps with fractional seconds/offsets, ordinary 1–2 digit hour time literals and fallback untouched trimmed text. **Do not parse or timezone-shift source text**, because the frozen function extracts its embedded wall-clock time literally.

For actual JavaScript `Date`, require a nonempty **trusted explicit IANA timezone**. Replace GAS `Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm:ss')` with `Intl.DateTimeFormat` using `hourCycle:'h23'`, explicit `timeZone`, 2-digit hour/minute/second, and `formatToParts`; reconstruct exactly `HH:mm:ss`. If timezone is missing, throw a TypeError rather than guessing Worker/UTC locale or silently changing cash-session timestamps. Invalid timezone or Date must fail closed; do not fall back to date text.

**No new external dependencies or source duplication.** Do not call this from live RPC or trust a client-supplied timezone; production callers later must resolve timezone from owner-approved server settings. The function does not authorize data, read D1, or establish tenant scope. This is one isolated M03 Utils.gs compatibility primitive, not full async migration.

## Acceptance / verification

- Source oracle executes exactly the frozen function in Node VM. For genuine Dates a fake GAS `Session` returns the explicit test timezone and `Utilities.formatDate` provides that zone's wall-clock time; literal input-output assertions independently guard source oracle drift.
- Cover `1899-12-30` anchor timestamps, Bangla/noisy fallback text, multiple offsets, fractional seconds, one-digit hours, timezone difference UTC vs Asia/Dhaka, invalid/missing timezone, null/false/0 and mutation isolation.
- TDD RED when new module is absent; GREEN with minimum pure implementation; exact-head GitHub Foundation, frozen source verification, existing M01 Chromium, M03/M04 local Workerd-D1, preview-safety CI.
- **Impact:** new utility module, new Node tests, this spec and plan only. Zero `src/db`, SQL/migration, RPC/Worker entrypoint, frontend HTML/CSS/JS, original source, staging/production bindings, or financial posting changes. Revert isolated PR to roll back.
