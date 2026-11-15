/**
 * M07-B3 — source-faithful, read-only Purchase Return lot preflight.
 * Frozen Mohim_ERP StockLots.gs::planPurchaseReturnLotReduction_.
 * NOT a posting engine, authenticated RPC, D1 transaction or permission check.
 * M03 must supply trusted, normalized source-shaped rows. A legacy fallback
 * requires separate M05/M07 review before any production financial write.
 */
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  (Object.getPrototypeOf(value)===Object.prototype||
   Object.getPrototypeOf(value)===null);

function assertData(value){
  if(!plain(value)||Object.values(Object.getOwnPropertyDescriptors(value))
    .some(desc=>'get' in desc||'set' in desc)){
    throw new TypeError('Invalid Purchase Return source evidence');
  }
}
const numeric=value=>Number(value)||0;
const validNonNegative=value=>Number.isFinite(Number(value))&&Number(value)>=0;
const dateOnly=value=>value?String(value).slice(0,10):'';
function compareFifo(a,b){
  const da=dateOnly(a['Purchase Date'])||dateOnly(a['Created At'])||'';
  const db=dateOnly(b['Purchase Date'])||dateOnly(b['Created At'])||'';
  if(da!==db)return da<db?-1:1;
  return String(a['Lot ID']).localeCompare(String(b['Lot ID']));
}
function sellPrice(lot,product){
  const raw=lot?.['Sell Price'];
  if(raw!==''&&raw!==null&&raw!==undefined&&validNonNegative(raw))
    return Number(raw);
  const fallback=product?.['Selling Price']??0;
  return validNonNegative(fallback)?Number(fallback):0;
}

/**
 * Purchase-bound positive lots take priority; NEVER borrow another purchase's
 * lot merely because matching source lots are exhausted. The original legacy
 * fallback applies only when there are zero source purchase/sku lot rows.
 */
export function planPurchaseReturnLots(input){
  assertData(input);
  const {purchaseId,productId,qty,lots,product=null}=input;
  if(typeof purchaseId!=='string'||!purchaseId||
    typeof productId!=='string'||!productId||
    typeof qty!=='number'||!Number.isFinite(qty)||qty<0||
    !Array.isArray(lots)||lots.length>10000)
    throw new TypeError('Invalid Purchase Return planning input');
  if(product!==null)assertData(product);
  const seen=new Set();
  for(const lot of lots){
    assertData(lot);
    const id=lot['Lot ID'];
    if(typeof id!=='string'||!id||
      typeof lot['Purchase ID']!=='string'||
      typeof lot['Product ID']!=='string'||
      !Number.isFinite(Number(lot['Remaining Quantity']??0))||
      !Number.isFinite(Number(lot['Purchase Price']??0)))
      throw new TypeError('Invalid Purchase Return stock lot');
    if(seen.has(id))throw new Error('Duplicate Lot ID in Purchase Return source: '+id);
    seen.add(id);
  }

  const plan={purchaseId,productId,draws:[],legacyFallback:false};
  let need=qty;
  if(need<=0)return plan;
  const purchaseLots=lots.filter(row=>
    row['Purchase ID']===purchaseId&&row['Product ID']===productId);
  const legacy=purchaseLots.length===0;
  const available=(legacy
    ?lots.filter(row=>row['Product ID']===productId&&numeric(row['Remaining Quantity'])>0)
    :purchaseLots.filter(row=>numeric(row['Remaining Quantity'])>0)).sort(compareFifo);

  for(const lot of available){
    if(need<=0)break;
    const balance=numeric(lot['Remaining Quantity']);
    const take=Math.min(balance,need);
    if(take<=0)continue;
    const draw={
      lotId:lot['Lot ID'],
      rowIndex:lot._rowIndex,
      take,
      unitCost:numeric(lot['Purchase Price'])
    };
    if(legacy)draw.unitSellPrice=sellPrice(lot,product);
    draw.remainingAfter=balance-take;
    plan.draws.push(draw);
    need-=take;
  }
  if(need>0){
    if(!legacy){
      const remaining=plan.draws.reduce((sum,row)=>sum+row.take,0);
      throw new Error('Lots for this purchase only have '+remaining+
        ' remaining — cannot return '+qty+'.');
    }
    throw new Error('Only '+(qty-need)+
      ' units are available in stock lots — cannot return '+qty+'.');
  }
  plan.legacyFallback=legacy;
  return plan;
}
