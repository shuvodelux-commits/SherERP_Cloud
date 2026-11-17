-- M02-14: inert tile configuration; no inventory or financial writer.
-- Source dimensions/coverage/prices remain exact TEXT. Derived nominal area
-- is deliberately not duplicated as another authoritative stored value.
-- Existing product IDs and immutable unit revisions are the only parents.
CREATE TABLE product_tile_measurement_revisions (
  product_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  box_conversion_id TEXT NOT NULL
    CHECK (length(box_conversion_id) BETWEEN 1 AND 256
      AND box_conversion_id=trim(box_conversion_id)
      AND box_conversion_id<>'BASE'),
  length_text TEXT NOT NULL CHECK (
      length(length_text) BETWEEN 1 AND 37
      AND length_text NOT GLOB '*[^0-9.]*'
      AND length(length_text)-length(replace(length_text,'.','')) <= 1
      AND (substr(length_text,1,1) BETWEEN '1' AND '9' OR length_text='0' OR substr(length_text,1,2)='0.')
      AND ((instr(length_text,'.')=0 AND length(length_text)<=24) OR (instr(length_text,'.') BETWEEN 2 AND 25 AND length(length_text)-instr(length_text,'.') BETWEEN 1 AND 12))
      AND length_text GLOB '*[1-9]*'
    ),
  width_text TEXT NOT NULL CHECK (
      length(width_text) BETWEEN 1 AND 37
      AND width_text NOT GLOB '*[^0-9.]*'
      AND length(width_text)-length(replace(width_text,'.','')) <= 1
      AND (substr(width_text,1,1) BETWEEN '1' AND '9' OR width_text='0' OR substr(width_text,1,2)='0.')
      AND ((instr(width_text,'.')=0 AND length(width_text)<=24) OR (instr(width_text,'.') BETWEEN 2 AND 25 AND length(width_text)-instr(width_text,'.') BETWEEN 1 AND 12))
      AND width_text GLOB '*[1-9]*'
    ),
  dimension_unit TEXT NOT NULL CHECK (dimension_unit IN ('in','cm','mm')),
  pieces_per_box INTEGER NOT NULL
    CHECK (pieces_per_box > 0 AND pieces_per_box <= 9007199254740991),
  coverage_policy TEXT NOT NULL CHECK (coverage_policy IN ('nominal','manufacturer')),
  manufacturer_sqft_per_box_text TEXT CHECK (manufacturer_sqft_per_box_text IS NULL OR (
      length(manufacturer_sqft_per_box_text) BETWEEN 1 AND 37
      AND manufacturer_sqft_per_box_text NOT GLOB '*[^0-9.]*'
      AND length(manufacturer_sqft_per_box_text)-length(replace(manufacturer_sqft_per_box_text,'.','')) <= 1
      AND (substr(manufacturer_sqft_per_box_text,1,1) BETWEEN '1' AND '9' OR manufacturer_sqft_per_box_text='0' OR substr(manufacturer_sqft_per_box_text,1,2)='0.')
      AND ((instr(manufacturer_sqft_per_box_text,'.')=0 AND length(manufacturer_sqft_per_box_text)<=24) OR (instr(manufacturer_sqft_per_box_text,'.') BETWEEN 2 AND 25 AND length(manufacturer_sqft_per_box_text)-instr(manufacturer_sqft_per_box_text,'.') BETWEEN 1 AND 12))
      AND manufacturer_sqft_per_box_text GLOB '*[1-9]*'
    )),
  manufacturer_evidence_ref TEXT,
  purchase_pricing_unit TEXT NOT NULL CHECK (purchase_pricing_unit IN ('Box','Pcs','Sqft')),
  selling_pricing_unit TEXT NOT NULL CHECK (selling_pricing_unit IN ('Box','Pcs','Sqft')),
  purchase_sqft_price_override_text TEXT CHECK (purchase_sqft_price_override_text IS NULL OR (
      length(purchase_sqft_price_override_text) BETWEEN 1 AND 37
      AND purchase_sqft_price_override_text NOT GLOB '*[^0-9.]*'
      AND length(purchase_sqft_price_override_text)-length(replace(purchase_sqft_price_override_text,'.','')) <= 1
      AND (substr(purchase_sqft_price_override_text,1,1) BETWEEN '1' AND '9' OR purchase_sqft_price_override_text='0' OR substr(purchase_sqft_price_override_text,1,2)='0.')
      AND ((instr(purchase_sqft_price_override_text,'.')=0 AND length(purchase_sqft_price_override_text)<=24) OR (instr(purchase_sqft_price_override_text,'.') BETWEEN 2 AND 25 AND length(purchase_sqft_price_override_text)-instr(purchase_sqft_price_override_text,'.') BETWEEN 1 AND 12))
    )),
  selling_sqft_price_override_text TEXT CHECK (selling_sqft_price_override_text IS NULL OR (
      length(selling_sqft_price_override_text) BETWEEN 1 AND 37
      AND selling_sqft_price_override_text NOT GLOB '*[^0-9.]*'
      AND length(selling_sqft_price_override_text)-length(replace(selling_sqft_price_override_text,'.','')) <= 1
      AND (substr(selling_sqft_price_override_text,1,1) BETWEEN '1' AND '9' OR selling_sqft_price_override_text='0' OR substr(selling_sqft_price_override_text,1,2)='0.')
      AND ((instr(selling_sqft_price_override_text,'.')=0 AND length(selling_sqft_price_override_text)<=24) OR (instr(selling_sqft_price_override_text,'.') BETWEEN 2 AND 25 AND length(selling_sqft_price_override_text)-instr(selling_sqft_price_override_text,'.') BETWEEN 1 AND 12))
    )),
  source_evidence_ref TEXT NOT NULL
    CHECK (length(source_evidence_ref) BETWEEN 1 AND 256
      AND source_evidence_ref=trim(source_evidence_ref)),
  created_at_text TEXT NOT NULL CHECK (length(trim(created_at_text))>0),
  PRIMARY KEY (product_id,revision),
  FOREIGN KEY (product_id,revision)
    REFERENCES product_unit_profiles(product_id,revision) ON DELETE RESTRICT,
  FOREIGN KEY (product_id,revision,box_conversion_id)
    REFERENCES product_unit_conversions(product_id,revision,conversion_id) ON DELETE RESTRICT,
  CHECK (
    (manufacturer_sqft_per_box_text IS NULL AND manufacturer_evidence_ref IS NULL)
    OR (manufacturer_sqft_per_box_text IS NOT NULL
      AND manufacturer_evidence_ref IS NOT NULL
      AND length(manufacturer_evidence_ref) BETWEEN 1 AND 256
      AND manufacturer_evidence_ref=trim(manufacturer_evidence_ref))
  ),
  CHECK (coverage_policy<>'manufacturer' OR manufacturer_sqft_per_box_text IS NOT NULL)
) STRICT;

-- A text/integer comparison is intentional. REAL could equate a fractional
-- near-integer such as 25.000000000001 with a pack after rounding. Accept only
-- the same integer or its exact 1-12 zero fractional-digit representation.
CREATE TRIGGER trg_tile_measurement_parent_pack_guard
  BEFORE INSERT ON product_tile_measurement_revisions
  BEGIN
    SELECT RAISE(ABORT,'tile product revision or pack mismatch')
    WHERE NOT EXISTS (
      SELECT 1 FROM products p
      JOIN product_unit_profiles u ON u.product_id=p.product_id
      JOIN product_unit_conversions c
        ON c.product_id=u.product_id AND c.revision=u.revision
      WHERE p.product_id=NEW.product_id
        AND u.revision=NEW.revision
        AND p.base_unit_name='Pcs' AND u.stock_unit_name='Pcs'
        AND p.product_type_text<>'Bundle'
        AND c.conversion_id=NEW.box_conversion_id
        AND lower(trim(c.unit_name))<>'pcs'
        AND (
          c.factor_text=CAST(NEW.pieces_per_box AS TEXT)
          OR (
            substr(c.factor_text,1,length(CAST(NEW.pieces_per_box AS TEXT))+1)
              =CAST(NEW.pieces_per_box AS TEXT)||'.'
            AND length(c.factor_text)-length(CAST(NEW.pieces_per_box AS TEXT))-1 BETWEEN 1 AND 12
            AND substr(c.factor_text,length(CAST(NEW.pieces_per_box AS TEXT))+2) NOT GLOB '*[^0]*'
          )
        )
    );
  END;
CREATE TRIGGER trg_tile_measurement_immutable_update
  BEFORE UPDATE ON product_tile_measurement_revisions
  BEGIN SELECT RAISE(ABORT,'immutable tile measurement revision'); END;
CREATE TRIGGER trg_tile_measurement_immutable_delete
  BEFORE DELETE ON product_tile_measurement_revisions
  BEGIN SELECT RAISE(ABORT,'immutable tile measurement revision'); END;
