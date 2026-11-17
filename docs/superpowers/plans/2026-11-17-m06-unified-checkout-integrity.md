# M06 — POS V2 unified checkout integrity audit (read-only)

**Workstream:** M06 / #314; coordination #456. **Base:** main @ `76cca6a9b107603cc19a727a6907c7602cddd011` after merged PR #562. **Source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 for sale/payment semantics and sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c for unit conversion. **Dependency:** merged PR #562; M03 public posting #22 and M04 authority remain blocked by docs/M03_PARALLEL_READINESS.md.

## Module overview (12 sentences)

The original POS V2 must combine ordinary and mixed-unit products with Tiles in one cart. PR #562 provides a private read-only composition of those lines. Historical sales must not silently reinterpret original unit factors or Tile measurements. The new validator examines an already constructed private display quote without requesting current prices. It verifies one logical Product ID per line. It checks component base-unit conservation for standard mixed-unit lines. It checks Box and Pcs physical conservation for Tile lines against their saved manufacturer count. It compares each saved line amount with the saved subtotal using integer paisa. It verifies discounts and the exact Grand Total after the original clamp. It reconciles Cash change, Bank/Mobile applied rows, and independent Due without touching any ledger. It refuses malformed/accessor-backed snapshots and never creates posting authorization. M01 may consume the diagnostic display contract after its own UI review, while M03 must independently recompute all trusted quantities, prices and Cash Session/actor decisions inside the approved SQL transaction.

## Files and boundaries

- `src/modules/m06-posv2-unified-checkout-audit.js` — new pure diagnostic, read-only; no SQL and no RPC.
- `tests/m06-posv2-unified-cart-preview.test.mjs` — new regression cases attached to the merged isolated real SQLite/D1 quote fixture.
- This plan only. **No** `src/db/**`, migrations, `src/rpc/**`, `src/index.js`, original HTML, M01 QA, M04 authority, M05 conversions, M07 returns, M08 cash or Worker config changes.

## TDD and acceptance

1. RED: first commit tests requiring new `auditPosV2UnifiedCheckoutSnapshot`, verify expected missing export/failing assertions on GitHub.
2. GREEN: implement only the pure audit; preserve existing private quote output and original source payment math.
3. Valid standard Bag/Box/Pcs + Tile Box/Pcs/Sqft split-tender cart passes. Corrupt saved line money, discount, unit factor, Tile Pcs, Cash change, paid/due, duplicate ID and posting flag fail. A malicious accessor cannot execute.
4. Required full CI (Node, authentic source hash, six Workerd/D1 shards, browser/UI preservation) must be green at exact head before merge. RED is a test-specific expected failure, never a production incident.

**Release:** Internal evidence only; `postingAllowed:false`. No current-price recheck, new invoice/storage, financial write, Party association, session issuance or public endpoint. **M03 handoff:** versioned source row identities, M04 actor/tenant, M05 stock+unit revision, M08 cash/bank signs and M07 reversal must still be reviewed together before transaction activation. **Rollback:** revert these M06-only files, no data rollback.
