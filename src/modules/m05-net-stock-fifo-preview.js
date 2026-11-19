/**
 * M05 read-only net-owned-stock FIFO preview. NOT a stock posting, live POS
 * endpoint, historical debt settlement, or authoritative profit calculator.
 *
 * Source-faithful FIFO helpers intentionally remain byte-for-byte unchanged.
 * Here we create an in-memory virtual lot picture for a net-stock-limited
 * preview, without modifying any source lot or inventing a settlement journal.
 * Only one positive replenishment lot with outstanding OVERSOLD is supported:
 * multiple potential funding lots require proven historical allocations.
 */
import {
  buildLotPricingLadder_, planStockConsumption_, planSaleVendorConsumption_
} from './stock-fifo-planning.js';

const eps = 1e-8;
const finite = value => (typeof value === 'number' ||
  (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value));

/**
 * @param {{productId:string,quantity:number,allLots:object[],productRow:object,vendorSourced?:boolean}} input
 * @returns {{consumption:object, pricing:object, netOwnedQty:number,reservedOversoldQty:number,provisional:boolean}}
 */
export function planNetOwnedStockPreview({productId,quantity,allLots,productRow,vendorSourced=false}={}) {
  if (typeof productId!=='string'||!productId.trim())throw new TypeError('Valid Product ID required');
  if(!Array.isArray(allLots))throw new TypeError('Explicit lot snapshot required');
  if(!productRow||typeof productRow!=='object'||Array.isArray(productRow)||
      productRow['Product ID']!==productId)throw new TypeError('Matching product snapshot required');
  if(!finite(quantity)||Number(quantity)<0)throw new TypeError('Finite nonnegative quantity required');
  if(typeof vendorSourced!=='boolean')throw new TypeError('vendorSourced must be boolean');
  if(!finite(productRow['Current Stock']))throw new TypeError('Finite cached Current Stock required');

  const stock=Number(productRow['Current Stock']);
  const seen=new Set();
  let positive=0,negative=0;
  const positiveLots=[],negativeLots=[];
  for(const lot of allLots){
    if(!lot||typeof lot!=='object'||Array.isArray(lot))throw new TypeError('Invalid lot snapshot');
    if(lot['Product ID']!==productId)continue;
    const id=lot['Lot ID'];
    if(typeof id!=='string'||!id.trim())throw new Error('Missing lot ID: Needs Review');
    if(seen.has(id))throw new Error('Duplicate lot ID: Needs Review');
    seen.add(id);
    if(!finite(lot['Remaining Quantity']))throw new Error('Invalid lot quantity: Needs Review');
    const remaining=Number(lot['Remaining Quantity']);
    const status=String(lot.Status||'').trim().toLowerCase();
    if(remaining>0){
      if(status==='deleted')throw new Error('Deleted positive-stock lot conflicts with FIFO eligibility');
      if(status!=='active')throw new Error('Non-active positive lot: Needs Review');
      if(!finite(lot['Purchase Price'])||Number(lot['Purchase Price'])<=0)
        throw new Error('Unpriced/invalid positive lot cost: Needs Review');
      positive+=remaining;
      positiveLots.push(lot);
    }else if(remaining<0){
      if(status!=='oversold'||lot['Purchase ID']!=='OVERSOLD')throw new Error('Unknown negative lot source: Needs Review');
      negative+=-remaining;
      negativeLots.push(lot);
    }
  }
  if(Math.abs((positive-negative)-stock)>eps)throw new Error('Cached Current Stock and lot sum mismatch: Needs Review');
  if(negative>eps&&positiveLots.length>1)throw new Error('Ambiguous multiple positive replenishment lots: Needs Review');
  if(negative>eps && positiveLots.length===1){
    const verifiedDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(new Date(value+'T00:00:00Z').getTime()) &&
      new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
    const replenishedAt=positiveLots[0]['Purchase Date'];
    if(!verifiedDate(replenishedAt) || negativeLots.some(lot =>
        !verifiedDate(lot['Purchase Date']) || lot['Purchase Date']>replenishedAt))
      throw new Error('Backdated or ambiguous OVERSOLD chronology: Needs Review');
  }

  const virtual=allLots.map(lot=>{
    if(lot['Product ID']!==productId)return lot;
    const qty=Number(lot['Remaining Quantity']);
    if(qty<0)return {...lot,'Remaining Quantity':0};
    if(qty>0 && negative>0) return {...lot,'Remaining Quantity':Math.max(0,qty-negative)};
    return lot;
  });
  const request=Number(quantity);
  const consumption=vendorSourced
    ? planSaleVendorConsumption_(productId,request,virtual,productRow)
    : planStockConsumption_(productId,request,virtual,productRow);
  const pricing=buildLotPricingLadder_(productId,virtual,productRow);
  // Never expose rowIndex or remainingAfter from synthetic lots. Those fields
  // would point at original DB rows but describe virtual, UNPOSTED balances.
  const readOnlyConsumption = {
    ...consumption,
    draws: consumption.draws.map(({lotId,take,unitCost,unitSellPrice}) =>
      ({lotId,take,unitCost,unitSellPrice}))
  };
  return {consumption:readOnlyConsumption, pricing,
    netOwnedQty:Math.max(0,stock),reservedOversoldQty:negative,
    provisional:negative>eps,postable:false};
}
