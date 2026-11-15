/**
 * M06: private, read-only source-parity POS profit estimation with Bundles.
 * Based on pinned Sales.gs::estimatePosInvoiceProfit_.
 *
 * Requires trusted, tenant-scoped source snapshots from a caller that has
 * ALREADY authorized authenticated pos.view AND canViewInvoiceProfit_.
 * Neither authentication nor cost-data fetch belongs in this pure module.
 *
 * Physical Bundle demands are planned ONCE per product across all Bundles
 * and any standalone sale of the same component. This never posts/reserves
 * inventory or money; no RPC, D1 binding or production release.
 */
import {
  isValidNonNegativeNumber_,roundMoney_,planStockConsumption_,
  planSaleVendorConsumption_,computePlanSellingPrice_
} from './stock-fifo-planning.js';
import {bundleProductType_} from './pos-bundle-catalog.js';
import {buildSaleStockDemands_} from './pos-bundle-demands.js';
import {estimateStandardPosInvoiceProfit} from './pos-profit-standard.js';

const record=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);

/**
 * @param {object} payload Source-shaped POS cart.
 * @param {{productsById:object, stockLots:object[], bundleDefinitions:object}} snapshot
 *   Trusted, cost-authorized and already tenant-scoped source rows.
 */
export function estimateMixedPosInvoiceProfit(payload,snapshot){
  if(!record(snapshot)||!record(snapshot.productsById) ||
    !Array.isArray(snapshot.stockLots)||!record(snapshot.bundleDefinitions)){
    throw new TypeError('Missing trusted mixed POS profit snapshot');
  }
  payload=payload||{};
  const items=payload.items;
  // Delegate the existing source-proven Standard path; no second FIFO
  // computation or change of its original cart error behavior.
  if(!Array.isArray(items)||!items.some(item=>
    bundleProductType_(snapshot.productsById[String(item&&item.productId||'')])==='Bundle')){
    return estimateStandardPosInvoiceProfit(payload,snapshot);
  }

  if(!items.length)throw new Error('Cart is empty.');
  if(items.length>200)throw new Error('Too many POS lines for a single preview.');

  const productsById=snapshot.productsById;
  const allLots=snapshot.stockLots;
  const definitions=snapshot.bundleDefinitions;
  const seen={};
  const lines=[];
  let subtotal=0,cogs=0,costComplete=true;

  function addPlanCost_(plan,vendorCost){
    (plan.draws||[]).forEach(function(draw){
      const qty=Number(draw.take)||0,unitCost=Number(draw.unitCost)||0;
      cogs+=qty*unitCost;
      if(qty>0&&unitCost<=0)costComplete=false;
    });
    const missing=Number(plan.shortfall)||0;
    if(missing>0){
      const unitCost=vendorCost===null?(Number(plan.fallbackPrice)||0):vendorCost;
      cogs+=missing*unitCost;
      if(unitCost<=0)costComplete=false;
    }
  }

  items.forEach(function(item,i){
    const productId=String(item&&item.productId||'');
    const qty=Number(item&&item.qty);
    const product=productsById[productId];
    if(!product||!productId||seen[productId]){
      throw new Error('Invalid or duplicate POS item: '+(productId||String(i+1)));
    }
    seen[productId]=true;
    if(!isValidNonNegativeNumber_(qty)||qty<=0){
      throw new Error('Line '+(i+1)+': enter a positive quantity.');
    }
    const isBundle=bundleProductType_(product)==='Bundle';
    const vendorId=String(item.vendorId||'').trim();
    if(isBundle){
      const recipe=definitions[productId];
      if(!recipe||!Number.isSafeInteger(qty)||
        Number(item.bundleRevision)!==Number(recipe.revision)){
        throw new Error('Bundle recipe changed. Refresh POS before checking profit.');
      }
      if(vendorId)throw new Error('Vendor shortages cannot be sourced inside a bundle.');
    }
    const plan=isBundle?null:(vendorId
      ?planSaleVendorConsumption_(productId,qty,allLots,product)
      :planStockConsumption_(productId,qty,allLots,product));
    let lineTotal;
    if(item.priceMode==='auto'){
      lineTotal=isBundle
        ?roundMoney_(qty*(Number(product['Selling Price'])||0))
        :computePlanSellingPrice_(plan,qty).lineTotal;
    }else if(item.priceMode==='fixed'&&isValidNonNegativeNumber_(item.lineTotal)){
      lineTotal=roundMoney_(Number(item.lineTotal));
    }else{
      if(!isValidNonNegativeNumber_(item.unitPrice)){
        throw new Error('Line '+(i+1)+': invalid selling price.');
      }
      lineTotal=roundMoney_(qty*Number(item.unitPrice));
    }
    subtotal=roundMoney_(subtotal+lineTotal);
    if(vendorId&&(plan.shortfall<=0||!isValidNonNegativeNumber_(item.vendorUnitCost))){
      throw new Error('Vendor sourcing cost or shortage is not valid.');
    }
    lines.push({productId,qty,productType:isBundle?'Bundle':'Standard',
      vendorId,vendorUnitCost:vendorId?Number(item.vendorUnitCost):0,plan});
  });

  const bundleLines=lines.filter(line=>line.productType==='Bundle');
  const overlaps={};
  if(bundleLines.length){
    const first=buildSaleStockDemands_(bundleLines,definitions,{});
    const shared=lines.filter(function(line){
      if(line.productType!=='Standard'||
        !Object.prototype.hasOwnProperty.call(first.requirementsByProductId,line.productId)){
        return false;
      }
      if(line.vendorId){
        throw new Error('Bundle and vendor-sourced standalone component cannot share an invoice.');
      }
      overlaps[line.productId]=true;
      return true;
    });
    const demand=buildSaleStockDemands_(bundleLines.concat(shared),definitions,{});
    Object.keys(demand.requirementsByProductId).forEach(function(productId){
      const product=productsById[productId];
      if(!product||bundleProductType_(product)!=='Standard'){
        throw new Error('Bundle component unavailable.');
      }
      addPlanCost_(planStockConsumption_(
        productId,demand.requirementsByProductId[productId],allLots,product
      ),null);
    });
  }

  lines.forEach(function(line){
    if(line.productType!=='Standard'||overlaps[line.productId])return;
    addPlanCost_(line.plan,line.vendorId?line.vendorUnitCost:null);
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
