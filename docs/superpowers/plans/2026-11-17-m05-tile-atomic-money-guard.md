# M05-0018 — independently guarded tile purchase minor-unit conservation (test-only)

**Parent dependency:** #443 `m05/tile-atomic-receiving-proof-0017`; also requires #442 / #441. Branch stays draft and stacked until ancestors are merged and exact-head CI reruns.

## Twelve-sentence implementation overview
1. An audit of the #443 synthetic receiving trigger found that stored price identity and physical quantity are checked, but the supplier-credit minor-unit amount is still accepted as a caller-bound value.
2. Reproduce the vulnerability with an actual local Workerd/D1 insert whose original product, revision, boxes, pieces, and price evidence are correct but whose `line_amount_paisa` is forged.
3. The expected RED failure is an unauthorized receipt succeeding instead of a D1 constraint rejection, not an artificial missing-module import.
4. Add a SQL-side independent integer-arithmetic comparison of the recorded line amount to the authoritative product-specific price and physical base-piece count.
5. Support the first source-grounded subset only: nominal integer-inch tile dimensions, manufacturer Sqft-per-box coverage with at most four decimals, and Box, Pcs, or Sqft prices with at most four decimals.
6. Accept only positive whole physical quantities up to 100,000 pieces and bounded quoted prices/measurements so all intermediate SQLite integer multiplications remain below signed 64-bit limits.
7. Normalize decimal price text into a fixed four-decimal integer scale without REAL, CAST-AS-REAL, ROUND, exponent notation, or JavaScript floating-point money.
8. Apply one half-up BDT paisa rounding at the end to match the reviewed pure tile price contract's exact rational arithmetic.
9. Keep current manufacturer coverage distinct from nominal geometry, and fail closed for unsupported dimensions, excessive precision, or unsafe money bounds instead of guessing.
10. Verify forged amounts are rejected with zero receipt, stock, lot, movement or supplier-credit effects while identical valid quotes still commit.
11. Preserve operation fingerprinting, replay, source identity, price revision, Cash Session test gate, atomic rollback and original UI without changes.
12. Add a narrowly scoped real Workerd/D1 regression and keep this entire capability synthetic, private, and nondeployable until M03/M04 and financial-account safeguards are separately proven.

## File impact
- Existing test fixture receiving schema: add a code-owned, immutable SQL expression for exact amount conservation inside the existing receipt trigger, not a second posting path.
- New `tests/fixtures/m05-tile-exact-money-sql.mjs` holds pure, bounded fixed-point SQL expression helpers; no external dependency or query-controlled identifier.
- Existing `tests/integration/m05-tile-atomic-receiving-workerd.spec.mjs` gets malicious direct-insert and bounded parity regression cases; tests execute in the existing isolated worker.
- No `src/db` or production `migrations` change, public RPC, Cash/Bank action, source Sheets write, or remote D1 access.
- This proof cannot yet commit area-entered Sqft receipts. Box/Pcs physical receiving with Sqft *pricing* remains in scope.

## TDD and gates
Commit tests first, observe a genuine red CI failure, implement minimal SQL guard, run 14-migration local D1 plus full Node and source/UI checks, and only report GREEN from exact head CI. Do not merge draft child ahead of #443/#442/#441 or bypass a pending broad M03 integration test without fresh owner authorization.