# M04: Exact protected export shape in the two-pass freeze gate

**Workstream:** M04, security source freeze (#23); coordination #456.
**Base:** `main@7c81dca09f975fbda37586eb50c2763c7f8506df`; previous M04 #479 and handoff #495 both merged.
**Frozen source:** Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` Config.gs USERS and ROLES only.
**Files owned:** `src/auth/two-pass-source-freeze.js`, `tests/m04-two-pass-source-freeze.test.mjs` and this M04-only plan. No shared M03 `src/db`, migration, posting, RPC, Worker, CI or source edits.
**Release effect:** none; offline, pure read-only gate. No remote data or live export.

## Module overview (12 sentences)

1. The approved protected staff export contains exactly two root properties, users and roles.
2. Both arrays must be dense and have no custom, hidden or symbol properties.
3. Every original user and role row has a fixed set of enumerable own data fields.
4. The merged #464 and #479 offline D1 importer rejects unknown properties at all three levels.
5. The existing two-pass freeze checks matching source field values but ignores unknown fields.
6. Two independently constructed but identically polluted snapshots can therefore appear frozen.
7. Such a false-positive freeze report would contradict the stricter importer and confuse a protected cutover rehearsal.
8. New RED tests will submit equally polluted snapshots at root, array and row levels, requiring a fixed-code failure.
9. The tests will also cover hidden fields, symbols, ordinary-object prototypes and getters without exposing their values.
10. The smallest GREEN change will add exact-key/prototype/data-descriptor validation to existing `sourceArrays` and row checks.
11. Valid separate snapshots, canonical historical field values and existing source-change issue codes must remain unchanged.
12. The patch stays offline and does not authorize live staff migration, public login, any financial write or production launch.

## Superpowers RED → GREEN and merge gate

- RED test only: two separately created snapshots with identical extra `sessions`, root keys, array metadata or row fields must return `freezeMatch:false` without credential values. A prior passing `freezeMatch:true` demonstrates the actual gap.
- Keep valid snapshots passing, changed original source fields returning original source-change issue code and no secrets/logs.
- Run GitHub Foundation on the test-only head. Confirm only the new regression fails for the expected unsafe acceptance, not a setup error.
- GREEN minimal code: exact root `users`/`roles` enumerable own data descriptors; plain or null root prototype; dense arrays with `length` plus numeric indices only; rows with exact required enumerable own fields and plain/null prototypes. Catch hostile traps and fail closed before comparison.
- Verify full affected Node and real local D1 CI on the exact GREEN head, and source manifest/Playwright/Cloudflare PR safety as required. Do not use fast checks to waive full suite.
- One PR against main; require owner/M04 review, no concurrent same-file PR and all checks green. The audit is *only* source consistency, not independent acquisition attestation.
- Rollback: revert this isolated M04-only validator/test, no D1 or data rollback.
