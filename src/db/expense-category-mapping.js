/** M02 source-pinned EXPENSE_CATEGORIES only; no D1 importer, writes or RPC. */
const columns=Object.freeze({
  'Category ID':'category_id',
  'Category Name':'category_name',
  'Description':'description',
  'Status':'status',
  'Created At':'created_at'
});
export const expenseCategoryMapping=Object.freeze({
  table:'expense_categories',columns
});

/** Changing Config.gs headers requires a reviewed schema and importer decision. */
export function verifyExpenseCategoryMapping(inventory){
  if(!inventory||!Array.isArray(inventory.tables))
    throw new Error('Invalid source inventory');
  const matches=inventory.tables.filter(x=>x?.sheetKey==='EXPENSE_CATEGORIES');
  if(matches.length!==1)throw new Error('Missing or duplicated EXPENSE_CATEGORIES source group');
  if(JSON.stringify(matches[0].columns)!==JSON.stringify(Object.keys(columns)))
    throw new Error('EXPENSE_CATEGORIES source headers changed');
  return true;
}
function asText(key,v){
  if(v===null||v===undefined)return '';
  if(v instanceof Date){
    if(!Number.isFinite(v.getTime()))throw new Error('Invalid date for '+key);
    return v.toISOString();
  }
  if(typeof v==='string')return v;
  if(typeof v==='number'&&Number.isFinite(v))return String(v);
  if(typeof v==='boolean')return v?'true':'false';
  throw new Error('Unsupported EXPENSE_CATEGORIES field '+key);
}

/** Pure, read-only projection; callers must separately preflight completeness. */
export function mapExpenseCategoryRecord(sourceRow){
  if(!sourceRow||Object.getPrototypeOf(sourceRow)!==Object.prototype)
    throw new Error('Invalid EXPENSE_CATEGORIES source row');
  const mapped={};
  for(const key of Reflect.ownKeys(sourceRow)){
    if(typeof key!=='string')throw new Error('Invalid EXPENSE_CATEGORIES field');
    const desc=Object.getOwnPropertyDescriptor(sourceRow,key);
    if(!desc||!Object.hasOwn(desc,'value'))
      throw new Error('Accessor fields forbidden in EXPENSE_CATEGORIES');
    if(key==='_rowIndex'){
      if(!Number.isSafeInteger(desc.value)||desc.value<2)
        throw new Error('Invalid EXPENSE_CATEGORIES original row');
      mapped.legacy_sheet_row=desc.value;
    }else if(Object.hasOwn(columns,key)){
      mapped[columns[key]]=asText(key,desc.value);
    }else throw new Error('Unexpected EXPENSE_CATEGORIES source field');
  }
  return mapped;
}
