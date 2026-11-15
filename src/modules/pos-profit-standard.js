/**
 * M06: internal, read-only Standard-product POS invoice profit estimate.
 *
 * Adapted from frozen Sales.gs::estimatePosInvoiceProfit_. Source-FIFO lot
 * pricing and sourcing are reused from M05 verbatim, not reimplemented.
 *
 * WARNING: profit exposes sensitive purchase costs. The future caller MUST
 * authorize pos.view AND canViewInvoiceProfit_ BEFORE reading products/lots.
 * This module has no D1 access, RPC, UI path, current-user lookup or writes.
 * Bundle component COGS requires an approved combined demand planner; reject
 * bundles here instead of reporting potentially wrong profit.
 */
import {
  isValidNonNegativeNumber_,roundMoney_,planStockConsumption_,
  planSaleVendorConsumption_,computePlanSellingPrice_
} from './stock-fifo-planning.js';

const record=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);

/**
 * @param {object} payload - source-shaped POS payload with items and discount
 * @param {{productsById: object, stockLots: object[]}} snapshot
 *   trusted and already-authorized M03/M05 source-shaped snapshot
 */
export function estimateStandardPosInvoiceProfit(payload,snapshot){
  if(!record(snapshot) || !record(snapshot.productsById) ||
    !Array.isArray(snapshot.stockLots)){
    throw new TypeError('Missing trusted POS profit product/stock snapshot');
  }
  payload=payload||{};
  const items=payload.items;
  if(!Array.isArray(items) || !items.length)throw new Error('Cart is empty.');
  if(items.length>200)throw new Error('Too many POS lines for a single preview.');

  const seen=Object.create(null);
  let subtotal=0,cogs=0,costComplete=true;

  items.forEach((item,i)=>{
    const productId=String(item && item.productId || '');
    const qty=Number(item && item.qty);
    const product=snapshot.productsById[productId];
    if(!product || !productId || seen[productId]){
      throw new Error('Invalid or duplicate POS item: '+(productId||String(i+1)));
    }
    seen[productId]=true;
    if(!isValidNonNegativeNumber_(qty) || qty<=0){
      throw new Error('Line '+(i+1)+': enter a positive quantity.');
    }
    const type=String(product['Product Type']||'').trim();
    if(type && type!=='Standard'){
      throw new Error('Bundle or unsupported product type: profit preview requires approved component planning.');
    }
    const vendorId=String(item.vendorId||'').trim();
    const plan=vendorId
      ? planSaleVendorConsumption_(productId,qty,snapshot.stockLots,product)
      : planStockConsumption_(productId,qty,snapshot.stockLots,product);

    let lineTotal;
    if(item.priceMode==='auto'){
      lineTotal=computePlanSellingPrice_(plan,qty).lineTotal;
    }else if(item.priceMode==='fixed' && isValidNonNegativeNumber_(item.lineTotal)){
      lineTotal=roundMoney_(Number(item.lineTotal));
    }else{
      if(!isValidNonNegativeNumber_(item.unitPrice)){
        throw new Error('Line '+(i+1)+': invalid selling price.');
      }
      lineTotal=roundMoney_(qty*Number(item.unitPrice));
    }
    subtotal=roundMoney_(subtotal+lineTotal);
    if(vendorId && (plan.shortfall<=0 || !isValidNonNegativeNumber_(item.vendorUnitCost))){
      throw new Error('Vendor sourcing cost or shortage is not valid.');
    }

    for(const draw of plan.draws||[]){
      const count=Number(draw.take)||0;
      const unitCost=Number(draw.unitCost)||0;
      cogs+=count*unitCost;
      if(count>0 && unitCost<=0)costComplete=false;
    }
    const missing=Number(plan.shortfall)||0;
    if(missing>0){
      const unitCost=vendorId
        ? Number(item.vendorUnitCost)
        : Number(plan.fallbackPrice)||0;
      cogs+=missing*unitCost;
      if(unitCost<=0)costComplete=false;
    }
  });
  if(!isValidNonNegativeNumber_(payload.discount)){
    throw new Error('Invalid invoice discount.');
  }
  const discount=roundMoney_(Number(payload.discount)||0);
  const grandTotal=roundMoney_(Math.max(0,subtotal-discount));
  cogs=roundMoney_(cogs);
  const profit=roundMoney_(grandTotal-cogs);
  return {
    subtotal,discount,grandTotal,cogs,profit,
    marginPercent:grandTotal>0?roundMoney_(profit*100/grandTotal):0,
    costComplete,estimated:true
  };
}
