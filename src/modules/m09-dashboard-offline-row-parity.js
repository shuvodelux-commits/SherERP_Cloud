/**
 * M09 offline source-vs-imported row identity proof (issues #431 and #567).
 *
 * These are explicitly normalized, reviewed synthetic/source candidate rows.
 * The caller owns original Sheets source snapshots and sourceId/digest proof.
 * This is NOT a D1 query, importer, signature verifier, source data repair,
 * financial calculation, authenticated read or public RPC authorization.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * All issue codes are fixed: no source ID, financial value or row data leaves.
 */

const GROUPS=Object.freeze([
  'SALES','SALES_RETURN','SALES_RETURN_ITEMS','CUSTOMERS',
  'CUSTOMER_LEDGER','SUPPLIERS','SUPPLIER_LEDGER','FINANCE_TRANSACTIONS'
]);
const UNIQUE_SOURCE_IDS=new Set(['SALES','SALES_RETURN','CUSTOMERS','SUPPLIERS']);
const FINANCE_KINDS=Object.freeze({
  CUSTOMER_LEDGER:new Set(['CUSTOMER_AR','CUSTOMER_ADVANCE']),
  SUPPLIER_LEDGER:new Set(['SUPPLIER_AP','SUPPLIER_ADVANCE']),
  FINANCE_TRANSACTIONS:new Set([
    'OWNER_EQUITY','LENDER_LOAN_AP','BORROWER_LOAN_AR'
  ])
});
const MAX_ROWS_PER_GROUP=50000;
const FINGERPRINT=/^[a-f0-9]{64}$/;
const SIGNED_MINOR=/^(?:0|[1-9]\d*|-[1-9]\d*)$/;

function plain(raw){
  if(raw===null || typeof raw!=='object' || Array.isArray(raw))return false;
  try{
    const proto=Object.getPrototypeOf(raw);
    return proto===Object.prototype || proto===null;
  }catch{return false;}
}

// Every field is read as its own DATA descriptor, never through a getter.
function own(record,key){
  const d=Object.getOwnPropertyDescriptor(record,key);
  return d && Object.hasOwn(d,'value')
    ? {valid:true,value:d.value}:{valid:false};
}
function rootInput(input){
  try{
    if(!plain(input))throw new TypeError();
    const a=own(input,'sourceGroups'),b=own(input,'importedGroups');
    if(!a.valid || !b.valid ||
       !plain(a.value) || !plain(b.value))throw new TypeError();
    return {sourceGroups:a.value,importedGroups:b.value};
  }catch{
    throw new TypeError('Invalid trusted M09 offline row parity input');
  }
}
function stringId(value){
  return typeof value==='string' && value.trim().length>0;
}
function requiredFields(group){
  const base=['ordinal','id','deleted','fingerprint'];
  if(group==='SALES_RETURN')return [...base,'invoiceId'];
  if(group==='SALES_RETURN_ITEMS')return [...base,'returnId','invoiceId'];
  if(Object.hasOwn(FINANCE_KINDS,group))
    return [...base,'accountKind','accountSourceId','signedMinor'];
  return base;
}
function validRow(record,group){
  try{
    if(!plain(record))return false;
    const fields=requiredFields(group);
    const keys=Reflect.ownKeys(record);
    if(keys.length!==fields.length ||
       keys.some(key=>typeof key!=='string' || !fields.includes(key)))
      return false;
    const values=Object.create(null);
    for(const key of fields){
      const d=own(record,key);
      if(!d.valid)return false;
      values[key]=d.value;
    }
    if(!Number.isSafeInteger(values.ordinal) || values.ordinal<1 ||
       typeof values.deleted!=='boolean' ||
       typeof values.fingerprint!=='string' ||
       !FINGERPRINT.test(values.fingerprint))return false;
    if(values.id!==null && !stringId(values.id))return false;
    if(values.id===null && UNIQUE_SOURCE_IDS.has(group))return false;
    if(group==='SALES_RETURN' && !stringId(values.invoiceId))return false;
    if(group==='SALES_RETURN_ITEMS' &&
      (!stringId(values.returnId) || !stringId(values.invoiceId)))
      return false;
    if(Object.hasOwn(FINANCE_KINDS,group) &&
       (!FINANCE_KINDS[group].has(values.accountKind) ||
        !stringId(values.accountSourceId) ||
        typeof values.signedMinor!=='string' ||
        !SIGNED_MINOR.test(values.signedMinor)))
      return false;
    return true;
  }catch{return false;}
}

function groupRecords(raw,group){
  if(!Array.isArray(raw) || Object.getPrototypeOf(raw)!==Array.prototype ||
     raw.length>MAX_ROWS_PER_GROUP)return null;
  const descriptors=Object.getOwnPropertyDescriptors(raw);
  const keys=Reflect.ownKeys(descriptors);
  if(keys.length!==raw.length+1 || keys.some(key=>
    typeof key!=='string' ||
    (key!=='length' &&
      (!/^(0|[1-9]\d*)$/.test(key) || Number(key)>=raw.length))))
    return null;
  const rows=[];
  for(let i=0;i<raw.length;i++){
    const slot=descriptors[String(i)];
    if(!slot || !Object.hasOwn(slot,'value') ||
       !validRow(slot.value,group))return null;
    rows.push(slot.value);
  }
  return rows;
}
function add(issues,code){issues.add(code);}
function scanSide(root,group,side,issues){
  const suffix=side==='source'?'SOURCE':'IMPORTED';
  const record=own(root,group);
  if(!record.valid){
    add(issues,Object.hasOwn(root,group)
      ?'INVALID_'+suffix+'_GROUP':'MISSING_'+suffix+'_GROUP');
    return null;
  }
  let rows;
  try{rows=groupRecords(record.value,group);}
  catch{rows=null;}
  if(!rows){
    add(issues,'INVALID_'+suffix+'_ROWS');
    return null;
  }
  const ordinals=new Set(),seenIds=new Set();
  for(const row of rows){
    if(ordinals.has(row.ordinal))
      add(issues,'DUPLICATE_'+suffix+'_ORDINAL');
    ordinals.add(row.ordinal);
    if(UNIQUE_SOURCE_IDS.has(group)){
      const id=row.id.trim();
      if(seenIds.has(id))add(issues,'AMBIGUOUS_HISTORICAL_'+suffix+'_ID');
      seenIds.add(id);
    }
  }
  return rows;
}
function compareRowGroups(group,source,imported,issues){
  if(!source || !imported)return;
  if(source.length!==imported.length)add(issues,'ROW_COUNT_MISMATCH');
  const fromSource=new Map(source.map(row=>[row.ordinal,row]));
  const fromImport=new Map(imported.map(row=>[row.ordinal,row]));
  for(const row of source){
    const importedRow=fromImport.get(row.ordinal);
    if(!importedRow){
      add(issues,'MISSING_IMPORTED_ROWS');
      continue;
    }
    if(row.id!==importedRow.id)add(issues,'SOURCE_ID_DRIFT');
    if(row.deleted!==importedRow.deleted)add(issues,'DELETION_STATE_DRIFT');
    if(row.fingerprint!==importedRow.fingerprint)
      add(issues,'SOURCE_PAYLOAD_DRIFT');
    if(group==='SALES_RETURN' && row.invoiceId!==importedRow.invoiceId)
      add(issues,'RETURN_LINK_DRIFT');
    if(group==='SALES_RETURN_ITEMS' &&
       (row.returnId!==importedRow.returnId ||
        row.invoiceId!==importedRow.invoiceId))
      add(issues,'RETURN_LINK_DRIFT');
    if(Object.hasOwn(FINANCE_KINDS,group)){
      if(row.accountKind!==importedRow.accountKind)
        add(issues,'PARTY_ACCOUNT_KIND_DRIFT');
      if(row.accountSourceId!==importedRow.accountSourceId)
        add(issues,'PARTY_SOURCE_LINK_DRIFT');
      if(row.signedMinor!==importedRow.signedMinor)
        add(issues,'SIGNED_AMOUNT_DRIFT');
    }
  }
  for(const row of imported)
    if(!fromSource.has(row.ordinal))add(issues,'EXTRA_IMPORTED_ROWS');
}
function validateReturnAncestry(side,groups,issues){
  const prefix=side==='source'?'SOURCE':'IMPORTED';
  const sales=groups.SALES,returns=groups.SALES_RETURN,
    items=groups.SALES_RETURN_ITEMS;
  if(!sales || !returns || !items)return;
  const activeSales=new Set(sales.filter(row=>!row.deleted).map(row=>row.id));
  const returnById=new Map(returns.map(row=>[row.id,row]));
  for(const header of returns)
    if(!header.deleted && !activeSales.has(header.invoiceId))
      add(issues.SALES_RETURN,prefix+'_ORPHAN_ACTIVE_RETURN_PARENT');
  for(const item of items){
    if(item.deleted)continue;
    const header=returnById.get(item.returnId);
    if(!header){
      add(issues.SALES_RETURN_ITEMS,prefix+'_ORPHAN_ACTIVE_RETURN_ITEM');
      continue;
    }
    // The pinned source excludes children of deleted Return headers from
    // active economic totals but retains full physical source history.
    if(header.deleted)continue;
    if(header.invoiceId!==item.invoiceId)
      add(issues.SALES_RETURN_ITEMS,prefix+'_RETURN_INVOICE_MISMATCH');
  }
}

// Link ledgers to historical original masters on *each* side independently.
// Soft-deleted masters remain valid provenance for prior ledger entries.
function validateAccountAncestry(side,groups,issues){
  const prefix=side==='source'?'SOURCE':'IMPORTED';
  for(const [master,ledger] of [
    ['CUSTOMERS','CUSTOMER_LEDGER'],['SUPPLIERS','SUPPLIER_LEDGER']
  ]){
    if(!groups[master] || !groups[ledger])continue;
    const sourceIds=new Set(groups[master].map(row=>row.id));
    for(const entry of groups[ledger])
      if(!sourceIds.has(entry.accountSourceId))
        add(issues[ledger],prefix+'_ORPHAN_ACCOUNT_LINK');
  }
}

/**
 * Input: {sourceGroups:{SALES:[...], ...},
 *         importedGroups:{SALES:[...], ...}}
 *
 * Each array is a separately normalized physical source/imported snapshot:
 * {ordinal:<positive integer source row>, id:<original ID or null>,
 *  deleted:<normalized original deletion flag>,fingerprint:<sha256 hex>}.
 * Return groups also carry invoiceId/returnId. Finance/Party ledgers carry
 * accountKind, accountSourceId, signedMinor (exact canonical decimal integer).
 *
 * Hashes and currency conversions MUST be independently reviewed upstream;
 * caller-provided matching digests do not prove authenticity. Never pass
 * actual customer/ledger data to a public client. Output is redacted and
 * ready:false regardless of apparent matching source/import snapshots.
 */
export function auditM09DashboardOfflineRowParity(input){
  const {sourceGroups,importedGroups}=rootInput(input);
  const scans=Object.create(null),issues=Object.create(null);
  for(const group of GROUPS){
    const found=new Set();
    const source=scanSide(sourceGroups,group,'source',found);
    const imported=scanSide(importedGroups,group,'imported',found);
    compareRowGroups(group,source,imported,found);
    scans[group]={source,imported};
    issues[group]=found;
  }
  for(const side of ['source','imported']){
    const selections=Object.create(null);
    for(const group of GROUPS)selections[group]=scans[group][side];
    validateReturnAncestry(side,selections,issues);
    validateAccountAncestry(side,selections,issues);
  }
  const groups=GROUPS.map(key=>{
    const issueCodes=[...issues[key]];
    const evidenceComplete=issueCodes.length===0;
    return Object.freeze({
      key,ready:false,evidenceComplete,
      status:evidenceComplete?'ROW_PARITY_ONLY_NOT_AUTHORIZED':'NEEDS_REVIEW',
      issues:Object.freeze(issueCodes)
    });
  });
  const evidenceComplete=groups.every(x=>x.evidenceComplete);
  return Object.freeze({
    ready:false,
    evidenceComplete,
    status:evidenceComplete?'ROW_PARITY_ONLY_NOT_AUTHORIZED':'NEEDS_REVIEW',
    groups:Object.freeze(groups)
  });
}
