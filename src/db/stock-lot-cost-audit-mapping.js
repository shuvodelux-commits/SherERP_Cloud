/** Frozen Config.gs STOCK_LOT_COST_CORRECTIONS columns; no public RPC. */
const columns=Object.freeze({
  'Correction ID':'correction_id',Date:'date_text','Lot ID':'lot_id',
  'Product ID':'product_id','Product Name':'product_name',Source:'source',
  'Old Purchase Price':'old_purchase_price_text',
  'New Purchase Price':'new_purchase_price_text',
  'Original Quantity':'original_quantity_text',
  'Remaining Quantity':'remaining_quantity_text',
  'Matched Historical Quantity':'matched_historical_quantity_text',
  'Affected Invoice Count':'affected_invoice_count_text',
  'Historical COGS Delta':'historical_cogs_delta_text',
  Reason:'reason','Corrected By':'corrected_by','Created At':'created_at_text'
});
export const stockLotCostAuditMapping=Object.freeze({
  table:'legacy_stock_lot_cost_corrections',columns
});
const fields=Object.freeze([...Object.keys(columns),'_rowIndex']);
const numerical=new Set([
  'Old Purchase Price','New Purchase Price','Original Quantity',
  'Remaining Quantity','Matched Historical Quantity',
  'Affected Invoice Count','Historical COGS Delta'
]);
const dates=new Set(['Date','Created At']);
export function verifyStockLotCostAuditMapping(inventory){
  if(!inventory||!Array.isArray(inventory.tables))
    throw new Error('Invalid frozen source inventory');
  const matches=inventory.tables.filter(x=>x?.sheetKey==='STOCK_LOT_COST_CORRECTIONS');
  if(matches.length!==1||
    JSON.stringify(matches[0].columns)!==JSON.stringify(Object.keys(columns)))
    throw new Error('Frozen STOCK_LOT_COST_CORRECTIONS header drift');
  return true;
}
/** No historical recalculation or coercion of source financial strings. */
export function mapStockLotCostAuditRecord(row){
  if(!row||Object.getPrototypeOf(row)!==Object.prototype)
    throw new Error('Invalid STOCK_LOT_COST_CORRECTIONS source row');
  const actual=Reflect.ownKeys(row);
  if(actual.length!==fields.length||
     actual.some(x=>typeof x!=='string'||!fields.includes(x)))
    throw new Error('Invalid STOCK_LOT_COST_CORRECTIONS source fields');
  for(const field of fields){
    const d=Object.getOwnPropertyDescriptor(row,field);
    if(!d||d.enumerable!==true||!Object.hasOwn(d,'value'))
      throw new Error('Invalid source descriptor or accessor');
  }
  if(!Number.isSafeInteger(row._rowIndex)||row._rowIndex<2)
    throw new Error('Invalid source row index');
  for(const field of ['Correction ID','Lot ID','Product ID'])
    if(typeof row[field]!=='string'||!row[field].trim())
      throw new Error('Invalid source audit identity');
  const projected={legacy_sheet_row:row._rowIndex};
  for(const [field,column] of Object.entries(columns)){
    let value=row[field];
    if(dates.has(field)&&value instanceof Date){
      if(!Number.isFinite(value.getTime()))
        throw new Error('Invalid source date');
      value=value.toISOString();
    }else if(numerical.has(field)&&typeof value==='number'){
      if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)
        throw new Error('Invalid source numeric evidence');
      value=String(value);
    }
    if(typeof value!=='string')
      throw new Error('Invalid STOCK_LOT_COST_CORRECTIONS source value');
    projected[column]=value;
  }
  return projected;
}
