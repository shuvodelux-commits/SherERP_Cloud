import {requireD1Binding} from './d1-binding.js';

// M03 private historical source read. M02's SALES_DRAFT_AUDIT archive is
// descriptive TEXT, not live drafts, a Draft No allocator or a posting writer.
const SOURCE='SALES_DRAFT_AUDIT';
const HEADERS=Object.freeze([
  'Audit ID','Timestamp','Action','Draft ID','Draft No','Version',
  'Actor ID','Actor Name','Source Owner ID','Invoice ID','Note'
]);
const FIELDS=Object.freeze([
  'audit_id','timestamp_text','action','draft_id','draft_no','version_text',
  'actor_id','actor_name','source_owner_id','invoice_id','note'
]);
const ALL=Object.freeze(['legacy_sheet_row',...FIELDS]);
const ACTIONS=new Set([
  'CREATED','UPDATED','DELETED','POSTED','POST_CLEANUP_RETRY'
]);
const SQL_READ='SELECT legacy_sheet_row,audit_id,timestamp_text,action,'+
  'draft_id,draft_no,version_text,actor_id,actor_name,source_owner_id,'+
  'invoice_id,note FROM legacy_sales_draft_audit '+
  'ORDER BY legacy_sheet_row ASC LIMIT ?';
const MAX_ROWS=1000;

function sourceSheet(sheetKey){
  if(sheetKey!==SOURCE)
    throw new TypeError('Unsupported SALES_DRAFT_AUDIT source sheet');
}
function sourceColumn(columnName){
  if(typeof columnName!=='string'||!HEADERS.includes(columnName))
    throw new TypeError('Unsupported SALES_DRAFT_AUDIT source column');
}
const invalid=()=>new Error('Invalid D1 SALES_DRAFT_AUDIT archive result');

/** One fixed SQL, fully awaited and validated before returning any history. */
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
      const fields=Object.getOwnPropertyDescriptors(record);
      const keys=Reflect.ownKeys(fields);
      if(keys.length!==ALL.length||
         keys.some(key=>typeof key!=='string'||!ALL.includes(key))||
         !ALL.every(key=>fields[key]?.enumerable===true &&
           Object.hasOwn(fields[key],'value')))
        throw invalid();
      const rowIndex=fields.legacy_sheet_row.value;
      const auditId=fields.audit_id.value;
      const version=fields.version_text.value;
      if(!Number.isSafeInteger(rowIndex)||rowIndex!==index+2||
         typeof auditId!=='string'||!auditId.trim()||ids.has(auditId)||
         typeof fields.draft_id.value!=='string'||!fields.draft_id.value.trim()||
         typeof fields.draft_no.value!=='string'||!fields.draft_no.value.trim()||
         !ACTIONS.has(fields.action.value)||
         typeof version!=='string'||!/^\d+$/.test(version)||
         !Number.isSafeInteger(Number(version))||Number(version)<1||
         FIELDS.some(key=>typeof fields[key].value!=='string'))
        throw invalid();
      ids.add(auditId);
      const row=Object.fromEntries(HEADERS.map((header,i)=>
        [header,fields[FIELDS[i]].value]));
      row._rowIndex=rowIndex;
      return row;
    });
  }catch{
    // Original actor identities, invoice IDs, notes and D1 errors stay private.
    throw invalid();
  }
}

/**
 * Original Database.gs source-shaped read helpers, restricted to one
 * immutable archive. No public RPC or bypass of M04 authorization.
 */
export function createSalesDraftAuditReadAdapter(env){
  const DB=requireD1Binding(env);
  const getSheetHeaders_=async sheetKey=>{
    sourceSheet(sheetKey);
    return [...HEADERS];
  };
  const getAllRows_=async sheetKey=>{
    sourceSheet(sheetKey);
    return sourceRows(DB);
  };
  const findRows_=async(sheetKey,columnName,value)=>{
    sourceSheet(sheetKey);
    sourceColumn(columnName);
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
