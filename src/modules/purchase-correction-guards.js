/**
 * M05 purchase inventory correction eligibility. Frozen source:
 * PurchaseManagement.gs::updatePurchaseInternal_ and
 * DeleteEngine.gs::deletePurchase at
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * Pure, read-only source-shaped snapshots. This is NOT the native correction
 * engine, posting plan, an auth check, a D1 transaction, or a public RPC.
 * M03/M07 must independently enforce guards atomically in the actual SQL
 * correction/reversal boundary; the source snapshot can become stale.
 */
const numberOrZero=value=>Number(value)||0;
const isDeleted=row=>String(row?.['Is Deleted']??'').trim().toLowerCase()==='true';
const numberValid=value=>Number.isFinite(Number(value))&&Number(value)>=0;

function purchaseRows(purchaseId,snapshot,action){
  if(!snapshot || !['purchases','items','lots','products','returns'].every(
    key=>Array.isArray(snapshot[key])))throw new TypeError('Explicit purchase correction snapshots required.');
  const matching=snapshot.purchases.filter(p=>p['Purchase ID']===purchaseId);
  if(matching.length>1)throw new Error('Duplicate purchase ID detected: '+purchaseId);
  const purchase=matching[0];
  if(!purchase)throw new Error('Purchase not found.');
  if(isDeleted(purchase))throw new Error(
    action==='edit'?'This purchase has been deleted.':'This purchase is already deleted.');
  if(snapshot.returns.some(r=>r['Purchase ID']===purchaseId&&!isDeleted(r))){
    throw new Error(action==='edit'
      ?'This purchase has Purchase Return records and can no longer be updated. Use Purchase Return for further corrections.'
      :'This purchase has a Purchase Return against it. Delete the return first, then delete the purchase.');
  }
  return {
    items:snapshot.items.filter(i=>i['Purchase ID']===purchaseId),
    lots:snapshot.lots.filter(l=>l['Purchase ID']===purchaseId),
    products:snapshot.products
  };
}
function lotAmounts(lot){
  const original=Number(lot['Original Quantity']);
  const remaining=Number(lot['Remaining Quantity']);
  if(!Number.isFinite(original)||!Number.isFinite(remaining)||
     original<0||remaining<0||remaining>original)
    throw new Error('Invalid purchase lot quantity; reconcile source inventory first.');
  return {original,remaining};
}
function productIndex(products){
  const index=new Map();
  for(const product of products){
    const id=product['Product ID'];
    if(index.has(id))throw new Error('Ambiguous product ID in purchase inventory snapshot: '+id);
    index.set(id,product);
  }
  return index;
}
function lotIndex(lots,{unique=false}={}){
  const index=new Map();
  for(const lot of lots){
    const id=lot['Product ID'];
    lotAmounts(lot);
    const existing=index.get(id)||[];
    existing.push(lot);
    if(unique&&existing.length>1)throw new Error('Ambiguous purchase stock lots for '+id);
    index.set(id,existing);
  }
  return index;
}

/**
 * Mirrors the source's inventory-sensitive edit validation only.
 * Does not authorize staff or validate payment/supplier-date reallocation.
 */
export function planPurchaseInventoryEdit(purchaseId,snapshot,proposedLines){
  const {items,lots,products}=purchaseRows(purchaseId,snapshot,'edit');
  if(!Array.isArray(proposedLines)||!proposedLines.length)
    throw new Error('Add at least one product line.');

  const oldQty=new Map(),oldCost=new Map();
  for(const item of items){
    const id=item['Product ID'];
    if(oldQty.has(id))throw new Error(
      'This historical purchase contains the same product on multiple lines. It cannot be edited safely because those lines created separate stock lots. Use Purchase Return/correction instead.');
    oldQty.set(id,numberOrZero(item['Quantity']));
    oldCost.set(id,numberOrZero(item['Unit Price']));
  }
  const newQty=new Map(),newCost=new Map();
  for(const [index,line] of proposedLines.entries()){
    const qty=Number(line.qty),cost=Number(line.unitPrice);
    if(!numberValid(line.qty)||qty<=0)throw new Error(
      'Line '+(index+1)+': quantity must be greater than zero.');
    if(!numberValid(line.unitPrice))throw new Error(
      'Line '+(index+1)+': unit price must be a valid number.');
    if(newQty.has(line.productId))throw new Error(
      line.name+' appears more than once — combine it into one line.');
    newQty.set(line.productId,qty);
    newCost.set(line.productId,cost);
  }

  const byProduct=productIndex(products),byLot=lotIndex(lots,{unique:true});
  const costChanges=[];
  // Source verifies immutable sold-lot cost before quantity deltas.
  for(const [id,cost] of newCost){
    const earlier=oldCost.get(id);
    if(earlier===undefined || Math.abs(earlier-cost)<0.0000001)continue;
    const lot=byLot.get(id)?.[0];
    if(!lot)throw new Error(
      'This purchase has no stock lot on file, so its unit price cannot be changed safely.');
    const {original,remaining}=lotAmounts(lot);
    if(original-remaining>0)throw new Error(
      'Purchase price cannot be changed after stock from this lot has already been sold. Use a cost adjustment/correction instead.');
    costChanges.push({productId:id,newPrice:cost});
  }

  const stockChanges=[];
  for(const id of new Set([...oldQty.keys(),...newQty.keys()])){
    const product=byProduct.get(id);
    if(!product||isDeleted(product))throw new Error('A product on this purchase no longer exists.');
    if(newQty.has(id) && String(product['Product Type']||'').trim()==='Bundle')
      throw new Error('Bundle stock cannot be purchased; select individual components.');
    const delta=(newQty.get(id)||0)-(oldQty.get(id)||0);
    if(delta===0)continue;
    const newStock=numberOrZero(product['Current Stock'])+delta;
    if(delta<0){
      const lot=byLot.get(id)?.[0];
      if(!lot)throw new Error(product['Product Name']+
        ': this purchase has no stock lot on file, so its quantity cannot be reduced. Use Purchase Return instead.');
      const {original,remaining}=lotAmounts(lot);
      if(remaining<Math.abs(delta))throw new Error(
        product['Product Name']+': only '+remaining+' of the '+original+
        ' bought on this purchase is still unsold, so the quantity cannot be reduced by '+Math.abs(delta)+'.');
      if(newStock<0)throw new Error(product['Product Name']+
        ': reducing this line would take stock to '+newStock+'. Some of it has already been sold.');
    }
    stockChanges.push({productId:id,delta,newStock});
  }
  return {stockChanges,costChanges};
}

/**
 * Mirrors original DeleteEngine's inventory BLOCK phase; does not reverse,
 * soft-delete, audit, or post cash/bank/supplier entries.
 */
export function planPurchaseInventoryDelete(purchaseId,snapshot){
  const {items,lots,products}=purchaseRows(purchaseId,snapshot,'delete');
  if(!items.length)throw new Error('This purchase has no item lines to reverse.');
  const byLot=lotIndex(lots),byProduct=productIndex(products);
  const wanted=new Map(),names=new Map();
  for(const item of items){
    const id=item['Product ID'];
    wanted.set(id,(wanted.get(id)||0)+numberOrZero(item['Quantity']));
    if(!names.has(id))names.set(id,item['Product Name']);
  }

  const sold=[];
  for(const id of wanted.keys()){
    const productLots=byLot.get(id)||[];
    if(!productLots.length)continue; // Source allows pre-lot-system historical purchases.
    const totals=productLots.reduce((a,lot)=>{
      const {original,remaining}=lotAmounts(lot);
      a.original+=original;a.remaining+=remaining;return a;
    },{original:0,remaining:0});
    const consumed=totals.original-totals.remaining;
    if(consumed>0)sold.push(names.get(id)+' ('+consumed+' of '+totals.original+' already sold)');
  }
  if(sold.length)throw new Error(
    'Cannot delete this purchase - stock from it has already been sold: '+sold.join(', ')+
    '. Delete or return the sales that used this stock first, then delete the purchase.');

  const shortfalls=[],stockReversals=[];
  for(const [id,qty] of wanted){
    const product=byProduct.get(id);
    if(!product){shortfalls.push('a product on this purchase no longer exists');continue;}
    const stock=numberOrZero(product['Current Stock']);
    if(stock<qty){
      shortfalls.push(product['Product Name']+' (need '+qty+', have '+stock+')');
      continue;
    }
    stockReversals.push({
      productId:id,qty,newStock:stock-qty,
      lotIds:(byLot.get(id)||[]).map(l=>l['Lot ID'])
    });
  }
  if(shortfalls.length)throw new Error(
    'Cannot delete this purchase - stock would go negative: '+shortfalls.join(', ')+'.');
  return {stockReversals};
}
