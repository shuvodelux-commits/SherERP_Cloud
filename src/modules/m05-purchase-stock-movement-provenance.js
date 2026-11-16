/**
 * M05 INTERNAL source-stock movement provenance audit.
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Purchase.gs::createPurchase,
 * PurchaseManagement.gs::updatePurchaseInternal_,
 * DeleteEngine.gs::deletePurchase.
 *
 * Pure read-only source snapshot audit. No D1, permissions, RPC or writes.
 * Discrepancies require explicit human review; never auto-adjust business
 * data, record extra movements or guess source identities.
 */

const movementTypes=new Set(['Purchase','Purchase Update','Purchase Deleted']);
const tolerance=1e-8;

function plain(value){
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}

function sourceRows(snapshot,key){
  const value=snapshot[key];
  if(!Array.isArray(value))
    throw new TypeError('Explicit trusted '+key+' snapshot array required.');
  if(value.some(row=>!plain(row)))
    throw new TypeError('Invalid trusted '+key+' source row or accessor.');
  return value;
}

function originalId(value){
  if(typeof value==='string')return value.trim();
  if(typeof value==='number' && Number.isFinite(value))return String(value);
  return '';
}

function quantity(value){
  if(value===null || value===undefined || value==='')return 0;
  if(typeof value!=='number' && typeof value!=='string')return null;
  if(typeof value==='string' && !value.trim())return 0;
  const n=Number(value);
  return Number.isFinite(n) && n>=0 ? n : null;
}

function isDeleted(row){
  return String(row['Is Deleted']??'').trim().toUpperCase()==='TRUE';
}

function key(purchaseId,productId){
  return JSON.stringify([purchaseId,productId]);
}

function add(map,id,qty){
  map.set(id,(map.get(id)||0)+qty);
}

/**
 * Independently verifies the signed movement effect attributable to
 * purchase create/edit/delete; Purchase Return has its own reference ID
 * and is deliberately excluded from this equation.
 *
 * The legacy update action replaces Purchase Item rows and posts ONLY
 * delta movements, so a removed item may have zero current rows but
 * must still net to zero from its historical movement stream.
 */
export function auditPurchaseStockMovementProvenance(snapshot){
  if(!plain(snapshot))
    throw new TypeError('Trusted purchase stock movement snapshot required.');
  const purchases=sourceRows(snapshot,'purchases');
  const items=sourceRows(snapshot,'purchaseItems');
  const allMovements=sourceRows(snapshot,'stockMovements');
  const moves=allMovements.filter(row=>movementTypes.has(row.Type));
  const issues=[];
  const issue=(code,details={})=>{issues.push({code,...details});};
  const headers=new Map();
  const perProduct=new Map();
  const seenMovementIds=new Set();
  const initialMovement=new Set();
  const deletionMovement=new Set();

  for(const purchase of purchases){
    const purchaseId=originalId(purchase['Purchase ID']);
    if(!purchaseId){
      issue('MISSING_PURCHASE_ID');
      continue;
    }
    if(headers.has(purchaseId)){
      issue('DUPLICATE_PURCHASE_ID',{purchaseId});
      continue;
    }
    headers.set(purchaseId,{deleted:isDeleted(purchase)});
  }

  const productsByPurchase=new Map();
  const itemQuantities=new Map();
  for(const row of items){
    const purchaseId=originalId(row['Purchase ID']);
    const productId=originalId(row['Product ID']);
    if(!purchaseId)issue('MISSING_PURCHASE_ID',{productId});
    if(!productId)issue('MISSING_PRODUCT_ID',{purchaseId});
    if(!purchaseId || !productId)continue;
    if(!headers.has(purchaseId))
      issue('ORPHAN_PURCHASE_ITEM',{purchaseId,productId});
    const id=key(purchaseId,productId);
    if(productsByPurchase.has(id)){
      issue('DUPLICATE_PURCHASE_PRODUCT',{purchaseId,productId});
      continue;
    }
    productsByPurchase.set(id,true);
    const qty=quantity(row.Quantity);
    if(qty===null || qty<=0){
      issue('INVALID_ITEM_QUANTITY',{purchaseId,productId});
      continue;
    }
    itemQuantities.set(id,qty);
    perProduct.set(id,{purchaseId,productId});
  }

  const movementQuantities=new Map();
  for(const row of moves){
    const movementId=originalId(row['Movement ID']);
    const purchaseId=originalId(row.Reference);
    const productId=originalId(row['Product ID']);
    const details={purchaseId,productId,movementId};
    if(!movementId)issue('MISSING_MOVEMENT_ID',details);
    else if(seenMovementIds.has(movementId))
      issue('DUPLICATE_MOVEMENT_ID',details);
    else seenMovementIds.add(movementId);
    if(!purchaseId)issue('MISSING_PURCHASE_ID',details);
    else if(!headers.has(purchaseId))
      issue('ORPHAN_PURCHASE_MOVEMENT',details);
    if(!productId)issue('MISSING_PRODUCT_ID',details);
    if(!purchaseId || !productId)continue;
    const id=key(purchaseId,productId);
    perProduct.set(id,{purchaseId,productId});
    const input=quantity(row['Quantity In']);
    const output=quantity(row['Quantity Out']);
    if(input===null || output===null){
      issue('INVALID_MOVEMENT_QUANTITY',details);
      continue;
    }
    const directionValid=
      (row.Type==='Purchase' && input>0 && output===0) ||
      (row.Type==='Purchase Deleted' && output>0 && input===0) ||
      (row.Type==='Purchase Update' &&
        ((input>0 && output===0) || (output>0 && input===0)));
    if(!directionValid){
      issue('INVALID_MOVEMENT_DIRECTION',details);
      continue;
    }
    if(row.Type==='Purchase'){
      if(initialMovement.has(id))issue('DUPLICATE_PURCHASE_ORIGIN',details);
      initialMovement.add(id);
    }
    if(row.Type==='Purchase Deleted'){
      if(deletionMovement.has(id))issue('DUPLICATE_PURCHASE_DELETION',details);
      deletionMovement.add(id);
      if(headers.has(purchaseId) && !headers.get(purchaseId).deleted)
        issue('INVALID_PURCHASE_DELETION_STATUS',details);
    }
    add(movementQuantities,id,input-output);
  }

  for(const [id,{purchaseId,productId}] of perProduct){
    const header=headers.get(purchaseId);
    if(!header)continue; // Already reported as orphan.
    const expected=header.deleted ? 0 : (itemQuantities.get(id)||0);
    const actual=movementQuantities.get(id)||0;
    if(!header.deleted && itemQuantities.has(id) &&
       !initialMovement.has(id) && !movementQuantities.has(id)){
      issue('MISSING_PURCHASE_MOVEMENT',{purchaseId,productId});
    }
    if(header.deleted && itemQuantities.has(id) && !deletionMovement.has(id)){
      issue('MISSING_PURCHASE_DELETION',{purchaseId,productId});
    }
    if(!Number.isFinite(actual) || Math.abs(actual-expected)>tolerance){
      issue('QUANTITY_MISMATCH',{purchaseId,productId,expected,actual});
    }
  }

  return {
    ready:issues.length===0,
    issues,
    summary:{
      purchases:purchases.length,
      items:items.length,
      purchaseMovements:moves.length,
      checkedProducts:perProduct.size,
      issueCount:issues.length
    }
  };
}
