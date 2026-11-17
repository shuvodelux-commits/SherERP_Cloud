/**
 * M09 source-only Sales Return lineage audit (Issue #431; coordination #456).
 *
 * Frozen Utils.gs::activeSalesReturnItems_ filters children by active
 * SALES_RETURN Return ID, but Reports.gs attributes their economic values
 * using the child's Invoice ID. This checks their original source links
 * before a future M03/M04 report read may trust the derived rows.
 *
 * Pure internal preparation: no D1, RPC, ledger writes or source repair.
 * A complete synthetic audit can NEVER authorize a live report.
 */

function record(value,label){
  try{
    if(!value || typeof value!=='object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value)!==Object.prototype &&
       Object.getPrototypeOf(value)!==null))
      throw new TypeError();
    const result=Object.create(null);
    for(const key of Reflect.ownKeys(value)){
      if(typeof key!=='string')throw new TypeError();
      const d=Object.getOwnPropertyDescriptor(value,key);
      if(!d || !Object.hasOwn(d,'value'))throw new TypeError();
      result[key]=d.value;
    }
    return result;
  }catch{
    throw new TypeError('Invalid trusted M09 '+label+' source record');
  }
}

function rows(snapshot,key){
  const value=snapshot[key];
  if(!Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype)
    throw new TypeError('Missing trusted M09 '+key+' source array');
  const result=[];
  for(let i=0;i<value.length;i++){
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if(!d || !Object.hasOwn(d,'value'))
      throw new TypeError('Incomplete trusted M09 '+key+' source array');
    result.push(record(d.value,key));
  }
  return result;
}

function sourceId(value){
  return typeof value==='string' && value.trim().length>0?value:null;
}
function isDeleted(row){
  const marker=row['Is Deleted'];
  if(marker!==null && marker!==undefined &&
     !['string','boolean','number'].includes(typeof marker))
    throw new TypeError('Invalid trusted M09 deletion marker');
  if(typeof marker==='number' && !Number.isFinite(marker))
    throw new TypeError('Invalid trusted M09 deletion marker');
  // Frozen DeleteEngine.gs::isDeleted_ uses case-insensitive TRUE.
  return marker===true || String(marker||'').toUpperCase()==='TRUE';
}

/**
 * Full source-shaped input (not filtered or permissions-scoped):
 * {allSales:SALES,returnHeaders:SALES_RETURN,returnItems:SALES_RETURN_ITEMS}.
 * Returns only fixed redacted issue codes; no source IDs or financial totals.
 */
export function auditM09SalesReturnLineage(snapshot){
  const data=record(snapshot,'snapshot');
  const sales=rows(data,'allSales');
  const headers=rows(data,'returnHeaders');
  const items=rows(data,'returnItems');
  const issues=new Set();

  const saleCounts=new Map();
  for(const sale of sales){
    if(isDeleted(sale))continue;
    const id=sourceId(sale['Invoice ID']);
    if(!id){
      issues.add('INVALID_SALE_INVOICE_ID');
      continue;
    }
    const count=(saleCounts.get(id)||0)+1;
    saleCounts.set(id,count);
    if(count>1)issues.add('DUPLICATE_ACTIVE_SALE_INVOICE');
  }

  const activeHeaders=new Map(),deletedHeaderIds=new Set();
  for(const header of headers){
    const deleted=isDeleted(header);
    const id=sourceId(header['Return ID']);
    if(deleted){
      if(id)deletedHeaderIds.add(id);
      continue;
    }
    if(!id){
      issues.add('INVALID_RETURN_ID');
      continue;
    }
    const existing=activeHeaders.get(id);
    if(existing){
      issues.add('DUPLICATE_ACTIVE_RETURN_ID');
      continue;
    }
    activeHeaders.set(id,{invoiceId:sourceId(header['Invoice ID']),children:0});
    const invoiceId=sourceId(header['Invoice ID']);
    if(!invoiceId || !saleCounts.has(invoiceId))
      issues.add('MISSING_ACTIVE_SALE_INVOICE');
  }

  for(const child of items){
    if(isDeleted(child))continue;
    const id=sourceId(child['Return ID']);
    if(!id){
      issues.add('INVALID_CHILD_RETURN_ID');
      continue;
    }
    const header=activeHeaders.get(id);
    if(!header){
      // Original activeReturnChildRows_ skips children of deleted headers.
      if(!deletedHeaderIds.has(id))issues.add('ORPHAN_ACTIVE_RETURN_ITEM');
      continue;
    }
    header.children++;
    if(!sourceId(child['Invoice ID']) ||
       child['Invoice ID']!==header.invoiceId)
      issues.add('MISMATCHED_RETURN_INVOICE');
  }

  for(const header of activeHeaders.values())
    if(header.children===0)issues.add('ACTIVE_RETURN_WITHOUT_ITEMS');

  const lineageComplete=issues.size===0;
  return {
    ready:false,
    lineageComplete,
    status:lineageComplete?'SOURCE_LINEAGE_ONLY':'NEEDS_REVIEW',
    issues:[...issues]
  };
}
