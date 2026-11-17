import {requireD1Binding} from './d1-binding.js';

/**
 * M03 Run 2, source-pinned ExpenseSettings.gs#updateExpenseCategory.
 *
 * PRIVATE nonfinancial taxonomy master only; no public RPC, auth grant,
 * expense posting, cash or bank write. The original GAS handler trims the
 * new name + description and rejects any OTHER original source category
 * whose stored name has the same JavaScript toLowerCase() value.
 *
 * SQLite's built-in NOCASE/LOWER is ASCII-only and cannot implement that
 * frozen JavaScript Unicode rule. We therefore inspect a bounded, fully
 * awaited original-ID/physical-row snapshot for Unicode duplicates, then
 * prove the ENTIRE reviewed snapshot still matches in one SQL UPDATE.
 * Any rename, insert, delete, status change, row-position change, or even
 * description update between the read and UPDATE rejects the write.
 *
 * The verified name/description UPDATE is one SQL statement, not a fake
 * LockService, uncoupled SELECT+UPDATE or JavaScript-held transaction.
 */
const MAX_ROWS=1000;
const SOURCE='EXPENSE_CATEGORIES';
const PREIMAGE_KEYS=Object.freeze([
  'sourceId','name','description','status','createdAt'
]);
const ROW_KEYS=Object.freeze([
  'legacy_sheet_row','category_id','category_name',
  'description','status','created_at'
]);
const FAIL='NEEDS_REVIEW: unsafe or stale expense category edit; update refused';
const SELECT='SELECT legacy_sheet_row,category_id,category_name,description,status,created_at '+
  'FROM expense_categories ORDER BY legacy_sheet_row ASC LIMIT ?';

// Only static reviewed identifiers. Snapshot arrays are produced from
// validated D1 rows, never from client-provided SQL identifiers or JSON.
const UPDATE=`UPDATE expense_categories
  SET category_name=?, description=?
  WHERE category_id=?
    AND legacy_sheet_row=?
    AND category_name=?
    AND description=?
    AND status=?
    AND created_at=?
    AND (SELECT COUNT(*) FROM expense_categories)=json_array_length(?)
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) AS snapshot
      LEFT JOIN expense_categories AS actual
        ON actual.legacy_sheet_row=json_extract(snapshot.value,'$[0]')
      WHERE actual.row_id IS NULL
         OR actual.category_id IS NOT json_extract(snapshot.value,'$[1]')
         OR actual.category_name IS NOT json_extract(snapshot.value,'$[2]')
         OR actual.description IS NOT json_extract(snapshot.value,'$[3]')
         OR actual.status IS NOT json_extract(snapshot.value,'$[4]')
         OR actual.created_at IS NOT json_extract(snapshot.value,'$[5]')
    )
  RETURNING legacy_sheet_row,category_id,category_name,description`;

function ownRecord(value,keys){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Invalid expense category preimage or fields');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const ownKeys=Reflect.ownKeys(descriptors);
  if(ownKeys.length!==keys.length||
     ownKeys.some(key=>typeof key!=='string'||!keys.includes(key))||
     keys.some(key=>descriptors[key]?.enumerable!==true||
       !Object.hasOwn(descriptors[key],'value')))
    throw new TypeError('Invalid expense category source fields');
  return Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
}
function validateInput(sheetKey,rowIndex,fields,preimage){
  if(sheetKey!==SOURCE)throw new TypeError('Unsupported expense category source sheet');
  if(!Number.isSafeInteger(rowIndex)||rowIndex<2||rowIndex>MAX_ROWS+1)
    throw new TypeError('Invalid original expense category row position');
  const requested=ownRecord(fields,['Category Name','Description']);
  const old=ownRecord(preimage,PREIMAGE_KEYS);
  if(typeof requested['Category Name']!=='string'||
     typeof requested.Description!=='string')
    throw new TypeError('Invalid expense category name or description');
  const name=requested['Category Name'].trim();
  const description=requested.Description.trim();
  if(!name||typeof old.sourceId!=='string'||!old.sourceId.trim()||
     typeof old.name!=='string'||!old.name.trim()||
     typeof old.description!=='string'||
     !['Active','Inactive',''].includes(old.status)||
     typeof old.createdAt!=='string')
    throw new TypeError('Invalid expense category name or source preimage');
  return {rowIndex,old,name,description};
}
function verifiedSnapshot(response){
  if(response?.success!==true||!Array.isArray(response.results)||
     response.results.length<1||response.results.length>MAX_ROWS)
    throw new Error(FAIL);
  const ids=new Set();
  return response.results.map((candidate,index)=>{
    const row=ownRecord(candidate,ROW_KEYS);
    if(row.legacy_sheet_row!==index+2||
       typeof row.category_id!=='string'||!row.category_id.trim()||
       typeof row.category_name!=='string'||!row.category_name.trim()||
       typeof row.description!=='string'||
       !['Active','Inactive',''].includes(row.status)||
       typeof row.created_at!=='string'||
       ids.has(row.category_id))
      throw new Error(FAIL);
    ids.add(row.category_id);
    return row;
  });
}
function matchesOriginal(row,old){
  return row.category_id===old.sourceId &&
    row.category_name===old.name &&
    row.description===old.description &&
    row.status===old.status &&
    row.created_at===old.createdAt;
}
function verifiedReturn(value,input){
  let row;
  try{row=ownRecord(value,['legacy_sheet_row','category_id','category_name','description']);}
  catch{throw new Error(FAIL);}
  if(row.legacy_sheet_row!==input.rowIndex||
     row.category_id!==input.old.sourceId||
     row.category_name!==input.name||
     row.description!==input.description)
    throw new Error(FAIL);
}

/**
 * Source-compatible name+description updateRowFields_ only.
 * The old source is locked during each update; in D1 the single UPDATE's
 * verified snapshot guard provides SQL-level compare-and-set isolation.
 * A successful mutation returns undefined, as Database.gs does.
 * Never expose this method to client-supplied fnName without M04 auth.
 */
export function createGuardedExpenseCategoryTextUpdateAdapter(env){
  const DB=requireD1Binding(env);
  return Object.freeze({
    async updateRowFields_(sheetKey,rowIndex,fields,sourcePreimage){
      const input=validateInput(sheetKey,rowIndex,fields,sourcePreimage);
      let all;
      try{
        const response=await DB.prepare(SELECT).bind(MAX_ROWS+1).all();
        all=verifiedSnapshot(response);
      }catch{
        throw new Error(FAIL);
      }
      const at=all.find(item=>item.legacy_sheet_row===input.rowIndex);
      if(!at||!matchesOriginal(at,input.old))throw new Error(FAIL);
      const wanted=input.name.toLowerCase();
      if(all.some(row=>row.category_id!==input.old.sourceId &&
         row.category_name.toLowerCase()===wanted))
        throw new Error('A category with this name already exists.');
      // Whole-table CAS: a stale JS duplicate check cannot approve a
      // concurrent insert/rename that changes the source name set.
      const snapshot=JSON.stringify(all.map(row=>[
        row.legacy_sheet_row,row.category_id,row.category_name,
        row.description,row.status,row.created_at
      ]));
      let result;
      try{
        result=await DB.prepare(UPDATE).bind(
          input.name,input.description,
          input.old.sourceId,input.rowIndex,
          input.old.name,input.old.description,
          input.old.status,input.old.createdAt,
          snapshot,snapshot
        ).first();
      }catch{
        // Never propagate SQL, source names, or provider credentials.
        throw new Error(FAIL);
      }
      verifiedReturn(result,input);
      // This is a private master-data edit, NOT a public RPC response.
    }
  });
}
