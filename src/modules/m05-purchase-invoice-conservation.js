/**
 * M05 INTERNAL, READ-ONLY source Purchase invoice monetary conservation.
 *
 * Frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2:
 * Purchase.gs::createPurchase / PurchaseManagement.gs::updatePurchaseInternal_.
 *
 * Audits the ORIGINAL stored purchase header and line values, including
 * soft-deleted history. Supplier settlements, purchase returns, account
 * balances, stock-lot movements and the true D1 posting boundary are separate
 * proofs. This function never repairs or writes data and is NOT a public RPC.
 */
const TOLERANCE=0.004; // Below one paisa; consistent with original settlement drift gate.

function plainData(row){
  if(row===null || typeof row!=='object' || Array.isArray(row))return false;
  const proto=Object.getPrototypeOf(row);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(row))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}
function identity(value){
  return typeof value==='string' && value.trim()===value && value.length>0;
}
function money(value){
  if(typeof value!=='number' && typeof value!=='string')return null;
  if(typeof value==='string' && value.trim()==='')return null;
  const number=Number(value);
  return Number.isFinite(number) && number>=0 && number<=Number.MAX_SAFE_INTEGER
    ? number : null;
}
function close(actual,expected){
  return Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual-expected)<=TOLERANCE;
}
const deleted=row=>String(row['Is Deleted']??'').toUpperCase()==='TRUE';

/**
 * For explicitly loaded, tenant-scoped original PURCHASES and PURCHASE_ITEMS.
 * The caller is responsible for tenant/auth/source identity provenance; no
 * implicit trust of client-supplied snapshots is permitted.
 */
export function auditPurchaseInvoiceConservation({purchases,purchaseItems}={}){
  if(!Array.isArray(purchases))throw new TypeError('Explicit purchases snapshot required.');
  if(!Array.isArray(purchaseItems))throw new TypeError('Explicit purchase item snapshot required.');
  if(purchases.some(row=>!plainData(row)) ||
     purchaseItems.some(row=>!plainData(row))){
    throw new TypeError('Source snapshot must contain plain data rows without accessors.');
  }

  const issues=[];
  const issue=(code,purchaseId='',productId='')=>{
    issues.push({code,purchaseId,productId});
  };
  const summary={
    purchases:purchases.length,
    items:purchaseItems.length,
    activePurchases:0,
    deletedPurchases:0,
    amountTolerance:TOLERANCE
  };
  if(purchases.length===0)issue('EMPTY_PURCHASE_SNAPSHOT');

  const headers=new Map();
  for(const row of purchases){
    if(deleted(row))summary.deletedPurchases++;
    else summary.activePurchases++;
    const id=row['Purchase ID'];
    if(!identity(id)){
      issue('INVALID_PURCHASE_ID');
      continue;
    }
    if(headers.has(id)){
      issue('DUPLICATE_PURCHASE_ID',id);
      // Mark the identity ambiguous rather than using a first/last match.
      headers.set(id,null);
    }else headers.set(id,row);
  }

  const groups=new Map();
  const seenProducts=new Map();
  for(const row of purchaseItems){
    const id=row['Purchase ID'];
    const productId=row['Product ID'];
    if(!identity(id) || !identity(productId)){
      issue('INVALID_PURCHASE_ITEM',identity(id)?id:'',identity(productId)?productId:'');
      continue;
    }
    if(!headers.has(id))issue('ORPHAN_PURCHASE_ITEM',id,productId);
    if(!groups.has(id))groups.set(id,[]);
    const products=seenProducts.get(id)??new Set();
    if(products.has(productId))issue('DUPLICATE_PRODUCT_LINE',id,productId);
    products.add(productId);
    seenProducts.set(id,products);

    const qty=money(row['Quantity']);
    const cost=money(row['Unit Price']);
    const lineTotal=money(row['Line Total']);
    const expected=qty===null || cost===null ? NaN : qty*cost;
    if(qty===null || qty<=0 || cost===null || lineTotal===null ||
       !Number.isFinite(expected) || expected>Number.MAX_SAFE_INTEGER){
      issue('INVALID_PURCHASE_ITEM',id,productId);
      groups.get(id).push(null);
      continue;
    }
    if(!close(lineTotal,expected))issue('LINE_TOTAL_MISMATCH',id,productId);
    groups.get(id).push(expected);
  }

  for(const [id,row] of headers){
    if(!row)continue; // duplicated original ID; must be manually reconciled.
    const items=groups.get(id)??[];
    if(!items.length){
      issue('MISSING_PURCHASE_ITEMS',id);
      continue;
    }
    const amountKeys=['Subtotal','Discount','Grand Total','Paid Amount','Due Amount'];
    const amountValues=amountKeys.map(field=>money(row[field]));
    if(amountValues.some(value=>value===null)){
      issue('INVALID_PURCHASE_AMOUNT',id);
      continue;
    }
    const [subtotal,discount,grand,paid,due]=amountValues;
    if(items.every(value=>value!==null)){
      const total=items.reduce((sum,value)=>sum+value,0);
      if(!close(subtotal,total))issue('SUBTOTAL_MISMATCH',id);
    }
    if(!close(grand,Math.max(0,subtotal-discount))){
      issue('GRAND_TOTAL_MISMATCH',id);
    }
    if(!close(paid+due,grand) || paid>grand+TOLERANCE){
      issue('PAID_DUE_MISMATCH',id);
    }
    const expectedStatus=due<=0?'Paid':paid>0?'Partial':'Due';
    if(row['Payment Status']!==expectedStatus){
      issue('PAYMENT_STATUS_MISMATCH',id);
    }
  }

  return {ready:issues.length===0,issues,summary};
}
