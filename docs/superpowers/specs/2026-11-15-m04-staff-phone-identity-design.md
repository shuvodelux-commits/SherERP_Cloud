# M04 Staff Phone Compatibility and Ambiguous Login Guard — Design (2026-11-15)

**Status:** Pure internal legacy compatibility and login-identity preparation only. No public login, database schema, credentials, or Party-identity linking.

## Pinned source and issue
Source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`: `legacy/source/Utils.gs::normalizePhoneDisplay_/normalizePhoneSearch_/phoneNumbersEqual_`, `Auth.gs::login`, `UserManagement.gs`. Original phone helpers repair **only** unambiguous ten-digit Bangladesh mobile numbers by prepending zero for display, convert Bengali numerals for search, strip separators and normalize `8801...` / `1...` variants to `01...`. Source login selects **first matching** user; a migration with duplicate equivalent staff numbers must not silently choose one user.

Phone numbers are identifiers. The Unified Party architecture forbids inferring Party links from a phone number: this slice concerns **staff login users only**, never customer/supplier/vendor merging.

## Approach
1. **Chosen:** internal faithful display/search comparison primitives plus a fail-closed unique staff-number matcher that reports `none/unique/ambiguous/invalid-record` without returning user objects or authenticating a request.
2. Modify Party import grouping and staff login simultaneously. Rejected: M02 Party identity ownership and D1/auth gates; auto-links forbidden.
3. Activate a public login with first-match semantics. Rejected: duplicates/ambiguity, throttle/permission/session gates unfinished.

## Internal contracts
- `normalizeLegacyStaffPhoneDisplay(value): string` mirrors original `normalizePhoneDisplay_` including String coercion and trim, and preserves all non-ten-digit formats verbatim.
- `normalizeLegacyStaffPhoneSearch(value): string` mirrors original `normalizePhoneSearch_`: convert `০১২৩৪৫৬৭৮৯` to ASCII, strip `\\D`, normalize `8801[3-9]` and ten-digit `1[3-9]` prefixes. No speculative extension, country-code interpretation or validation beyond source. Search form is **not for display**.
- `legacyStaffPhonesEqual(a,b): boolean` mirrors original `phoneNumbersEqual_`, requiring both normalized values to be nonempty.
- `findUniqueLegacyStaffPhone(users, input): {status:'none'|'unique'|'ambiguous'|'invalid-record',index:number|null}`: accepts an array of server-loaded staff records with own data field `'Mobile Number'`; rejects malformed or accessor/inherited-only phone records by reporting invalid-record; detects collisions across every record and returns index only for exactly one match. No account field or personal identity is returned. A failed persistence read must **not** be passed as an empty array; the future D1 caller must fail closed on database errors.
- This matcher does not check password, disabled status, duplicate staff IDs, role, session or throttle. Future login must use trusted D1 reads plus a single actor identity and authorization under a reviewed DB boundary. Unknown country/shortphone formats remain an explicitly unresolved legacy compatibility policy, not implicit public-login acceptance.

## Ownership and files
- New `src/auth/staff-phone-identity.js`, `tests/m04-staff-phone-identity.test.mjs`, this design and plan.
- Do not change `src/auth/legacy-password.js` (merged PR #31), draft permission policy #30, draft token #34, validity #35 or throttle #36, shared `src/db`, RPC, Cloudflare config, frontend or original source.
- No SQL, D1, Party, ledger, stock, invoices, cash or finance changes.

## Acceptance gates
- Source parity tests reading pinned `Utils.gs` and comparing a table of synthetic normalizations, including Bengali digits and damaged Sheets numbers.
- Strict test first RED→GREEN; unique/ambiguous/corrupt records, non-mutation and public RPC still 501.
- Full source manifest, Node suite, frontend build, syntax and diff verification. Only an isolated draft PR; no live staff login.
