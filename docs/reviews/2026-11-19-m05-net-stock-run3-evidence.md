# M05 Run 3 — Net-stock FIFO preview and safety proof

**Date:** 2026-11-19 (Asia/Dhaka)  
**Scope:** M05 read-only, opt-in net-owned FIFO PREVIEW — not a posting or live POS integration.  
**Main base:** 23e3ec4b1a196bc8669c90f9b6260d5d40c0ba66 (Run 2 PR #686 merged).  
**Plan:** docs/superpowers/plans/2026-11-19-m05-oversold-lot-cost-parity.md (Task 3), technical design in accompanying specs file.

## Root cause and intentional boundary

Pinned source \`planStockConsumption_\` draws from all positive remaining lots even when older OVERSOLD lots make the product's *net* Current Stock smaller; \`buildLotPricingLadder_\` likewise quotes the gross positive quantity. The earlier \`planSaleVendorConsumption_\` already limits own drawn quantity to cached net stock, but non-vendor own sales do not.

**Safety ruling:** preserve byte-for-byte frozen original \`src/modules/stock-fifo-planning.js\` (the source-parity fixture asserts exact functions) and the established \`m05-fifo-eligibility-gate.js\` behavior. Add a NEW \`planNetOwnedStockPreview\` read-only function so future M06 integration can opt in only after accounting/source gates. No historical posting code is changed in this PR; this avoids silently altering existing source or production invoices.

The helper computes positive and negative quantities from explicit trusted same-product lots, refuses mismatched Product Current Stock, invalid source status/cost, Deleted positive lots, duplicate IDs, non-chronological negative events and multiple ambiguous positive funding lots. With one positive purchase lot and earlier OVERSOLD, it creates a **virtual (unposted)** reduced positive lot for a net-stock-capped preview. It calls the preserved original FIFO/pricing planners against this temporary snapshot.

**Critically:** the result is \`postable:false\` and omits \`rowIndex\` and \`remainingAfter\` fields from all virtual draws. Never pass these hypothetical draws to any stock movement or SQL writer. The source stock lot remains untouched and is not physically reduced by this module.

## Verified synthetic scenario

- Purchase: +240 Foot at BDT 64.75 (single positive lot).
- Historical oversold: -229 and a synthetic -2 Foot at BDT 68 (NOT independently proven in the photographed business data).
- Net owned: 9 Foot, not gross positive 240.
- Preview request: 10 Foot -> 9 owned draw at purchase lot cost 64.75 + 1 Foot shortage.
- Pricing ladder advertises only 9 available feet at the lot sell price, rather than 240.
- Vendor-sourcing preview similarly allows only 9 owned feet and a 1 Foot vendor shortage.
- Any contradictory 9-versus-11 source snapshot remains Needs Review, not auto-adjusted.

For two or more positive candidate purchase lots alongside an unresolved negative lot, the current safe implementation refuses to guess which historical sale each purchase funded. The future M03/M05 settlement-link contract must prove that allocation before expanding to multiple lots. Conversion to base units is NOT part of this preview; the trusted caller must supply already converted canonical quantities and a verified single-product unit. This does not implement Tiles or mixed-unit posting.

## TDD evidence (local)

The new module and test source blobs published on GitHub were byte-exact against locally tested files:

- \`src/modules/m05-net-stock-fifo-preview.js\`: \`01b8349580eb17419c25ec52f40b480120935443\`.
- \`tests/m05-net-stock-fifo-preview.test.mjs\`: \`98762038be4f659e4d47992e00dd83bada709d20\`.
- Both existing imported files in local test copy matched GitHub main blob hashes:
  - \`stock-fifo-planning.js\`: \`7b3841bdcfaab4ca8627233d516c6a90982bb367\`.
  - \`m05-fifo-eligibility-gate.js\`: \`9537675792b3cc87555644be14d2c4839a387fe9\`.
- RED 1: new test file failed \`ERR_MODULE_NOT_FOUND\` before implementing the preview module.
- GREEN 1: 12/12 new tests passed.
- RED 2: asserted that virtual draws contain no posting row fields; two tests failed with old virtual draw fields.
- GREEN 2: sanitized draws and \`postable:false\`; 13/13 new tests passed.
- RED 3: future-dated OVERSOLD and invalid purchase costs were accepted; two tests failed.
- GREEN 3: added chronology/cost guards; final focused tests 15/15.
- Mutation: changing virtual reserved quantity to gross quantity failed 2 tests. Restoring made tests green.
- Final command: \`node --test tests/m05-net-stock-fifo-preview.test.mjs tests/m05-fifo-eligibility-gate.test.mjs\`: **21 tests / 21 pass / 0 fail**, Node 22.16.0.
- These are exact 4-file isolated local tests. **Full repository \`npm test\`, pinned source checks, other M06 tests, real Workerd/D1 and exact-head GitHub CI are not yet proven**; review PR checks separately.

## Deployment and accounting gates

- The code introduces no RPC/endpoint, UI, permission bypass, D1/Sheet connector, migration, journal, mutation or automated live correction.
- \`unitCost\` is sensitive data; an M06 caller must enforce existing POS cost/profit permissions **before** returning any output to a user.
- Do NOT describe this PR as a live POS bugfix. Future M06 integration must deliberately select this read-only preview contract, and the M03 SQL posting service must use independently proven atomic settlement links, NOT these virtual draws.
- Full source cash/party history, purchase returns, multi-unit and Tiles conversion, exact variance journals and historical backfill remain separate gated tasks.
- User review + full exact-head CI + independent Super QA/Super Review before merge; never treat this audit as authorization to alter real business records.
