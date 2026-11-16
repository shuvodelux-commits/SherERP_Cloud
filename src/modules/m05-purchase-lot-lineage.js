/**
 * M05 internal, READ-ONLY Purchase Item -> Stock Lot provenance gate.
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Purchase.gs, PurchaseManagement.gs, DeleteEngine.gs, StockLots.gs.
 *
 * A result is human-review evidence, not authorization to import or post.
 * Never auto-infer a Supplier -> Party identity or mutate legacy records.
 */
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}
function inputRows(snapshot,key) {
  const value=snapshot[key];
  if (!Array.isArray(value))
    throw new TypeError('Explicit '+key+' snapshot array required.');
  if (value.some(row=>!plain(row)))
    throw new TypeError('Invalid '+key+' row or accessor in trusted snapshot.');
  return value;
}
function id(value) {
  return typeof value==='string' && value.trim() ? value :
    typeof value==='number' && Number.isFinite(value) ? String(value) : '';
}
function numeric(value) {
  if (typeof value!=='string' && typeof value!=='number') return null;
  if (typeof value==='string' && !value.trim()) return null;
  const number=Number(value);
  return Number.isFinite(number) ? number : null;
}
function internalLotSource(source) {
  const value=String(source||'').trim().toUpperCase();
  return value==='OVERSOLD' || value==='OPENING' ||
    value==='OPENING-MIGRATION' || value==='ADJUSTMENT' ||
    value==='LEGACY' || value.startsWith('OPENING-') ||
    value.startsWith('ADJUSTMENT-');
}
function dateOnly(value) {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value : null;
}
function deleted(row) {
  return String(row['Is Deleted']??'').toLowerCase()==='true';
}

export function auditPurchaseLotLineage(snapshot) {
  if (!plain(snapshot)) throw new TypeError('Trusted purchase-lot snapshot required.');
  const purchases=inputRows(snapshot,'purchases');
  const purchaseItems=inputRows(snapshot,'purchaseItems');
  const stockLots=inputRows(snapshot,'stockLots');
  const issues=[];
  const issue=(code,details={})=>issues.push({code,...details});
  const headers=new Map(), itemsByPurchase=new Map(), lotsByPurchase=new Map();
  const seenLotIds=new Set();
  let activePurchases=0,deletedPurchases=0,linkedPurchaseLots=0;
  let internalLots=0,retiredLots=0;

  for(const [index,header] of purchases.entries()) {
    const purchaseId=id(header['Purchase ID']);
    if (!purchaseId) {
      issue('MISSING_PURCHASE_ID',{row:index});
      continue;
    }
    if (headers.has(purchaseId))
      issue('DUPLICATE_PURCHASE_ID',{purchaseId,row:index});
    else headers.set(purchaseId,header);
    if (deleted(header)) deletedPurchases++;
    else activePurchases++;
    if (!id(header['Supplier ID']))
      issue('MISSING_PURCHASE_SUPPLIER',{purchaseId,row:index});
  }

  for(const [index,line] of purchaseItems.entries()) {
    const purchaseId=id(line['Purchase ID']);
    const productId=id(line['Product ID']);
    const qty=numeric(line.Quantity);
    const cost=numeric(line['Unit Price']);
    if (!purchaseId)
      issue('MISSING_PURCHASE_ITEM_ID',{productId,row:index});
    else if (!headers.has(purchaseId))
      issue('ORPHAN_PURCHASE_ITEM',{purchaseId,productId,row:index});
    if (!productId)
      issue('MISSING_PURCHASE_ITEM_PRODUCT',{purchaseId,row:index});
    if (qty===null || qty<=0)
      issue('INVALID_PURCHASE_ITEM_QUANTITY',{purchaseId,productId,row:index});
    if (cost===null || cost<0)
      issue('INVALID_PURCHASE_ITEM_COST',{purchaseId,productId,row:index});
    if (purchaseId && productId) {
      if (!itemsByPurchase.has(purchaseId))
        itemsByPurchase.set(purchaseId,new Map());
      const map=itemsByPurchase.get(purchaseId);
      if (map.has(productId))
        issue('DUPLICATE_PURCHASE_PRODUCT',{purchaseId,productId,row:index});
      else map.set(productId,line);
    }
  }

  for(const [index,lot] of stockLots.entries()) {
    const lotId=id(lot['Lot ID']);
    const purchaseId=id(lot['Purchase ID']);
    const productId=id(lot['Product ID']);
    if (!lotId)
      issue('MISSING_LOT_ID',{purchaseId,productId,row:index});
    else if (seenLotIds.has(lotId))
      issue('DUPLICATE_LOT_ID',{purchaseId,lotId,row:index});
    if (lotId)seenLotIds.add(lotId);
    if (!productId)
      issue('MISSING_LOT_PRODUCT',{purchaseId,lotId,row:index});
    if (internalLotSource(purchaseId)) {
      internalLots++;
      continue;
    }
    if (!purchaseId || !headers.has(purchaseId)) {
      issue('UNVERIFIED_LOT_SOURCE',{purchaseId,productId,lotId,row:index});
      continue;
    }
    linkedPurchaseLots++;
    if (!lotsByPurchase.has(purchaseId))
      lotsByPurchase.set(purchaseId,new Map());
    const lotsByProduct=lotsByPurchase.get(purchaseId);
    if (!lotsByProduct.has(productId))
      lotsByProduct.set(productId,[]);
    lotsByProduct.get(productId).push(lot);
    const original=numeric(lot['Original Quantity']);
    const remaining=numeric(lot['Remaining Quantity']);
    if (original===null || remaining===null || original<0 ||
      remaining<0 || remaining>original)
      issue('INVALID_PURCHASE_LOT_QUANTITY',{purchaseId,productId,lotId,row:index});
  }

  for(const [purchaseId,header] of headers) {
    const lines=itemsByPurchase.get(purchaseId)||new Map();
    const lots=lotsByPurchase.get(purchaseId)||new Map();
    if (deleted(header)) {
      // DeleteEngine preserves the purchase and its items, and sets all
      // related lots to zero remaining with Deleted status.
      for(const [productId,productLots] of lots) {
        for(const stockLot of productLots) {
          const remaining=numeric(stockLot['Remaining Quantity']);
          if (remaining!==0 || String(stockLot.Status||'').toLowerCase()!=='deleted')
            issue('DELETED_PURCHASE_LOT_NOT_REVERSED',{
              purchaseId,productId,lotId:id(stockLot['Lot ID'])
            });
        }
      }
      continue;
    }
    for(const [productId,line] of lines) {
      const selected=lots.get(productId)||[];
      if (!selected.length) {
        issue('MISSING_PURCHASE_LOT',{purchaseId,productId});
        continue;
      }
      if (selected.length!==1) {
        issue('MULTIPLE_PURCHASE_LOTS',{purchaseId,productId,lotCount:selected.length});
        continue;
      }
      const stockLot=selected[0];
      const lotId=id(stockLot['Lot ID']);
      const itemQty=numeric(line.Quantity),original=numeric(stockLot['Original Quantity']);
      const itemCost=numeric(line['Unit Price']),lotCost=numeric(stockLot['Purchase Price']);
      if (itemQty!==null && original!==null && itemQty!==original)
        issue('ORIGINAL_QUANTITY_MISMATCH',{purchaseId,productId,lotId});
      if (itemCost!==null && lotCost!==null && itemCost!==lotCost)
        issue('PURCHASE_COST_MISMATCH',{purchaseId,productId,lotId});
      if (lotCost===null || lotCost<0)
        issue('INVALID_PURCHASE_LOT_COST',{purchaseId,productId,lotId});
      const sourceDate=dateOnly(header.Date);
      const lotDate=dateOnly(stockLot['Purchase Date']);
      if (!sourceDate || !lotDate)
        issue('UNVERIFIED_PURCHASE_DATE',{purchaseId,productId,lotId});
      else if (sourceDate!==lotDate)
        issue('PURCHASE_DATE_MISMATCH',{purchaseId,productId,lotId});
      const supplierId=id(header['Supplier ID']),lotSupplierId=id(stockLot['Supplier ID']);
      if (supplierId && !lotSupplierId)
        issue('UNVERIFIED_SUPPLIER_ID',{purchaseId,productId,lotId});
      else if (supplierId && lotSupplierId!==supplierId)
        issue('SUPPLIER_MISMATCH',{purchaseId,productId,lotId});
      if (String(stockLot.Status||'').trim().toLowerCase()==='deleted')
        issue('ACTIVE_PURCHASE_DELETED_LOT',{purchaseId,productId,lotId});
    }
    for(const [productId,productLots] of lots) {
      if (lines.has(productId))continue;
      for(const stockLot of productLots) {
        const original=numeric(stockLot['Original Quantity']);
        const remaining=numeric(stockLot['Remaining Quantity']);
        if (original===0 && remaining===0) {
          retiredLots++;
          continue;
        }
        issue('LOT_WITHOUT_PURCHASE_ITEM',{
          purchaseId,productId,lotId:id(stockLot['Lot ID'])
        });
      }
    }
  }

  return {
    ready:issues.length===0,
    issues,
    summary:{
      purchaseCount:purchases.length,activePurchases,deletedPurchases,
      purchaseItemCount:purchaseItems.length,stockLotCount:stockLots.length,
      linkedPurchaseLots,internalLots,retiredLots
    }
  };
}
