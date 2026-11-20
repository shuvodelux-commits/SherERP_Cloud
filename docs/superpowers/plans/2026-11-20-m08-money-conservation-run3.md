# M08 Run 3 — New-shop money conservation, independent probes

**Status:** Test-only engineering preparation; no operational money-scale/tie specification or SQL authorization.  
**Base:** `SherERP_Cloud main@15f18b55b59a6b3964d92dd9f1ad07d39662a0da`; pinned original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Workstream:** M08 #66 with M02 #24 and shared integrator M03 #22; coordination #456.  
**Owner business policy:** [#66 approved choices](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/66#issuecomment-7030515664).  
**Concurrent lane:** Draft #722 is the M03 Control Center implementation and owns entirely different paths.

## Twelve-sentence scope overview

1. Run 2 source regression PR #723 is merged, but its synthetic source behavior must not be mistaken for a production financial contract.
2. The owner has approved new-shop final-return residual conservation and cash refunds bounded by verified collected money, while original historical rows retain the source behavior.
3. Exact decimal precision limits, rounding ties, overflow rules and D1 monetary SQL remain unsigned engineering gates.
4. Run 3 will add an isolated M08 test and small test-only reference fixture without changing the operational ERP.
5. The decimal probe will multiply canonical nonnegative decimal input strings exactly without converting them to floating point.
6. The probe will preserve `0.5 × 10.005 = 5.0025` rather than silently choosing a paisa rounding result.
7. An approved final eligible partial-return scenario will demonstrate `0.33 + 0.33 + 0.34 = 1.00` using integer paisa.
8. Non-final return amounts must not exceed their remaining eligible value, and exhausted eligibility must fail closed.
9. The cash-refund ceiling probe will never exceed verified net collected money minus earlier refunds.
10. Amounts not refundable as Cash are identified as a noncash remainder only; source AR and actual Store Credit posting still require separately verified transaction authority.
11. The test is pure and synthetic, with no tenant routing, Cash Session bypass, live D1 writes, financial journals, or legacy history edits.
12. The M03 owner can consume this reviewed evidence only after a separate M08 exact-scale/tie/overflow sign-off and real SQL-time authorization/replay/rollback acceptance.

## File ownership

- NEW `tests/m08-new-shop-money-conservation.test.mjs` — M08-only acceptance probes.
- NEW `tests/fixtures/m08-money-conservation-probes.mjs` — tiny test-only BigInt/remaining-minor-unit reference logic.
- THIS plan file; no edits to `src/db/**`, `src/rpc/**`, `src/index.js`, Worker configs, numbered migrations, source modules, frontend, or PR #722 paths.

## TDD and evidence

1. **RED:** Commit the regression test importing the not-yet-existing fixture; execute the focused test to confirm the expected missing-module failure (this is a new test-only oracle, **not** a production bug).
2. **GREEN:** Add only the isolated fixture and rerun focused test and repository checks.
3. **Review:** Exact-head CI, independent Super QA/Super Review and human merge are required; do not report a local/test-only check as real financial D1 acceptance.

## Explicit non-goals and handoff

- No policy choice for the actual paisa rounding boundary, rounding tie mode, accepted numeric scale, discount apportionment, negative zero or database overflow.
- No production RPC, posting, returns, Cash Session or refund behavior change.
- Final-return status, invoice source linkage, paid/reimbursed evidence, actor permissions, tenant identity, idempotency and atomicity **must** be enforced by M03/M04 within the SQL transaction, not by this pure arithmetic probe.
- No change to historical source returns or imported accounting, no remote Cloudflare provisioning and no production release authorization.
