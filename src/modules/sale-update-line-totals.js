/**
 * M06 source-faithful Sales Update line total preflight — PURE, NO WRITES.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * SalesManagement.gs::saleUpdateLineTotal_ / updateSaleInternal_.
 *
 * M03/M04 MUST obtain source rows from the proper tenant and authorize the
 * actor independently. This does not establish invoice editability, reserve
 * stock, validate Cash Session, settle Party balances or post/update a sale.
 * A future writer MUST revalidate against the DB-enforced atomic boundary.
 */
const plain=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);

function trustedRow(row){
  if(!plain(row) ||
    Object.values(Object.getOwnPropertyDescriptors(row))
      .some(desc=>!Object.hasOwn(desc,'value'))){
    throw new TypeError('Expected trusted plain Sales line row without accessors.');
  }
  return row;
}
const roundMoney=value=>{
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
};
const oldNumber=value=>Number(value)||0;

function exactLineTotal(oldItem,qty,unitPrice){
  if(oldItem){
    const oldQty=oldNumber(oldItem['Quantity']);
    const oldPrice=oldNumber(oldItem['Unit Price']);
    const saved=oldItem['Line Total'];
    const number=Number(saved);
    if(Math.abs(oldQty-qty)<1e-9 &&
       Math.abs(oldPrice-unitPrice)<1e-9 &&
       saved!=='' && saved!==null && saved!==undefined &&
       Number.isFinite(number) && number>=0){
      return number;
    }
  }
  return roundMoney(qty*unitPrice);
}

/**
 * Preview the original per-Product-ID edit pricing and subtotal only.
 * Historical duplicates use the FIRST original SALE_ITEMS line per product,
 * as the frozen updateSaleInternal_ does. No source rows are changed.
 */
export function planSaleUpdateLineTotals(invoiceId,oldItems,newItems){
  if(typeof invoiceId!=='string'||!invoiceId.trim())
    throw new TypeError('An exact source invoice ID is required.');
  if(!Array.isArray(oldItems)||!Array.isArray(newItems))
    throw new TypeError('Trusted old Sales items and proposed edit items are required.');
  const historical=new Map();
  for(const row of oldItems){
    trustedRow(row);
    if(row['Invoice ID']!==invoiceId)continue;
    const id=row['Product ID'];
    if(!historical.has(id))historical.set(id,row);
  }
  const seen=new Set(),lines=[];
  let subtotal=0;
  for(const row of newItems){
    trustedRow(row);
    const id=row.productId;
    if(typeof id!=='string'||!id.trim())
      throw new TypeError('Each proposed sale line needs a Product ID.');
    if(seen.has(id))throw new Error('Duplicate Product ID in proposed Sale Update; combine into one line.');
    seen.add(id);
    const qty=Number(row.qty),unitPrice=Number(row.unitPrice);
    if(!Number.isFinite(qty)||qty<=0)
      throw new TypeError('Sale Update line quantity must be positive and finite.');
    if(!Number.isFinite(unitPrice)||unitPrice<0)
      throw new TypeError('Sale Update line price must be nonnegative and finite.');
    const lineTotal=exactLineTotal(historical.get(id),qty,unitPrice);
    if(!Number.isFinite(lineTotal))
      throw new RangeError('Sale Update line money overflow.');
    subtotal=roundMoney(subtotal+lineTotal);
    if(!Number.isFinite(subtotal))
      throw new RangeError('Sale Update subtotal money overflow.');
    lines.push({productId:id,qty,unitPrice,lineTotal});
  }
  return {subtotal,lines};
}
