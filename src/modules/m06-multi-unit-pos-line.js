/**
 * M06 INTERNAL, READ-ONLY mixed-unit POS sale line preflight (issue #314).
 *
 * Frozen inventory/FIFO: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * Approved unit calculations: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c,
 * already adapted by M05 in product-unit-conversions.js.
 *
 * No D1, RPC, auth, Cash Session, lot reservation, stock/Party/Cash/Bank
 * posting, public endpoint or currency ledger mutation. M03 owns the
 * eventual SQL-atomic writer and must independently validate everything
 * with M04 authenticated authority and versioned M05 stock/unit snapshots.
 */
import {
  resolveProductUnitBreakdown_,
  computeUnitBreakdownSalePricing_
} from './product-unit-conversions.js';
import {
  planStockConsumption_,
  planSaleVendorConsumption_,
  computePlanSellingPrice_
} from './stock-fifo-planning.js';

function plain(value){
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}
function trustedRows(rows,label){
  if(!Array.isArray(rows))throw new TypeError('Missing trusted '+label+' snapshot.');
  for(const row of rows){
    if(!plain(row))throw new TypeError('Invalid trusted '+label+' row or accessor.');
  }
}
const deleted=row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE';
const active=row=>!deleted(row) && String(row.Status||'Active')!=='Deleted';
const finitePositive=value=>Number.isFinite(Number(value)) && Number(value)>0;

/**
 * Compose one source-backed base-stock POS display intent.
 * Browser claims supply only requested quantities and explicit shortage mode.
 * Product, conversion factors/prices, FIFO lots and all IDs come from a
 * trusted, tenant-scoped source snapshot; no write authorization is inferred.
 */
export function planMultiUnitPosLine(intent,snapshot){
  if(!plain(intent) || typeof intent.productId!=='string' ||
     !intent.productId.trim() || !Array.isArray(intent.unitBreakdown)){
    throw new TypeError('Invalid mixed-unit POS sale line intent.');
  }
  if(!['Own','Negative','Vendor'].includes(intent.shortageMode)){
    throw new Error('Select an explicit Own, Negative or Vendor shortage mode.');
  }
  for(const part of intent.unitBreakdown){
    if(!plain(part))throw new TypeError('Invalid POS unit breakdown component.');
  }
  if(!plain(snapshot)){
    throw new TypeError('Missing trusted POS product, conversion and FIFO snapshot.');
  }
  trustedRows(snapshot.products,'POS products');
  trustedRows(snapshot.conversionRows,'POS conversions');
  trustedRows(snapshot.stockLots,'POS stock lots');

  const id=intent.productId;
  const matches=snapshot.products.filter(row=>
    String(row['Product ID']||'')===id && !deleted(row));
  if(matches.length>1)throw new Error('NEEDS_REVIEW: duplicate active POS Product ID.');
  const product=matches[0];
  if(!product || String(product.Status||'Active')==='Inactive'){
    throw new Error('POS product is inactive, deleted or not found.');
  }
  if(String(product['Product Type']||'Standard').trim()==='Bundle'){
    throw new Error('Bundle sale requires separate approved component planning.');
  }
  if(typeof product.Unit!=='string' || !product.Unit.trim() ||
     !Number.isFinite(Number(product['Current Stock'])) ||
     !Number.isFinite(Number(product['Selling Price'])) ||
     Number(product['Selling Price'])<0){
    throw new TypeError('Invalid trusted POS product unit, stock or price.');
  }

  // Only reviewed active conversion rows for this exact product are allowed.
  // Deleted historical rows cannot reprice a future sale or duplicate a unit.
  const conversions=snapshot.conversionRows.filter(row=>
    String(row['Product ID']||'')===id &&
    !deleted(row) && String(row.Status||'Active')!=='Inactive');
  const conversionIds=new Set(),unitNames=new Set();
  for(const row of conversions){
    const conversionId=row['Conversion ID'],unitName=row['Unit Name'];
    if(typeof conversionId!=='string' || !conversionId.trim() ||
       conversionId==='BASE' || typeof unitName!=='string' || !unitName.trim() ||
       !finitePositive(row['Conversion Factor'])){
      throw new Error('Invalid active POS unit conversion factor, unit or ID.');
    }
    if(conversionIds.has(conversionId) || unitNames.has(unitName.toLowerCase())){
      throw new Error('NEEDS_REVIEW: duplicate active POS conversion ID or unit.');
    }
    conversionIds.add(conversionId);
    unitNames.add(unitName.toLowerCase());
    const price=row['Selling Price'];
    if(price!=='' && price!==null && price!==undefined &&
      (!Number.isFinite(Number(price)) || Number(price)<0)){
      throw new Error('Invalid active POS conversion selling price.');
    }
  }

  // Physical inventory remains one canonical base-unit stock quantity.
  const lots=snapshot.stockLots.filter(row=>
    String(row['Product ID']||'')===id && active(row));
  const lotIds=new Set();
  for(const row of lots){
    const lotId=row['Lot ID'];
    if(typeof lotId!=='string' || !lotId.trim() ||
       !Number.isFinite(Number(row['Remaining Quantity']))){
      throw new Error('Invalid trusted POS stock lot identity or quantity.');
    }
    if(lotIds.has(lotId))throw new Error('NEEDS_REVIEW: duplicate active POS Lot ID.');
    lotIds.add(lotId);
  }
  if(!finitePositive(intent.claimedBaseQty)){
    throw new Error('POS quantity must be greater than zero.');
  }
  const resolved=resolveProductUnitBreakdown_(
    product,intent.unitBreakdown,intent.claimedBaseQty,conversions);
  const baseQty=resolved.baseQty;
  const fifo=intent.shortageMode==='Vendor'
    ?planSaleVendorConsumption_(id,baseQty,lots,product)
    :planStockConsumption_(id,baseQty,lots,product);
  const shortfall=Number(fifo.shortfall)||0;
  if(shortfall>0.0000001 && intent.shortageMode==='Own'){
    throw new Error('Owned stock shortage: choose Negative or Vendor sourcing explicitly.');
  }
  const drawn=fifo.draws.reduce((sum,row)=>sum+row.take,0);
  if(!Number.isFinite(drawn) || !Number.isFinite(shortfall) ||
     Math.abs(drawn+shortfall-baseQty)>0.0000001){
    throw new Error('NEEDS_REVIEW: POS base-unit FIFO coverage mismatch.');
  }

  const pricing=resolved.hasBreakdown
    ?computeUnitBreakdownSalePricing_(fifo,resolved)
    :computePlanSellingPrice_(fifo,baseQty);
  if(!Number.isFinite(pricing.lineTotal) || pricing.lineTotal<0 ||
     !Number.isFinite(pricing.unitPrice) || pricing.unitPrice<0){
    throw new Error('NEEDS_REVIEW: invalid mixed-unit POS sale price.');
  }

  return {
    productId:id,stockUnit:product.Unit,baseQty,
    shortageMode:intent.shortageMode,
    unitBreakdownSnapshot:resolved.snapshot.map(row=>({...row})),
    unitPricingSnapshot:(pricing.pricingSnapshot||[]).map(row=>({...row})),
    // Rounded effective base rate may not reproduce the total: keep the
    // exact component lineTotal as the sale's authoritative display money.
    unitPrice:pricing.unitPrice,lineTotal:pricing.lineTotal,
    fifoDraws:fifo.draws.map(row=>({lotId:row.lotId,baseQty:row.take})),
    shortfallBaseQty:shortfall
  };
}
