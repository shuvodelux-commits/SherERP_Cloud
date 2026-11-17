/**
 * Isolated M05 test-only SQL proof: Sqft-entered stock in whole Pcs.
 * The original pure M02 tile contract is the oracle. SQL independently
 * recomputes exact ceil using bounded integer-only fixed-scale values.
 * No REAL, FLOAT, financial authority, migrations, or public handlers.
 */
import {fixed4,decimalWithinFour,inchInteger} from './m05-tile-exact-money-sql.mjs';

const r="json_extract(NEW.request_snapshot_json,'$.requestedSqft')";
const f="json_extract(NEW.request_snapshot_json,'$.fulfillment')";
const mode="json_extract(NEW.request_snapshot_json,'$.mode')";
const bx="json_extract(NEW.request_snapshot_json,'$.boxes')";
const extra="json_extract(NEW.request_snapshot_json,'$.extraPieces')";
const ceil=(n,d)=>"(("+n+"+"+d+"-1)/"+d+")";
const nominalD="(10000*CAST(m.length_text AS INTEGER)*CAST(m.width_text AS INTEGER))";
const nominalN="("+fixed4(r)+"*144)";
const manufacturerD="("+fixed4("m.manufacturer_sqft_per_box_text")+")";
const manufacturerN="("+fixed4(r)+"*m.pieces_per_box)";
const minimum="(CASE "+
 "WHEN m.coverage_policy='nominal' AND m.dimension_unit='in' AND "+
 inchInteger("m.length_text")+" AND "+inchInteger("m.width_text")+
 " THEN "+ceil(nominalN,nominalD)+" "+
 "WHEN m.coverage_policy='manufacturer' AND m.manufacturer_evidence_ref IS NOT NULL AND "+
 decimalWithinFour("m.manufacturer_sqft_per_box_text",100)+" AND "+
 manufacturerD+">0 THEN "+ceil(manufacturerN,manufacturerD)+" "+
 "ELSE NULL END)";
const fulfilled="(CASE WHEN "+f+"='box-only' "+
 "THEN (("+minimum+"+m.pieces_per_box-1)/m.pieces_per_box)*m.pieces_per_box "+
 "ELSE "+minimum+" END)";

export const M05_TILE_EXACT_AREA_GUARD_SQL=
 "AND (("+
 mode+"='pack' AND json_type(NEW.request_snapshot_json,'$.boxes')='text' "+
 "AND json_type(NEW.request_snapshot_json,'$.extraPieces')='text' "+
 "AND "+bx+"=CAST(NEW.boxes AS TEXT) "+
 "AND "+extra+"=CAST(NEW.extra_pieces AS TEXT) "+
 "AND json_type(NEW.request_snapshot_json,'$.requestedSqft') IS NULL "+
 "AND json_type(NEW.request_snapshot_json,'$.fulfillment') IS NULL"+
 ") OR ("+
 mode+"='area' AND json_type(NEW.request_snapshot_json,'$.requestedSqft')='text' "+
 "AND json_type(NEW.request_snapshot_json,'$.fulfillment')='text' "+
 "AND json_type(NEW.request_snapshot_json,'$.boxes') IS NULL "+
 "AND json_type(NEW.request_snapshot_json,'$.extraPieces') IS NULL "+
 "AND "+f+" IN ('loose','box-only') "+
 "AND "+decimalWithinFour(r,1000)+" AND "+fixed4(r)+">0 AND "+fixed4(r)+"<=10000000 "+
 "AND (substr("+r+",1,1)<>'0' OR substr("+r+",2,1)='.') "+
 "AND m.pieces_per_box BETWEEN 1 AND 1000000 "+
 "AND NEW.boxes=(NEW.received_pcs/m.pieces_per_box) "+
 "AND NEW.extra_pieces=(NEW.received_pcs%m.pieces_per_box) "+
 "AND NEW.received_pcs="+fulfilled+
 "))";
