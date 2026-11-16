import {requireD1Binding} from './d1-binding.js';

// M03 internal source-history read only. M02's opening balance edit archive
// contains descriptive TEXT, NOT live opening balances or current Cash/Bank.
const SOURCE='OPENING_BALANCE_EDIT_LOG';
const HEADERS=Object.freeze([
  'Audit ID','Changed At','Entity Type','Entity ID','Entity Name',
  'Old Opening Balance','New Opening Balance','Delta',
  'Current Due Before','Current Due After','Reason','Changed By'
]);
const FIELDS=Object.freeze([
  'audit_id','changed_at_text','entity_type','entity_id','entity_name',
  'old_opening_balance_text','new_opening_balance_text','delta_text',
  'current_due_before_text','current_due_after_text','reason','changed_by'
]);
const D1_COLUMNS=Object.freeze(['legacy_sheet_row',...FIELDS]);
const SQL_READ='SELECT legacy_sheet_row,audit_id,changed_at_text,entity_type,entity_id,entity_name,'+
  'old_opening_balance_text,new_opening_balance_text,delta_text,current_due_before_text,'+
  'current_due_after_text,reason,changed_by FROM legacy_opening_balance_edit_audit '+
  'ORDER BY legacy_sheet_row ASC LIMIT ?';
const MAX_ROWS=1000;

function checkSheet(sheetKey){
  if(sheetKey!==SOURCE)throw new TypeError('Unsupported opening balance audit source sheet');
}
function checkColumn(column){
  if(typeof column!=='string'||!HEADERS.includes(column))
    throw new TypeError('Unsupported opening balance audit source column');
}
function invalid(){
  // D1 errors or confidential archived text must never escape this boundary.
  return new Error('Invalid D1 opening balance edit archive result');
}

/**
 * Atomic source-shaped read of a preimported M02 history snapshot.
 * No caching, writes, public dispatch or account-balance calculation.
 */
async function sourceRows(DB){
  try{
    const response=await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all();
    if(response?.success!==true||!Array.isArray(response.results)||
       response.results.length>MAX_ROWS)
      throw invalid();
    const ids=new Set();
    return response.results.map((record,index)=>{
      if(!record||typeof record!=='object'||Array.isArray(record))
        throw invalid();
      const descriptors=Object.getOwnPropertyDescriptors(record);
      const keys=Reflect.ownKeys(descriptors);
      if(keys.length!==D1_COLUMNS.length||
         keys.some(key=>typeof key!=='string'||!D1_COLUMNS.includes(key))||
         !D1_COLUMNS.every(key=>descriptors[key]?.enumerable===true &&
           Object.hasOwn(descriptors[key],'value')))
        throw invalid();

      const rowIndex=descriptors.legacy_sheet_row.value;
      const auditId=descriptors.audit_id.value;
      if(!Number.isSafeInteger(rowIndex)||rowIndex!==index+2||
         typeof auditId!=='string'||!auditId.trim()||ids.has(auditId)||
         typeof descriptors.entity_type.value!=='string'||
         !descriptors.entity_type.value.trim()||
         typeof descriptors.entity_id.value!=='string'||
         !descriptors.entity_id.value.trim()||
         FIELDS.some(key=>typeof descriptors[key].value!=='string'))
        throw invalid();
      ids.add(auditId);
      const row=Object.fromEntries(HEADERS.map((header,i)=>
        [header,descriptors[FIELDS[i]].value]));
      row._rowIndex=rowIndex;
      return row;
    });
  }catch{
    throw invalid();
  }
}

/**
 * The original Database.gs reader method shapes, restricted to one
 * sensitive immutable audit Sheet. A later public API requires M04 RBAC.
 */
export function createOpeningBalanceEditAuditReadAdapter(env){
  const DB=requireD1Binding(env);
  const getSheetHeaders_=async sheetKey=>{
    checkSheet(sheetKey);
    return [...HEADERS];
  };
  const getAllRows_=async sheetKey=>{
    checkSheet(sheetKey);
    return sourceRows(DB);
  };
  const findRows_=async(sheetKey,columnName,value)=>{
    checkSheet(sheetKey);
    checkColumn(columnName);
    const rows=await sourceRows(DB);
    return rows.filter(row=>String(row[columnName])===String(value));
  };
  const findFirstRow_=async(sheetKey,columnName,value)=>{
    const rows=await findRows_(sheetKey,columnName,value);
    return rows[0]??null;
  };
  const findRow_=async(sheetKey,columnName,value)=>{
    const row=await findFirstRow_(sheetKey,columnName,value);
    return row===null?null:{row,rowIndex:row._rowIndex};
  };
  const findRowIndex_=async(sheetKey,columnName,value)=>{
    const found=await findRow_(sheetKey,columnName,value);
    return found===null?-1:found.rowIndex;
  };
  return Object.freeze({
    getSheetHeaders_,getAllRows_,findRows_,findFirstRow_,findRow_,findRowIndex_
  });
}
