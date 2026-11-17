# Superpowers TDD — M08 gross financial roles and historical opening D1 parity

**Issue #66**, parallel coordination #456, main baseline `7c81dca09f975fbda37586eb50c2763c7f8506df`, dependency #486 merged. **One objective/branch/PR:** account-role isolation read-only on disposable local Workerd/D1.

## RED phase

1. Extend existing M08 local Workerd D1 suite with imports for intentionally absent `tests/fixtures/m08-d1-role-account-schema.mjs` and `tests/fixtures/m08-d1-role-account-preview.mjs`, without touching Wrangler or global CI.
2. Test three independent groups: (A) Finance Person exact-ID source oracle, signed Owner/Lender/Borrower gross balances and same-name identity, (B) Opening Owner Capital/Loan/Borrower historical position with no Cash/Bank movement and soft-delete exclusion, (C) Customer/Supplier independent same-ID gross ledgers, date/physical-row order, deleted rows and negative balances. Add wrong-tenant, unknown Finance Person, duplicate IDs and invalid/untrusted request cases.
3. Commit RED tests before fixtures, open draft PR against main, observe actual CI failure `ERR_MODULE_NOT_FOUND` in dedicated M08 Workerd job; do not mislabel an unrelated failure as RED.

## GREEN phase

4. Introduce disposable `m08_role_persons`, `m08_role_finance`, `m08_role_party` STRICT local fixture tables; no shared D1 migration. Preserve tenant and immutable `legacy_row` identities.
5. Create a strict request validator and three parameterized tenant-bound SELECTs executed in one D1.batch; reject duplicate Finance/Party IDs and untrusted input; project source-shaped data using existing pure M08 models.
6. Verify source GAS and hand-checked balances on real local Workerd, no writes, no public Worker routes. Fix any discovered defects test-first; record exact RED/GREEN commits and runs.
7. Require latest-head full CI including M03 real Workerd integration, source integrity and browser checks, plus owner/file scope review and mergeability before merge. Verify merged main files after approval.
8. Keep parent #66 and #452 open for M02/M03/M04/M06 production gates; release no Cash Session or finance posting.
