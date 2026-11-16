/**
 * M05 INTERNAL Purchase Update form read model.
 * Frozen authority: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * PurchaseManagement.gs::getPurchaseForUpdate, StockLots.gs::lotSellPrice_.
 *
 * Caller MUST enforce source-equivalent purchase.edit and tenant scope
 * before collecting trusted snapshots. This helper grants no permission.
 * Any actual update MUST recheck returns, lots, stock and financial effects
 * within M03's DB-enforced atomic/idempotent posting boundary.
 */
function plain(value) {
  if (!value || typeof value!=='object' || Array.isArray(value))
    return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}

function rows(snapshot,key) {
  const records=snapshot[key];
  if (!Array.isArray(records))
    throw new TypeError('Explicit trusted '+key+' snapshot array required.');
  for(const record of records){
    if(!plain(record))
      throw new TypeError('Untrusted '+key+' row or accessor.');
  }
  return records;
}

function nonNegative(value,label,{positive=false}={}) {
  const numeric=Number(value);
  if ((value!==null && value!==undefined &&
       typeof value!=='number' && typeof value!=='string') ||
      !Number.isFinite(numeric) || numeric<0 || (positive && numeric<=0))
    throw new TypeError('Invalid '+label+' in Purchase Update snapshot.');
  return numeric;
}

function canonicalDate(value) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new TypeError('Purchase Update needs a canonical YYYY-MM-DD date.');
  const parsed=new Date(value+'T00:00:00.000Z');
  if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value)
    throw new TypeError('Invalid Purchase Update date in source snapshot.');
  return value;
}

const deleted=row=>String(row['Is Deleted']??'').trim().toUpperCase()==='TRUE';

function existingId(value,label){
  if((typeof value!=='string' || !value.trim()) &&
     (typeof value!=='number' || !Number.isFinite(value)))
    throw new Error('Missing '+label+' ID in Purchase Update snapshot.');
  return value;
}

function lotSellPrice(lot,product) {
  // Pinned StockLots.gs::lotSellPrice_: only blank/null/undefined or
  // invalid stored value falls back to the product, then zero.
  const raw=lot ? lot['Sell Price'] : '';
  if(raw!=='' && raw!==null && raw!==undefined &&
     Number.isFinite(Number(raw)) && Number(raw)>=0)
    return Number(raw);
  const fallback=product ? product['Selling Price'] : 0;
  return Number.isFinite(Number(fallback)) && Number(fallback)>=0
    ? Number(fallback) : 0;
}

/**
 * Source-shaped getPurchaseForUpdate.data, not the GAS success envelope.
 * Duplicate source IDs fail closed instead of the GAS first/last-row
 * selection that could show a price from the wrong historical stock lot.
 */
export function projectPurchaseForUpdate(purchaseId,snapshot) {
  existingId(purchaseId,'requested purchase');
  if(!plain(snapshot))
    throw new TypeError('Trusted Purchase Update snapshot required.');
  const purchases=rows(snapshot,'purchases');
  const items=rows(snapshot,'items');
  const products=rows(snapshot,'products');
  const lots=rows(snapshot,'lots');
  const returns=rows(snapshot,'returns');

  const candidates=purchases.filter(row=>row['Purchase ID']===purchaseId);
  if(candidates.length>1)
    throw new Error('Duplicate purchase ID detected: '+purchaseId);
  const purchase=candidates[0];
  if(!purchase)throw new Error('Purchase not found.');
  if(deleted(purchase))throw new Error('This purchase has been deleted.');
  if(returns.some(row=>!deleted(row) && row['Purchase ID']===purchaseId))
    throw new Error('This purchase has Purchase Return records and can no longer be updated. Use Purchase Return for further corrections.');

  const date=canonicalDate(purchase.Date);
  const discount=nonNegative(purchase.Discount,'discount');
  const paidAmount=nonNegative(purchase['Paid Amount'],'paid amount');

  const productById=new Map();
  for(const row of products) {
    const id=row['Product ID'];
    if(productById.has(id))
      throw new Error('Duplicate product ID detected in Purchase Update snapshot: '+id);
    productById.set(id,row);
  }

  const matchingLots=new Map();
  for(const row of lots) {
    if(row['Purchase ID']!==purchaseId)continue;
    const productId=existingId(row['Product ID'],'stock lot product');
    if(matchingLots.has(productId))
      throw new Error('Multiple stock lots for one purchase product: '+productId);
    matchingLots.set(productId,row);
  }

  const purchaseItems=items.filter(row=>row['Purchase ID']===purchaseId);
  if(!purchaseItems.length)
    throw new Error('No purchase item lines available for update.');
  const seenItems=new Set();
  const lineItems=purchaseItems.map(row=>{
    const productId=existingId(row['Product ID'],'product');
    if(seenItems.has(productId))
      throw new Error('Duplicate product line in Purchase Update source: '+productId);
    seenItems.add(productId);
    const qty=nonNegative(row.Quantity,'quantity',{positive:true});
    const unitPrice=nonNegative(row['Unit Price'],'unit price');
    const rawSell=row['Sell Price'];
    const sellingPrice=rawSell!=='' && rawSell!==undefined && rawSell!==null
      ? nonNegative(rawSell,'selling price')
      : lotSellPrice(matchingLots.get(productId),productById.get(productId));
    return {
      productId:row['Product ID'],name:row['Product Name'],
      qty,unitPrice,sellingPrice
    };
  });

  return {
    purchaseId:purchase['Purchase ID'],date,
    supplierId:purchase['Supplier ID'],supplierName:purchase['Supplier Name'],
    discount,paidAmount,
    paymentMethod:purchase['Payment Method']||(paidAmount>0?'Cash':''),
    bankAccountId:purchase['Bank Account ID']||'',
    notes:purchase.Notes||'',
    items:lineItems
  };
}
