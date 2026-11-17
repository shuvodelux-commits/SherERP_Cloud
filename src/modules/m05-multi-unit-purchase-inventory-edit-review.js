/**
 * M05 INTERNAL READ-ONLY Purchase Update inventory review.
 *
 * Preserves frozen Mohim_ERP PurchaseManagement.gs stock/lot safeguards and
 * the separately approved optional multi-unit source quantity/pricing port.
 * No Purchase update, SQL, RPC, cash, supplier account, lot or source write.
 *
 * This is a *preflight-only* eligibility assessment on trusted source-shaped
 * tenant snapshots. M03/M04/M07 still own authorization and SQL-atomic edit,
 * dated cash/bank/supplier financial effects, CAS, exactly-once replay and
 * historical unit-price/factor snapshot persistence.
 */
import {prepareMultiUnitPurchasePreflight}
  from './m05-multi-unit-purchase-preflight.js';
import {auditMultiUnitPurchaseSnapshot}
  from './m05-purchase-unit-snapshot-conservation.js';
import {planPurchaseInventoryEdit}
  from './purchase-correction-guards.js';

function plain(value){
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value))
      .every(d=>Object.hasOwn(d,'value'));
}

function originalId(id){
  return typeof id==='string' && id.trim()===id && id.length>0;
}

function rows(value,name,idColumn){
  if(!Array.isArray(value))
    throw new TypeError('Explicit trusted '+name+' snapshot array required.');
  const ids=new Set();
  for(const row of value){
    if(!plain(row))
      throw new TypeError('Invalid trusted '+name+' row or accessor.');
    if(idColumn){
      const id=row[idColumn];
      if(!originalId(id))
        throw new TypeError('Invalid '+name+' source ID.');
      if(ids.has(id))
        throw new Error('Duplicate '+name+' ID in trusted snapshot: '+id);
      ids.add(id);
    }
  }
}

function checkPayload(payload){
  if(!plain(payload))throw new TypeError('Trusted purchase edit payload required.');
  if(!Array.isArray(payload.items))
    throw new TypeError('Trusted purchase edit payload items array required.');
  for(const item of payload.items){
    if(!plain(item))
      throw new TypeError('Invalid payload item or accessor.');
    if(item.unitBreakdown===undefined || item.unitBreakdown===null)continue;
    if(!Array.isArray(item.unitBreakdown))
      throw new TypeError('Invalid payload unit breakdown array.');
    for(const unit of item.unitBreakdown){
      if(!plain(unit))
        throw new TypeError('Invalid payload unit breakdown accessor.');
    }
  }
}

/**
 * Compose the original stock edit guard with authoritative source-backed
 * optional multi-unit normalization. Financial, settlement and date edits
 * require separate privileged review; this function never executes them.
 */
export function reviewMultiUnitPurchaseInventoryEdit(
  purchaseId,payload,snapshot={}
){
  if(!originalId(purchaseId))
    throw new TypeError('Original purchase ID is required.');
  if(!plain(snapshot))
    throw new TypeError('Trusted purchase edit snapshot required.');

  rows(snapshot.products,'product','Product ID');
  rows(snapshot.suppliers,'supplier','Supplier ID');
  rows(snapshot.conversionRows,'conversion','Conversion ID');
  rows(snapshot.purchases,'purchase','Purchase ID');
  rows(snapshot.items,'item',null);
  rows(snapshot.lots,'lot',null);
  rows(snapshot.returns,'return',null);
  checkPayload(payload);

  const purchaseRow=snapshot.purchases.find(p=>p['Purchase ID']===purchaseId);
  if(!purchaseRow)
    throw new Error('Purchase not found.');
  // Supplier reassignment may have later Supplier Settlement, Credit or
  // historical Party debt. The existing inventory guard cannot prove the
  // financial transfer, so never represent that edit as eligible.
  if(purchaseRow['Supplier ID']!==payload.supplierId){
    // Let the original source supplier validator report inactive/missing
    // supplier first; then report this unsupported financial reassignment.
    const candidate=prepareMultiUnitPurchasePreflight(
      payload,{products:snapshot.products,suppliers:snapshot.suppliers,
        conversionRows:snapshot.conversionRows}
    );
    if(candidate.supplierId!==purchaseRow['Supplier ID'])
      throw new Error('Supplier reassignment requires separate financial-settlement review.');
  }

  const purchase=prepareMultiUnitPurchasePreflight(payload,{
    products:snapshot.products,
    suppliers:snapshot.suppliers,
    conversionRows:snapshot.conversionRows
  });

  // Fail closed on malformed/mismatched unit snapshot arithmetic; never
  // reinterpret it using the present product/convertible unit catalog.
  const conservation=auditMultiUnitPurchaseSnapshot(purchase);
  if(!conservation.ready){
    throw new Error('NEEDS_REVIEW: multi-unit purchase snapshot arithmetic mismatch.');
  }

  const proposedLines=purchase.lines.map(line=>({
    productId:line.productId,name:line.name,qty:line.qty,
    unitPrice:line.price,sellingPrice:line.sellPrice
  }));
  const inventory=planPurchaseInventoryEdit(purchaseId,{
    purchases:snapshot.purchases,
    items:snapshot.items,
    lots:snapshot.lots,
    products:snapshot.products,
    returns:snapshot.returns
  },proposedLines);

  return {purchase,inventory,mode:'preflight-only'};
}
