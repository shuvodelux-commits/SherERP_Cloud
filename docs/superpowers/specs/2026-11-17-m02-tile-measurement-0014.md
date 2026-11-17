# M02 tile measurement revision candidate — migration 0014

This is a local-only, inert schema increment. It depends on the existing
0013 catalog and original Product IDs, not a new tile product identity.
The pure Box/Pcs/Sqft contract remains PR #438; no copy is introduced here.

## Persisted contract

`product_tile_measurement_revisions` has primary key `(product_id,revision)`
and restrictive composite FKs to `product_unit_profiles` and the selected
`product_unit_conversions` row. No authoritative stock or balance column.

| Field | SQLite storage / rule |
| --- | --- |
| product_id, revision | Existing product ID and positive safe integer unit-profile revision |
| box_conversion_id | Exact selected conversion in the same product/revision |
| length_text, width_text | Positive canonical decimal TEXT; ≤24 integer and ≤12 fractional digits |
| dimension_unit | in, cm or mm, explicitly selected |
| pieces_per_box | Positive INTEGER ≤9007199254740991; exactly matches the pack factor |
| coverage_policy | nominal or manufacturer; no automatic policy switch |
| manufacturer_sqft_per_box_text | Optional positive canonical decimal TEXT |
| manufacturer_evidence_ref | Required iff manufacturer coverage text is supplied |
| purchase_pricing_unit, selling_pricing_unit | Box, Pcs or Sqft, independently selected |
| purchase_sqft_price_override_text, selling_sqft_price_override_text | Optional canonical nonnegative exact decimal TEXT; explicit zero allowed |
| source_evidence_ref | Nonblank exact evidence identity for this explicitly configured revision |
| created_at_text | Original configuration timestamp text, with no fabricated timezone conversion |

Dimensions, coverage and override values accept only ASCII canonical unsigned
decimal text: no sign/exponent/whitespace/leading zero except 0 or 0.xxx, no
empty fractional part, at most one dot. Positive values require a nonzero
digit. SQLite STRICT may losslessly coerce a bound number into TEXT; future
input mappers must additionally enforce the original string input contract.

Box/Pcs prices remain in existing unit profiles/conversions. Sqft overrides
are area-specific commercial metadata, not another inventory unit or pricing
writer. Actual authoritative totals/discounts/taxes remain under their later
reviewed posting contracts.

## Relationship and history guards

Insert requires the product and profile both to use exact base unit Pcs,
the product not to be a Bundle, and a selected pack conversion in that same
revision. A pack label must differ from base Pcs. The factor must be the
canonical pieces integer or the same integer with 1–12 zero fractional
digits; `25.000000000001` cannot pass as 25 through REAL coercion.
Configured historical/inactive conversion rows remain descriptive evidence;
this table grants no authority to transact with inactive products or units.

All measurement UPDATE/DELETE operations abort. New dimensions, packaging,
commercial policy or prices require a new unit-profile revision. Existing
source transaction snapshots without tile measurements remain legacy data;
do not infer area from new settings, rewrite old quantities or revalue FIFO.

Nominal area is derived exactly from dimensions by the shared rational
contract. Do not store duplicate nominal rational outputs that could disagree
with the dimensions. Manufacturer evidence strings identify supplied
evidence; SQL cannot verify the real manufacturer's claim or owner approval.
Revision activation/sealing and authenticated writers remain M03/M04 gates.

## Verification and scope

Use real local D1 for migration initialization, reference checks, append-only
history, competing duplicate insert and late batch failure rollback. Include
ordinary SQLite tests for full decimal/price constraints and exact readback.
Existing local schema gates must explicitly expect 14 migrations, the new
table and all three new trigger guards. The remote staging migration guard
and deployment workflow stay unchanged and owner-gated.

This schema does not complete all-group offline imports, tenant sharing,
Party accounts, purchases/sales/returns, invoice printing or production
approval. Actual full private-business migration remains M10.
