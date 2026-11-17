# M02 tiles foundation and integration contracts — 2026-11-17

Status: reviewable design plus a pure executable quantity/price contract. Not a completed D1 migration or complete M02.
Tracking: #24 (M02-safe), #314 (multi-unit). Canonical source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
Supplement: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c, ProductUnitConversions.gs, historical PRs #27/#30/#38/#39.
Current target baseline: a7acd1013c3c90a4482bd1d8571193d18640a206.

## Existing foundation and missing work

Read the full 49-group matrix at ../../reviews/2026-11-17-m02-completion-matrix.json and the existing ../../reviews/2026-11-16-m02-m03-source-coverage.md.
Already present: source-frozen catalog/Party identity mappings; 0001–0013 migrations; immutable audit importers; Products source snapshots; operational candidate Products and immutable unit profiles/conversions; existing pure quantity/purchase/sale helpers.
Party accounts/financial tables are not supplied by party_legacy_links.
Neither source archives nor synthetic fixture parity proves complete historical import.
PR #434 adds source-faithful price anchor/override normalization separately; this spec reuses that ownership.
Thirty source groups still need source-specific DDL and import adapters. No universal untyped archive substitutes for these destinations.

## Ownership and safety

M02 owns source map/import contracts. M03 integrator owns shared schema/posting coordination.
Protected Party account/sign review precedes financial DDL; ADR-007 alone is not executable-schema approval.
Existing architecture starts with a single business per D1. Current catalog keys are NOT tenant-composite keys.
Therefore the current database must never be shared by tenants based on an application filter. A future shared-tenant database requires separately reviewed composite keys/FKs/unique constraints and cross-tenant real D1 tests.
For current isolated single-business D1, bind a trusted business/source manifest at import; reject any other business/source and test it. Do not claim existing unscoped catalog schema proves shared-tenant isolation.
No public binding, production login, public RPC, remote import/migration or original Sheets write is authorized.

## Pure tiles contract

Files: src/modules/tile-quantity-contract.js; tests/m02-tile-quantity-contract.test.mjs.
resolveTileQuantity(measurement,request) accepts an explicitly supplied trusted historical revision, never a DB binding or browser-authoritative factor.
Measurement keys:
productId, revision (positive integer string), baseUnit='Pcs', boxConversionId (non-BASE), length, width, dimensionUnit ('in'|'cm'|'mm'), piecesPerBox (positive integer string), coveragePolicy ('nominal'|'manufacturer'), optional manufacturerSqftPerBox and manufacturerEvidence.
Decimal inputs are canonical nonnegative strings with at most 24 integer and 12 fractional digits; no exponent/coercion/whitespace/leading zeros. Identity strings are bounded, nonblank and exact.
Physical quantities use whole decimal-string integers. The compatibility bridge to the existing Number-based multi-unit resolver refuses any quantity exceeding Number.MAX_SAFE_INTEGER, before conversion to Number.
Output includes pieces, normalized boxes/extraPieces, nominalSqft, actualSqft, requestedSqft (null for pack input), displaySqft, detached measurementSnapshot and existing source-shaped unitSnapshot.
Exact rational values serialize as {numerator:string,denominator:string}, reduced with positive denominator.
Snapshot contains the full revision/policy/evidence/dimensions/pack configuration, including unused verified manufacturer metadata when nominal is selected.

Request union:
- {mode:'pack',boxes,extraPieces}: nonnegative whole integers, positive combined pieces. Extra pieces normalize for display; entered breakdown is retained in unitSnapshot.
- {mode:'area',requestedSqft,fulfillment:'loose'|'box-only'}: positive decimal area; ceil(area/effectiveAreaPerPiece), then ceil to a whole pack for box-only.
Reject ambiguous pack+area requests and invalid policies.
Nominal area = exact inch-length × inch-width /144. 1 cm = 50/127 inches; 1 mm = 5/127 inches.
Manufacturer area per piece = verified advertised Sqft/box / piecesPerBox only when explicitly selected.
No default manufacturer switch, no stock fractions, no assumptions about 25 pieces or original sample memo factors.
For 12×8 inches/25 pieces: 2 boxes+3 pcs =53 pcs=106/3 Sqft; requested 35.50 ->54 pcs=36 Sqft ->2 boxes+4 pcs.
No allocation of unopened physical cartons is implied by arithmetic boxes=floor(pieces/pack). Actual pack-state tracking, if needed, is a separate approved feature.

priceTileQuantity(measurement,request,pricingUnit,unitPriceText) recomputes the quantity using the same contract.
Pricing unit is exactly Pcs, Box or Sqft (Carton display is an alias for the selected Box conversion, not a second stock unit).
Pcs billing quantity=pieces; Box=pieces/pack; Sqft=effective exact area. A mixed full-box/loose-piece unit-override transaction continues to use the existing component pricing path instead; do not charge both this whole-line price and component prices.
This helper consumes a selected trusted price and retains it; price selection/override authorization remains with the existing product price profile and future M04/M05/M06 adapters.
It outputs exactAmount, lineAmountMinor, quantity, billingQuantityDisplay, priceSnapshot, displayQuantityAmountMinor and displayQuantityAmountDeltaMinor.
It is not a discount/tax/payment/FIFO/refund engine and does not change canonical source historical money.

## Proposed D1 extension — approval and real D1 tests required

Extend existing product_unit_profiles(product_id,revision); do not add a tile product or stock ledger.
Proposed product_tile_measurement_revisions:
- product_id TEXT, revision INTEGER: composite PRIMARY KEY and FOREIGN KEY to existing product_unit_profiles; ON DELETE RESTRICT.
- box_conversion_id TEXT: composite FK (product_id,revision,box_conversion_id) to product_unit_conversions.
- length_text, width_text, dimension_unit: exact original configuration evidence, constrained supported unit.
- pieces_per_box INTEGER: >0, safe compatibility ceiling; must equal the named pack conversion's exact integral base-Pcs factor.
- nominal_sqft_numerator TEXT, nominal_sqft_denominator TEXT: positive canonical integer strings, derived exactly from dimensions.
- manufacturer_sqft_box_numerator TEXT, manufacturer_sqft_box_denominator TEXT: both null or both positive canonical integer strings.
- coverage_policy TEXT: nominal|manufacturer; manufacturer needs evidence reference and its coverage pair.
- manufacturer_evidence_ref TEXT nullable; source_profile/revision/evidence identity retained.
- purchase_pricing_unit/selling_pricing_unit TEXT: Box|Pcs|Sqft; existing price overrides remain versioned with the product price profile.
- created_at_text TEXT: source-compatible date evidence, no fabricated UTC interpretation.
- immutable UPDATE/DELETE triggers; insert guard verifies Pcs base/profile, same product/revision and named active Box conversion, derived rational consistency and pack factor.
Index the product/revision FK lookup. All fixed SQL identifiers are allowlisted; parameterized values only.
Do not persist derived current stock or an independent current tiles balance.
BigInt application validation must match DB guards. SQL lexical checks alone do not prove derived ratios, canonical reduction or safe decimal bounds; actual D1 test vectors must pin this boundary before approval.
Future posting records need immutable quantity+price snapshots and revision FKs in their native document items. Do not invent generic financial document tables here.
Any chosen migration number is allocated only from fresh main after owner coordination; 0014 is not reserved by this design.

## Historical and coexisting pack revisions

One canonical stock Pcs dimension never changes. Current product settings choose a new complete revision without updating old revisions or transactions.
Every stock receipt/movement retains its applicable revision and original lot ID. Stock UI reports revision-specific equivalent boxes/area when revisions coexist, plus a canonical Pcs total.
Do not apply current area/pack values to old lot quantities or sum unrelated revision coverage as if one current carton definition applied.
Old transactions without verified conversions remain legacy single-unit; no inferred tiles.
Snapshot checksums and operation intent include measurement/price revision, requested area, deliverable pieces, coverage policy and exact pricing unit/value.

## M05 purchase adapter

Input: trusted product/revision and selected supplier/source IDs; pack/Pcs/requested-area entry; selected purchase pricing unit/price; operation ID; expected catalog/lot versions; discounts/rounding contract version.
Server derives whole canonical pieces and exact commercial billing quantity from trusted rows, before constructing the existing M03 atomic posting intent.
Native Purchase/Purchase Item and original supplier obligations retain IDs, physical provenance and amounts. Receipt adds canonical Pcs to the original lot engine once.
Store original entry fields, immutable measurement/unit/price snapshot, exact amount and final minor-unit line amount together with receipt/lot/account effects in ONE SQL-enforced batch.
Guard authorization, product revision, source IDs, idempotency and stock costs within the write boundary; JS preflight is insufficient.
Mixed component price overrides reuse the existing multi-unit purchase pricing path. Return/edit cost allocation uses the recorded original cost basis and deterministic residual-minor-unit allocation.
Tests: mixed pack purchase, Pcs/Sqft price, duplicate receipt, stale config, orphan supplier/lot, concurrent operation, late rollback; actual Workerd/D1.

## M06 sales adapter

Select original product by code/name; expose size, pack and coverage labels with explicit policy. Keep POS keyboard/touch DOM.
Input retains customer's exact selected legacy ID (anonymous cash sale stays party-free), requested area and confirmed physical fulfillment.
Server recomputes canonical Pcs, billing area and selected price. Own/vendor/negative shortages and FIFO consume those Pcs exactly once through the existing engine.
All Sale/Sale Item, FIFO allocations, COGS, tender, due and receipt effects share the reviewed M03 guarded transaction.
Reject changed/stale unit revisions unless the server presents a recalculated proposal for explicit confirmation; do not mutate requested quantity silently.
Stock displays expose equivalent revision-specific Box+Pcs/Sqft, with canonical Pcs.
Tests: loose, mixed pack and Sqft sale, negative/vendor policy, split payment/due, double submit, last-lot race, rollback and exact invoice reconciliation; actual D1.

## M07 returns and corrections adapter

Use the original document-item measurement/unit/price and FIFO allocation snapshots. Never resolve a return using the current catalog revision.
Box+Pcs/Pcs returns require positive whole pieces <= original eligible unreturned quantity.
Area-based returns need a reviewed confirmation policy: proposed safe contract accepts exact whole-piece equivalents; nonintegral area yields a proposal rather than automatically rounding a refund upward. This proposal does not enable a financial policy.
Refund/reversal comes from the original paid/discounted/taxed amounts and recorded tender/Party/lot allocations, never the current product price.
Cumulative return/refund ceilings, original lot restoration/reversal, received-vs-refunded balances and exactly-once receipt are enforced in the shared D1 transaction.
Original 25-piece revision remains applicable after current pack=24. Failure aborts all financial/stock effects.
Tests: full/partial box and loose pieces, historical revisions, partial purchase return, over-return, simultaneous returns, duplicate refund, late rollback; actual D1.
No second return writer is introduced by this contract.

## M09 invoice calculation and print contract

Keep existing printable architecture and SL|P.Code / Barcode|Product Name|Unit|Carton|Qty|Price|Amount.
For area-priced tiles: Unit=Sqft; Carton displays normalized physical pack+loose pieces using the ORIGINAL revision; Qty=effective delivered coverage; Price=selected historical Sqft price.
Preserve requested area separately when it differs. Product name includes size and original code.
The sample's 300.02/100.01 values are a layout reference, never a conversion source.
Existing A4/thermal DOM, pagination and footer remain unchanged until M09's reviewed additive integration.

Proposed versioned NEW-tile calculation policy (not retroactive canonical source money conversion):
1. Internal dimensional, area, price and multiplication calculations use exact rational arithmetic.
2. Display Qty normally uses 2 decimals, half-up; unit price retains the selected exact decimal and sufficient displayed precision to explain the charge.
3. Compute line amount from exact billing quantity × exact price; round once half-up to 2 decimal BDT minor units.
4. Sum final line minor amounts for subtotal. Discount/tax/charges use their separately reviewed existing authoritative transaction rules and order; this contract does not invent those rules.
5. Total tile Sqft aggregates exact areas before rounding once for display; do not sum displayed rounded rows. Group other units separately.
6. Invoice minor amount = rounded lines plus authoritative charge/tax adjustments minus discounts; default additional rounding adjustment is zero.
7. If a separately approved whole-taka settlement policy is selected, persist a signed rounding adjustment as its own amount; do not overwrite subtotal/lines.
8. Print a visible note that amounts use exact coverage when shown quantity is rounded, and show the retained exact calculation detail/extra precision when needed. Expose the delta between displayed Qty×price and authoritative line amount; do not silently recompute from browser text.
9. For 18 boxes, 25 pcs/box, manufacturer box coverage 16.668: exact 300.024 Sqft, display 300.02, price 38, authoritative line=11400.91 BDT; displayed Qty×price=11400.76, disclosed difference=0.15 BDT.
10. For two such lines plus 6 boxes: sum line minor amounts=26602.12 BDT. Never force the sample's total.
Policy needs financial/owner review before adoption by posting or printing. Existing historical monetary values remain unchanged.

Retain existing invoice number/date/customer/reference, staff/store/challan/vehicle where configured; total Qty and Amount, discount/labor/transport/carrying/VAT, rounding adjustment, invoice/received/return amounts, current/previous/total due, amount in words and signature/footer.
The server-authoritative transaction result supplies all printed values. M09 tests original A4/thermal print contracts and arithmetic; the pure contract alone is not print parity.

## Import and source reconciliation

Inventory retains 49 canonical groups; optional supplementary PRODUCT_UNIT_CONVERSIONS is a separate explicitly authorized source profile, not a fabricated 50th canonical group.
For each snapshot preserve source repo/commit/export ID/business identity, group/header sequence, typed original ID, physical source row, original date/time/amount/deleted/audit text and row digest.
Preserve stock lots, costs, native finance gross accounts and opening signs. No added cash event for historical opening.
Dry-run validates exact headers, duplicate IDs/rows, missing references, conflicting manifests and reviewed identity links without DB writes.
Plan/import/readback checks counts and deterministic canonical hashes; do not emit raw private rows in discrepancy logs.
Repeatability means import into two clean local databases yields identical provenance/row counts/hash/account/stock results. Retrying a committed operation yields its stored receipt or a precise conflict, never duplicate stock.
Actual business data stays private and under M10 authorization; no source exports in GitHub/CI.

## Acceptance boundaries

Pure tiles tests cover dimensions/packs, exact ceilings, manufacturer policy, history, overflow/unsafe inputs and exact price/display differences.
They do not prove D1 constraints, importer completeness, transaction concurrency, return refunds or print parity.
Existing local Workerd suites can prove only their exercised existing fixtures.
M02 is not complete until all owner checklist items have separately linked source/schema/import/real-D1/CI evidence.
Exact next M03 task: review and accept the M02 source/Party account/schema contracts, then add awaited product-unit-revision + measurement read adapters behind the existing internal-only boundary, with source-shaped DTOs and real local D1 snapshot consistency; no public RPC activation.
