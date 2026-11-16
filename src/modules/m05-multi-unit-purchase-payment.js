/**
 * INTERNAL M05 READ-ONLY multi-unit purchase + tender preflight.
 *
 * Compose the already approved original source purchase/payment validator
 * with the independent source-backed unit conversion preflight. Nothing in
 * this module authorizes, locks, posts to D1, changes stock/cash/bank/Party
 * accounts, registers an RPC or validates an active Cash Session.
 *
 * Frozen purchase authority: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * Multi-unit calculations: merged PR #313 (sherERP_Mohim source contract).
 *
 * Future M03/M04 posting MUST recompute trusted rows and persist historical
 * unit factors/prices within one SQL-guarded atomic posting boundary.
 */
import {prepareMultiUnitPurchasePreflight} from './m05-multi-unit-purchase-preflight.js';
import {preparePurchasePaymentPreflight} from './m05-purchase-payment-preflight.js';

const monetaryFields=['subtotal','discount','grandTotal','paidAmount','dueAmount'];

function plainRecord(value){
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}

function trustedSnapshot(rows,name,idField){
  if(!Array.isArray(rows))throw new TypeError('Explicit '+name+' snapshot required.');
  const ids=new Set();
  for(const row of rows){
    if(!plainRecord(row))
      throw new TypeError('Invalid trusted '+name+' row or accessor.');
    if(!idField)continue;
    const id=row[idField];
    if(typeof id!=='string' || !id.trim())
      throw new TypeError('Invalid '+name+' source ID.');
    if(ids.has(id))
      throw new Error('Duplicate '+name+' ID in trusted source snapshot: '+id);
    ids.add(id);
  }
}

function trustedPayload(payload){
  if(!plainRecord(payload))throw new TypeError('Explicit purchase payload required.');
  if(!Array.isArray(payload.items))return;
  for(const item of payload.items){
    if(!plainRecord(item))
      throw new TypeError('Invalid purchase payload item or accessor.');
    if(!Array.isArray(item.unitBreakdown))continue;
    for(const component of item.unitBreakdown){
      if(!plainRecord(component))
        throw new TypeError('Invalid purchase payload unit breakdown or accessor.');
    }
  }
}

/**
 * All catalog rows must be already loaded from the same verified tenant.
 * Unit-derived base quantities and prices are recomputed before the original
 * trusted Bank/Mobile/Cash payment resolver sees the effective purchase.
 */
export function prepareMultiUnitPurchasePaymentPreflight(
  payload,{products,suppliers,conversionRows,bankAccounts}={}
){
  trustedSnapshot(products,'product','Product ID');
  trustedSnapshot(suppliers,'supplier','Supplier ID');
  trustedSnapshot(conversionRows,'conversion','Conversion ID');
  trustedSnapshot(bankAccounts,'bank account',null);
  trustedPayload(payload);

  const unitPurchase=prepareMultiUnitPurchasePreflight(
    payload,{products,suppliers,conversionRows}
  );

  // Never pass browser claimed unitPrice/factor/name as the financial truth
  // for a mixed-unit line. The accepted normalized lines are authoritative.
  const normalizedItems=unitPurchase.lines.map(line=>({
    productId:line.productId,name:line.name,qty:line.qty,
    unitPrice:line.price,sellingPrice:line.sellPrice
  }));
  const tender=preparePurchasePaymentPreflight(
    {...payload,items:normalizedItems},
    {products,suppliers,bankAccounts}
  );

  // Both established preflights must agree on their own base-money results;
  // this check does not round or repair the source invoice.
  if(unitPurchase.supplierId!==tender.supplierId ||
    unitPurchase.lines.length!==tender.lines.length ||
    unitPurchase.paymentStatus!==tender.paymentStatus ||
    monetaryFields.some(field=>
      !Number.isFinite(unitPurchase[field]) ||
      !Number.isFinite(tender[field]) ||
      Math.abs(unitPurchase[field]-tender[field])>0.004)){
    throw new Error('NEEDS_REVIEW: unit purchase and tender totals disagree.');
  }

  return {
    ...unitPurchase,
    paymentMethod:tender.paymentMethod,
    bankAccountId:tender.bankAccountId,
    bankAccountName:tender.bankAccountName
  };
}
