/**
 * M05 internal, pure purchase-detail projector.
 * Source: pinned PurchaseManagement.gs::getPurchaseDetail and
 * StockLots.gs::lotSellPrice_ (Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2).
 *
 * Inputs must be explicit, tenant-scoped, already-authorized snapshots.
 * No D1, network, GAS globals, permission decisions, posting or RPC routing.
 * The repository must independently verify unique source IDs before using
 * this projection; duplicates are also rejected here, never guessed.
 */

const numberOrZero=value=>Number(value)||0;
const isDeleted=row=>String(row?.['Is Deleted']??'').toUpperCase()==='TRUE';
const validNonNegative=value=>Number.isFinite(Number(value)) && Number(value)>=0;

function lotSellingPrice(lot,product){
  const raw=lot?lot['Sell Price']:'';
  if(raw!=='' && raw!==null && raw!==undefined && validNonNegative(raw)){
    return Number(raw);
  }
  const fallback=product?product['Selling Price']:0;
  return validNonNegative(fallback)?Number(fallback):0;
}

/**
 * Returns original source-shaped getPurchaseDetail.data only, not a public
 * RPC envelope. Any external caller must validate tenant/session/permissions.
 */
export function projectPurchaseDetail(purchaseId,{
  purchases,items,products,lots,returns,settlement=null
}){
  const matching=purchases.filter(p=>p['Purchase ID']===purchaseId);
  if(matching.length>1){
    throw new Error('Duplicate purchase ID detected: '+purchaseId+'. Reconcile the legacy source ID before viewing.');
  }
  const p=matching[0];
  if(!p)throw new Error('Purchase not found.');
  if(isDeleted(p))throw new Error('This purchase has been deleted.');

  const detailItems=items.filter(i=>i['Purchase ID']===purchaseId);
  const productsById=new Map(products.map(pr=>[pr['Product ID'],pr]));
  const lotsByProduct=new Map(lots.filter(l=>l['Purchase ID']===purchaseId)
    .map(lot=>[lot['Product ID'],lot]));
  const returned=returns.reduce((total,r)=>(
    !isDeleted(r)&&r['Purchase ID']===purchaseId
      ?total+numberOrZero(r['Total Return Amount']):total
  ),0);
  const grand=numberOrZero(p['Grand Total']);

  return {
    purchaseId:p['Purchase ID'],date:p['Date']?String(p['Date']).slice(0,10):'',
    supplierId:p['Supplier ID'],supplierName:p['Supplier Name'],
    subtotal:numberOrZero(p['Subtotal']),discount:numberOrZero(p['Discount']),
    grandTotal:grand,
    paidAmount:settlement?numberOrZero(settlement.paidAmount):numberOrZero(p['Paid Amount']),
    dueAmount:settlement?numberOrZero(settlement.dueAmount):numberOrZero(p['Due Amount']),
    paymentStatus:settlement?settlement.paymentStatus:p['Payment Status'],
    paymentMethod:p['Payment Method']||'Cash',
    bankAccountName:p['Bank Account Name']||'',
    notes:p['Notes']||'',createdBy:p['Created By']||'',
    returnedAmount:returned,netPurchase:grand-returned,
    items:detailItems.map(i=>({
      productId:i['Product ID'],name:i['Product Name'],
      qty:numberOrZero(i['Quantity']),unitPrice:numberOrZero(i['Unit Price']),
      sellingPrice:(i['Sell Price']!=='' && i['Sell Price']!==undefined)
        ?numberOrZero(i['Sell Price'])
        :lotSellingPrice(lotsByProduct.get(i['Product ID']),productsById.get(i['Product ID'])),
      lineTotal:numberOrZero(i['Line Total'])
    }))
  };
}
