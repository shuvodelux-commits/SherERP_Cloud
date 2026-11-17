import {requireD1Binding} from './d1-binding.js';

/**
 * M03 Run 2, source-pinned ExpenseSettings.gs# setExpenseCategoryStatus.
 *
 * Private, nonfinancial taxonomy-master only. Never post expenses, cash,
 * inventory, ledger balances or permissions; not a public RPC. The frozen
 * ExpenseSettings.gs never hard-deletes EXPENSE_CATEGORIES. This adapter
 * preserves exactly that historical status-only shape but deliberately
 * requires explicit reviewed Active/Inactive, not the original loose
 * "anything other than Active" client-side deactivation.
 *
 * One SQLite UPDATE atomically proves original source ID + physical Sheet
 * row, full old text preimage, and dense original Sheet row positions.
 * No prior JavaScript SELECT, LockService, cached row or SQL identifier from
 * the caller can race with the status mutation.
 */
const SOURCE_GROUP='EXPENSE_CATEGORIES';
const MAX_ROWS=1000;
const PREIMAGE_FIELDS=Object.freeze([
  'sourceId','name','description','status','createdAt'
]);
const FAIL='NEEDS_REVIEW: unsafe or stale expense category status; update refused';
const SQL=`UPDATE expense_categories
  SET status=?
  WHERE category_id=?
    AND legacy_sheet_row=?
    AND category_name=?
    AND description=?
    AND status=?
    AND created_at=?
    AND EXISTS (
      SELECT 1 FROM (
        SELECT COUNT(*) AS n, COUNT(legacy_sheet_row) AS indexed_count,
          MIN(legacy_sheet_row) AS first_row, MAX(legacy_sheet_row) AS last_row
        FROM expense_categories
      ) AS provenance
      WHERE provenance.n BETWEEN 1 AND ${MAX_ROWS}
        AND provenance.indexed_count=provenance.n
        AND provenance.first_row=2
        AND provenance.last_row=provenance.n+1
    )
  RETURNING legacy_sheet_row,category_id,status`;

function exactOwn(value,expected){
 if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
   throw new TypeError('Invalid expense category status precondition');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 const keys=Reflect.ownKeys(descriptors);
 if(keys.length!==expected.length||keys.some(k=>
    typeof k!=='string'||!expected.includes(k)) ||
    expected.some(k=>descriptors[k]?.enumerable!==true||
      !Object.hasOwn(descriptors[k],'value')))
   throw new TypeError('Invalid expense category status fields or preimage');
 return Object.fromEntries(expected.map(key=>[key,descriptors[key].value]));
}

function checkedInput(sheetKey,sourceRow,fields,old){
 if(sheetKey!==SOURCE_GROUP)throw new TypeError('Unsupported source sheet');
 if(!Number.isSafeInteger(sourceRow)||sourceRow<2||sourceRow>MAX_ROWS+1)
   throw new TypeError('Invalid source physical row index');
 const next=exactOwn(fields,['Status']);
 const previous=exactOwn(old,PREIMAGE_FIELDS);
 if(!['Active','Inactive'].includes(next.Status) ||
    typeof previous.sourceId!=='string'||!previous.sourceId.trim()||
    typeof previous.name!=='string'||!previous.name.trim()||
    typeof previous.description!=='string'||
    !['Active','Inactive',''].includes(previous.status)||
    typeof previous.createdAt!=='string'||
    next.Status===previous.status)
   throw new TypeError('Invalid expense category status or old source preimage');
 return {
   sourceRow,previous,nextStatus:next.Status,
   bindings:[
     next.Status,previous.sourceId,sourceRow,
     previous.name,previous.description,previous.status,previous.createdAt
   ]
 };
}
function verifyReturned(result,expected){
 if(!result||typeof result!=='object'||Array.isArray(result) ||
    ![Object.prototype,null].includes(Object.getPrototypeOf(result)))
   throw new Error(FAIL);
 const descriptors=Object.getOwnPropertyDescriptors(result);
 const fields=['legacy_sheet_row','category_id','status'];
 const keys=Reflect.ownKeys(descriptors);
 if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k))||
    fields.some(k=>descriptors[k]?.enumerable!==true||
      !Object.hasOwn(descriptors[k],'value')) ||
    descriptors.legacy_sheet_row.value!==expected.sourceRow||
    descriptors.category_id.value!==expected.previous.sourceId||
    descriptors.status.value!==expected.nextStatus)
   throw new Error(FAIL);
}

/**
 * A successful result is only an internal, isolated master-data mutation.
 * M04 authenticated expense.edit + reviewed source import must separately
 * gate any future trusted application caller; never attach to public Worker.
 */
export function createGuardedExpenseCategoryStatusAdapter(env){
 const DB=requireD1Binding(env);
 return Object.freeze({
   async updateRowFields_(sheetKey,rowIndex,fields,sourcePreimage){
     const input=checkedInput(sheetKey,rowIndex,fields,sourcePreimage);
     let result;
     try{
       result=await DB.prepare(SQL).bind(...input.bindings).first();
     }catch{
       // D1 exceptions can contain SQL text or provider secrets.
       throw new Error(FAIL);
     }
     verifyReturned(result,input);
     // Legacy Database.gs#updateRowFields_ returns undefined.
   }
 });
}
