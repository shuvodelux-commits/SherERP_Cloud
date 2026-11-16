/**
 * M05 INTERNAL, READ-ONLY Purchase Item ↔ Stock Lot selling-price audit.
 * Frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2:
 * Purchase.gs::createPurchase,
 * PurchaseManagement.gs::updatePurchaseInternal_,
 * StockLots.gs::createLotWithRow_.
 *
 * Requires independently trusted, tenant-scoped source-shaped snapshots.
 * This is neither a D1 importer nor a sale/stock/ledger writer or RPC.
 * A missing historical Sell Price is REVIEW evidence, never silently
 * replaced with a product's latest default. Sold invoice prices are immutable.
 */
const TOLERANCE=0.0000001;

function plainData(row){
  if(!row || typeof row!=='object' || Array.isArray(row))return false;
  const proto=Object.getPrototypeOf(row);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(row))
      .every(d=>Object.hasOwn(d,'value'));
}
function sourceId(value){
  return typeof value==='string' && value.trim()===value && value.length>0;
}
function price(value){
  if(value===null || value===undefined || value==='')return 'missing';
  if(typeof value!=='number' && typeof value!=='string')return null;
  if(typeof value==='string' && !value.trim())return 'missing';
  const parsed=Number(value);
  return Number.isFinite(parsed) && parsed>=0 ? parsed : null;
}
function number(value){
  if((typeof value!=='number' && typeof value!=='string') ||
    value===null || value==='')return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}
function internalSource(value){
  const name=String(value??'').trim().toUpperCase();
  return name==='OVERSOLD' || name==='OPENING' || name==='OPENING-MIGRATION' ||
    name==='ADJUSTMENT' || name==='LEGACY' ||
    name.startsWith('OPENING-') || name.startsWith('ADJUSTMENT-');
}
const deleted=row=>String(row['Is Deleted']??'').toUpperCase()==='TRUE';
const key=(purchaseId,productId)=>JSON.stringify([purchaseId,productId]);

/**
 * Audits stored original purchase item and lot prices by immutable legacy IDs.
 * Does not apply current product sale prices, supplier settlements or returns.
 */
export function auditPurchaseLotSellPriceProvenance({
  purchases,purchaseItems,stockLots
}={}){
  if(!Array.isArray(purchases) ||
     !Array.isArray(purchaseItems) || !Array.isArray(stockLots)){
    throw new TypeError('Explicit trusted Purchase and Stock Lot snapshot arrays required.');
  }
  if([...purchases,...purchaseItems,...stockLots].some(row=>!plainData(row))){
    throw new TypeError('Invalid purchase/lot snapshot row or accessor.');
  }

  const issues=[];
  const issue=(code,purchaseId='',productId='',lotId='')=>{
    issues.push({code,purchaseId,productId,lotId});
  };
  const summary={
    purchases:purchases.length,activePurchases:0,deletedPurchases:0,
    purchaseItems:purchaseItems.length,stockLots:stockLots.length,
    comparedPrices:0,internalLots:0,retiredLots:0,
    priceTolerance:TOLERANCE
  };
  if(purchases.length===0)issue('EMPTY_PURCHASE_SNAPSHOT');

  const headers=new Map(),itemGroups=new Map(),lotGroups=new Map();
  const lotIds=new Set();

  for(const row of purchases){
    if(deleted(row))summary.deletedPurchases++;
    else summary.activePurchases++;
    const purchaseId=row['Purchase ID'];
    if(!sourceId(purchaseId)){
      issue('INVALID_PURCHASE_ID');
      continue;
    }
    if(headers.has(purchaseId)){
      issue('DUPLICATE_PURCHASE_ID',purchaseId);
      headers.set(purchaseId,null); // Never choose first/last duplicate.
    }else headers.set(purchaseId,row);
  }

  for(const row of purchaseItems){
    const purchaseId=row['Purchase ID'],productId=row['Product ID'];
    if(!sourceId(purchaseId)||!sourceId(productId)){
      issue('INVALID_PURCHASE_ITEM_ID',
        sourceId(purchaseId)?purchaseId:'',
        sourceId(productId)?productId:'');
      continue;
    }
    if(!headers.has(purchaseId))issue('ORPHAN_PURCHASE_ITEM',purchaseId,productId);
    const lookup=key(purchaseId,productId),existing=itemGroups.get(lookup)||[];
    existing.push(row);
    itemGroups.set(lookup,existing);
    if(existing.length===2)issue('DUPLICATE_PURCHASE_PRODUCT',purchaseId,productId);
  }

  for(const row of stockLots){
    const lotId=row['Lot ID'],purchaseId=row['Purchase ID'],productId=row['Product ID'];
    if(!sourceId(lotId)){
      issue('INVALID_STOCK_LOT_ID',
        sourceId(purchaseId)?purchaseId:'',
        sourceId(productId)?productId:'');
    }else if(lotIds.has(lotId))issue('DUPLICATE_STOCK_LOT_ID',
      sourceId(purchaseId)?purchaseId:'',
      sourceId(productId)?productId:'',lotId);
    if(sourceId(lotId))lotIds.add(lotId);

    if(internalSource(purchaseId)){
      summary.internalLots++;
      continue;
    }
    if(!sourceId(purchaseId)||!sourceId(productId)){
      issue('INVALID_PURCHASE_LOT_REFERENCE',
        sourceId(purchaseId)?purchaseId:'',
        sourceId(productId)?productId:'',
        sourceId(lotId)?lotId:'');
      continue;
    }
    if(!headers.has(purchaseId))issue('ORPHAN_PURCHASE_LOT',purchaseId,productId,lotId);
    const lookup=key(purchaseId,productId),existing=lotGroups.get(lookup)||[];
    existing.push(row);
    lotGroups.set(lookup,existing);
  }

  for(const [purchaseId,header] of headers){
    if(!header || deleted(header))continue;
    const itemPairs=[...itemGroups].filter(([entry])=>JSON.parse(entry)[0]===purchaseId);
    if(!itemPairs.length)issue('MISSING_PURCHASE_ITEMS',purchaseId);
    for(const [lookup,lines] of itemPairs){
      if(lines.length!==1)continue;
      const productId=lines[0]['Product ID'];
      const lots=lotGroups.get(lookup)||[];
      if(lots.length===0){
        issue('MISSING_PURCHASE_LOT',purchaseId,productId);
        continue;
      }
      if(lots.length>1){
        issue('AMBIGUOUS_PURCHASE_LOTS',purchaseId,productId);
        continue;
      }
      const lot=lots[0],lotId=lot['Lot ID'];
      const itemPrice=price(lines[0]['Sell Price']);
      const lotPrice=price(lot['Sell Price']);
      if(itemPrice==='missing')issue('MISSING_ITEM_SELL_PRICE',purchaseId,productId,lotId);
      else if(itemPrice===null)issue('INVALID_ITEM_SELL_PRICE',purchaseId,productId,lotId);
      if(lotPrice==='missing')issue('MISSING_LOT_SELL_PRICE',purchaseId,productId,lotId);
      else if(lotPrice===null)issue('INVALID_LOT_SELL_PRICE',purchaseId,productId,lotId);
      if(typeof itemPrice==='number' && typeof lotPrice==='number'){
        summary.comparedPrices++;
        if(Math.abs(itemPrice-lotPrice)>TOLERANCE){
          issue('SELL_PRICE_MISMATCH',purchaseId,productId,lotId);
        }
      }
    }
  }

  for(const [lookup,lots] of lotGroups){
    const [purchaseId,productId]=JSON.parse(lookup);
    const header=headers.get(purchaseId);
    if(!header || deleted(header) || itemGroups.has(lookup))continue;
    for(const lot of lots){
      const original=number(lot['Original Quantity']);
      const remaining=number(lot['Remaining Quantity']);
      if(original===0 && remaining===0){
        summary.retiredLots++;
      }else{
        issue('LOT_WITHOUT_PURCHASE_ITEM',purchaseId,productId,lot['Lot ID']);
      }
    }
  }

  return {ready:issues.length===0,issues,summary};
}
