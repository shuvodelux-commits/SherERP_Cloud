import {mapStockLotCostAuditRecord} from './stock-lot-cost-audit-mapping.js';

// Internal, fixed-schema, fresh-target offline snapshot import ONLY.
// Not a Writer for live lot pricing, COGS or invoice accounting.
const MAX_ROWS=1000;
const fields=['legacy_sheet_row','correction_id','date_text','lot_id','product_id',
 'product_name','source','old_purchase_price_text','new_purchase_price_text',
 'original_quantity_text','remaining_quantity_text','matched_historical_quantity_text',
 'affected_invoice_count_text','historical_cogs_delta_text','reason','corrected_by',
 'created_at_text'];
const sentinel='INSERT INTO legacy_stock_lot_cost_corrections(correction_id) SELECT NULL WHERE EXISTS (SELECT 1 FROM legacy_stock_lot_cost_corrections)';
const insert='INSERT INTO legacy_stock_lot_cost_corrections(legacy_sheet_row,correction_id,date_text,lot_id,product_id,product_name,source,old_purchase_price_text,new_purchase_price_text,original_quantity_text,remaining_quantity_text,matched_historical_quantity_text,affected_invoice_count_text,historical_cogs_delta_text,reason,corrected_by,created_at_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
const read='SELECT legacy_sheet_row,correction_id,date_text,lot_id,product_id,product_name,source,old_purchase_price_text,new_purchase_price_text,original_quantity_text,remaining_quantity_text,matched_historical_quantity_text,affected_invoice_count_text,historical_cogs_delta_text,reason,corrected_by,created_at_text FROM legacy_stock_lot_cost_corrections ORDER BY legacy_sheet_row ASC LIMIT ?';

export function prepareSourceStockLotCostAudit(sourceRows){
 if(!Array.isArray(sourceRows)||sourceRows.length<1||sourceRows.length>MAX_ROWS)
   throw new Error('Invalid source STOCK_LOT_COST_CORRECTIONS row count');
 const seen=new Set();
 return sourceRows.map((row,index)=>{
   let projected;
   try{projected=mapStockLotCostAuditRecord(row);}
   catch{throw new Error('Invalid source STOCK_LOT_COST_CORRECTIONS row or field');}
   if(projected.legacy_sheet_row!==index+2)
     throw new Error('Invalid source STOCK_LOT_COST_CORRECTIONS order');
   if(seen.has(projected.correction_id))
     throw new Error('Duplicate source Correction ID');
   seen.add(projected.correction_id);
   return projected;
 });
}
export async function importSourceStockLotCostAuditWithD1({DB,sourceRows}={}){
 const rows=prepareSourceStockLotCostAudit(sourceRows);
 if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
   throw new Error('D1 stock lot cost audit import binding missing');
 try{
   const result=await DB.batch([
     DB.prepare(sentinel),
     ...rows.map(row=>DB.prepare(insert).bind(...fields.map(key=>row[key])))
   ]);
   if(!Array.isArray(result)||result.length!==rows.length+1||
      result.some(x=>x?.success!==true))throw new Error('Invalid batch response');
 }catch{throw new Error('D1 STOCK_LOT_COST_CORRECTIONS import failed; target must be empty');}
 let actual;
 try{
   const r=await DB.prepare(read).bind(MAX_ROWS+1).all();
   if(r?.success!==true||!Array.isArray(r.results))
     throw new Error('Invalid postcommit readback');
   actual=r.results;
 }catch{throw new Error('NEEDS_REVIEW: STOCK_LOT_COST_CORRECTIONS readback unavailable after commit');}
 if(actual.length!==rows.length||actual.some((record,i)=>
    !record||Object.keys(record).length!==fields.length||
    fields.some(key=>record[key]!==rows[i][key])))
   throw new Error('NEEDS_REVIEW: STOCK_LOT_COST_CORRECTIONS readback mismatch after commit');
 return {sourceGroup:'STOCK_LOT_COST_CORRECTIONS',importedRows:rows.length,reconciled:true};
}
