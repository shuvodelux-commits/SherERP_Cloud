/**
 * M09 internal, source-only Purchase Return lineage audit (Issue #431).
 *
 * Frozen Utils.gs::activePurchaseReturnItems_ filters children by an active
 * PURCHASE_RETURN Return ID. Reports.gs::getPurchaseReport attributes the
 * economic amount by CHILD Purchase ID. Mismatched IDs need human review.
 *
 * No D1, RPC, SQL, customer data, finance totals, posting or source repair.
 * A complete synthetic review NEVER authorizes live financial reporting.
 */
function trustedRecord(value,label){
  try{
    if(!value || typeof value!=='object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value)!==Object.prototype &&
       Object.getPrototypeOf(value)!==null))
      throw new TypeError();
    const output=Object.create(null);
    for(const name of Reflect.ownKeys(value)){
      if(typeof name!=='string')throw new TypeError();
      const descriptor=Object.getOwnPropertyDescriptor(value,name);
      if(!descriptor || !Object.hasOwn(descriptor,'value'))throw new TypeError();
      output[name]=descriptor.value;
    }
    return output;
  }catch{
    throw new TypeError('Invalid trusted M09 '+label+' source record');
  }
}
function sourceRows(root,key){
  const array=root[key];
  if(!Array.isArray(array) || Object.getPrototypeOf(array)!==Array.prototype)
    throw new TypeError('Missing trusted M09 '+key+' source array');
  const rows=[];
  for(let i=0;i<array.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(array,String(i));
    if(!descriptor || !Object.hasOwn(descriptor,'value'))
      throw new TypeError('Incomplete trusted M09 '+key+' source array');
    rows.push(trustedRecord(descriptor.value,key));
  }
  return rows;
}
function sourceId(value){
  return typeof value==='string' && value.trim()?value:null;
}
function sourceDeleted(row){
  const value=row['Is Deleted'];
  if(value!==undefined && value!==null &&
    !['string','boolean','number'].includes(typeof value))
    throw new TypeError('Invalid trusted M09 deletion marker');
  if(typeof value==='number' && !Number.isFinite(value))
    throw new TypeError('Invalid trusted M09 deletion marker');
  // Preserve frozen DeleteEngine.gs::isDeleted_ including mixed-case TRUE.
  return value===true || String(value||'').toUpperCase()==='TRUE';
}

/**
 * Input is complete source-shaped historical rows (including soft-deleted
 * purchase/return records), not already filtered live report data.
 *
 * Only fixed codes leave this function; source IDs never leave this module.
 */
export function auditM09PurchaseReturnLineage(snapshot){
  const root=trustedRecord(snapshot,'snapshot');
  const purchases=sourceRows(root,'allPurchases');
  const headers=sourceRows(root,'returnHeaders');
  const items=sourceRows(root,'returnItems');
  const issues=new Set();
  const activePurchases=new Map();

  for(const purchase of purchases){
    if(sourceDeleted(purchase))continue;
    const purchaseId=sourceId(purchase['Purchase ID']);
    if(!purchaseId){
      issues.add('INVALID_PURCHASE_ID');
      continue;
    }
    const count=(activePurchases.get(purchaseId)||0)+1;
    activePurchases.set(purchaseId,count);
    if(count>1)issues.add('DUPLICATE_ACTIVE_PURCHASE_ID');
  }

  const activeHeaders=new Map(),deletedIds=new Set();
  for(const header of headers){
    const deleted=sourceDeleted(header),returnId=sourceId(header['Return ID']);
    if(deleted){
      if(returnId)deletedIds.add(returnId);
      continue;
    }
    if(!returnId){
      issues.add('INVALID_RETURN_ID');
      continue;
    }
    if(activeHeaders.has(returnId)){
      issues.add('DUPLICATE_ACTIVE_RETURN_ID');
      continue;
    }
    const purchaseId=sourceId(header['Purchase ID']);
    activeHeaders.set(returnId,{purchaseId,activeChildren:0});
    if(!purchaseId || !activePurchases.has(purchaseId))
      issues.add('MISSING_ACTIVE_PURCHASE');
  }

  for(const item of items){
    if(sourceDeleted(item))continue;
    const returnId=sourceId(item['Return ID']);
    if(!returnId){
      issues.add('INVALID_CHILD_RETURN_ID');
      continue;
    }
    const parent=activeHeaders.get(returnId);
    if(!parent){
      // Frozen source excludes children of a deleted parent Return ID.
      if(!deletedIds.has(returnId))issues.add('ORPHAN_ACTIVE_RETURN_ITEM');
      continue;
    }
    parent.activeChildren++;
    const purchaseId=sourceId(item['Purchase ID']);
    if(!purchaseId || purchaseId!==parent.purchaseId)
      issues.add('MISMATCHED_RETURN_PURCHASE');
  }

  for(const parent of activeHeaders.values())
    if(parent.activeChildren===0)issues.add('ACTIVE_RETURN_WITHOUT_ITEMS');

  const lineageComplete=issues.size===0;
  return {
    ready:false,
    lineageComplete,
    status:lineageComplete?'SOURCE_LINEAGE_ONLY':'NEEDS_REVIEW',
    issues:[...issues]
  };
}
