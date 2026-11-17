/**
 * Test-only reviewed bounded integer SQL amount conservation.
 * Fixed scale: BDT price/box coverage x10^4; never CAST to REAL.
 * 100000 Pcs, <=1000 quoted unit price and <=100 coverage keep all
 * intermediate multiplication below signed SQLite 64-bit range.
 * Unsupported high precision / non-inch nominal sizes fail closed.
 * SQL identifier fragments are code-owned constants, never caller input.
 */
function fixed4(column){
 return "CAST((CASE WHEN instr("+column+",'.')=0 THEN "+column+"||'0000' ELSE substr("+column+",1,instr("+column+",'.')-1)||substr("+column+",instr("+column+",'.')+1)||substr('0000',1,4-(length("+column+")-instr("+column+",'.'))) END) AS INTEGER)";
}

function decimalWithinFour(column,max){
 return "(typeof("+column+")='text' AND "+column+"=trim("+column+") AND "+column+" GLOB '[0-9]*' AND "+column+" NOT GLOB '*[^0-9.]*' AND (length("+column+")-length(replace("+column+",'.','')))<=1 AND (instr("+column+",'.')=0 OR (instr("+column+",'.')>1 AND length("+column+")-instr("+column+",'.') BETWEEN 1 AND 4)) AND length("+column+")<=12 AND CAST("+column+" AS INTEGER) BETWEEN 0 AND "+max+")";
}

function inchInteger(column){
 return "(typeof("+column+")='text' AND "+column+" GLOB '[1-9]*' AND "+column+" NOT GLOB '*[^0-9]*' AND length("+column+")<=3 AND CAST("+column+" AS INTEGER) BETWEEN 1 AND 120)";
}

function halfUp(numerator,denominator){
 return "CAST((("+numerator+")+(("+denominator+")/2))/("+denominator+") AS INTEGER)";
}

function buildMoneyGuard(){
 const pieces="NEW.received_pcs",price=fixed4("NEW.unit_price_text");
 const pcsAmount=halfUp(pieces+"*"+price,"100");
 const boxAmount=halfUp(pieces+"*"+price,"m.pieces_per_box*100");
 const nominalAmount=halfUp(pieces+"*CAST(m.length_text AS INTEGER)*CAST(m.width_text AS INTEGER)*"+price,"14400");
 const manufacturerAmount=halfUp(pieces+"*"+fixed4("m.manufacturer_sqft_per_box_text")+"*"+price,"m.pieces_per_box*1000000");
 return "AND NEW.received_pcs BETWEEN 1 AND 100000 "+
  "AND "+decimalWithinFour("NEW.unit_price_text",1000)+" "+
  "AND ( "+
  "(NEW.pricing_unit='Pcs' AND NEW.line_amount_paisa="+pcsAmount+") "+
  "OR (NEW.pricing_unit='Box' AND NEW.line_amount_paisa="+boxAmount+") "+
  "OR (NEW.pricing_unit='Sqft' AND ( "+
   "(m.coverage_policy='nominal' AND m.dimension_unit='in' AND "+
     inchInteger("m.length_text")+" AND "+inchInteger("m.width_text")+
     " AND NEW.line_amount_paisa="+nominalAmount+") "+
   "OR (m.coverage_policy='manufacturer' AND m.manufacturer_evidence_ref IS NOT NULL "+
    "AND "+decimalWithinFour("m.manufacturer_sqft_per_box_text",100)+
    " AND "+fixed4("m.manufacturer_sqft_per_box_text")+">0 "+
    "AND NEW.line_amount_paisa="+manufacturerAmount+") "+
  ")) )";
}

export const M05_TILE_EXACT_MONEY_GUARD_SQL=buildMoneyGuard();

export {fixed4,decimalWithinFour,inchInteger};
