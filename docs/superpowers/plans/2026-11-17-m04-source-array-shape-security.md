# M04 security A08 — exact source array shape parity (2026-11-17)

**Owner:** M04 #23, security coordination #572, parallel #456. **Base:** `main@94534c5cdc39f9a482cecbb6cff25ef36159661a`. **Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Allowlisted files:** `src/auth/staff-import-audit.js`, `tests/m04-staff-import-audit.test.mjs`, this plan only. No M03-owned shared D1/migrations/Worker/RPC or real staff data.

## Implementation overview (12 sentences)

1. The initial offline M04 staff export audit checks the source USERS and ROLES collections before import.
2. Existing source row checks now reject unapproved data columns after merged PR #574.
3. The standalone audit still accepts extra own keys attached directly to a USERS or ROLES array.
4. Its downstream D1 importer rejects those same array-level extras with a strict own-key count.
5. This can produce a misleading preflight pass from the first guard when the later importer rejects the export.
6. The protected source export contract permits only dense numeric entries and the built-in array length.
7. Additional named keys, symbol keys, hidden fields or nonenumerable collection properties are out of contract.
8. A Proxy that errors while enumerating the array must fail closed with a fixed snapshot issue code.
9. The RED test will show ordinary valid source rows plus extra collection metadata are currently approved.
10. The minimal GREEN change will add a safe array-shape validation before reading any staff values.
11. Canonical dense arrays, empty arrays, historical provenance and existing output redaction must remain supported.
12. Full exact-head GitHub CI and security review are mandatory before merge; real imports and public auth remain disabled.

## Superpowers RED→GREEN

- RED: add a synthetic Node test to the existing M04 staff import suite asserting that array-level named, symbol and nonenumerable properties fail the preflight with `SNAPSHOT_INVALID`, never reflecting marker values; valid control continues to pass. Observe an actual GitHub CI failed test at the test-only HEAD.
- GREEN: in `auditLegacyStaffImport`, check own property names for both arrays against expected dense entries plus `length` without traversing secrets. Ensure exception handling denies on Proxy traps. Keep no new dependencies.
- Verification: re-run exact head Foundation, M04 real D1, M03 shards, M01 Chromium, all required GitHub workflows; publish evidence on PR #575 or the actual assigned PR; merge only on full green and applicable review gates. No M03 integrations.
- Rollback: revert these M04-only changes. No production deployment, credentials, money, inventory or source Sheets impacted.
