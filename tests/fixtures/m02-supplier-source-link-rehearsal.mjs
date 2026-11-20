/**
 * M02 test-only, offline Supplier provenance projection.
 * Does NOT sign off real historical identity, modify application code,
 * authenticate a Shop binding or post Supplier/Cash/Bank transactions.
 * Only synthetic source-shape examples should be supplied to this helper.
 */
const genericError=()=>new Error('Supplier source rehearsal unavailable');
const required=(value)=>typeof value==='string'&&value.trim().length>0;
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const allowedModes=new Set(['NEW_SHOP','HISTORICAL_READBACK']);
const ledgerTypes=new Set(['Purchase','Purchase Return Credit','Payment','Opening Balance']);

function sourceMap(rows,idField,duplicateCode,missingCode,block) {
  const found=new Map(),duplicate=new Set();
  for(const row of rows){
    const id=row[idField];
    if(!required(id)){
      block(missingCode);
      continue;
    }
    if(found.has(id)||duplicate.has(id)){
      duplicate.add(id);
      block(duplicateCode);
      found.delete(id);
    }else found.set(id,row);
  }
  return found;
}
function retired(supplier) {
  return String(supplier.Status??'').trim().toLowerCase()==='inactive'||
    String(supplier['Is Deleted']??'').trim().toUpperCase()==='TRUE';
}
/**
 * Exact, literal source-ID closure. No fallback to name/phone. All inputs
 * are one caller-selected synthetic shop; this is NOT tenant auth proof.
 */
export function reviewSupplierSourceLinks(input) {
  if(!isRecord(input)||!required(input.shopId)||input.shopId.trim()!==input.shopId||
      !allowedModes.has(input.mode))
    throw genericError();
  for(const name of ['suppliers','purchases','returns','supplierLedger']){
    if(!Array.isArray(input[name])||input[name].some(row=>!isRecord(row)))
      throw genericError();
  }
  const errors=new Map();
  const block=code=>errors.set(code,(errors.get(code)||0)+1);
  const suppliers=sourceMap(input.suppliers,'Supplier ID',
    'DUPLICATE_SUPPLIER_SOURCE_ID','SUPPLIER_SOURCE_ID_REQUIRED',block);
  const purchases=sourceMap(input.purchases,'Purchase ID',
    'DUPLICATE_PURCHASE_ID','PURCHASE_ID_REQUIRED',block);
  const returns=sourceMap(input.returns,'Return ID',
    'DUPLICATE_RETURN_ID','RETURN_ID_REQUIRED',block);
  const ledger=sourceMap(input.supplierLedger,'Ledger ID',
    'DUPLICATE_LEDGER_ID','LEDGER_ID_REQUIRED',block);

  for(const purchase of purchases.values()){
    const supplier=suppliers.get(purchase['Supplier ID']);
    if(!supplier){
      block('PURCHASE_SUPPLIER_LINK_MISSING');
      continue;
    }
    if(input.mode==='NEW_SHOP'&&retired(supplier))
      block('PURCHASE_SUPPLIER_INACTIVE_NEW_SHOP');
  }
  for(const returned of returns.values()){
    const purchase=purchases.get(returned['Purchase ID']);
    if(!purchase)block('RETURN_PURCHASE_LINK_MISSING');
    else if(purchase['Supplier ID']!==returned['Supplier ID'])
      block('RETURN_SUPPLIER_MISMATCH');
    if(!suppliers.has(returned['Supplier ID']))
      block('RETURN_SUPPLIER_LINK_MISSING');
  }
  for(const entry of ledger.values()){
    const sid=entry['Supplier ID'];
    if(!suppliers.has(sid))block('LEDGER_SUPPLIER_LINK_MISSING');
    const type=entry.Type;
    if(!ledgerTypes.has(type)){
      block('LEDGER_SOURCE_TYPE_UNREVIEWED');
      continue;
    }
    if(type==='Purchase'){
      const purchase=purchases.get(entry.Reference);
      if(!purchase||purchase['Supplier ID']!==sid)
        block('LEDGER_PURCHASE_REF_INVALID');
    }else if(type==='Purchase Return Credit'){
      const returned=returns.get(entry.Reference);
      if(!returned||returned['Supplier ID']!==sid)
        block('LEDGER_RETURN_REF_INVALID');
    }
    // Payment's legacy Reference='PAYMENT' and Opening Balance's reference
    // are deliberately NOT interpreted as a Purchase/Return ID.
  }
  const blockers=[...errors].sort(([a],[b])=>a.localeCompare(b))
    .map(([code,count])=>({code,count}));
  return {
    readyForReview:blockers.length===0,
    counts:{
      suppliers:input.suppliers.length,
      purchases:input.purchases.length,
      returns:input.returns.length,
      supplierLedger:input.supplierLedger.length
    },
    blockers,
    effects:{cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0}
  };
}
