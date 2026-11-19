/**
 * M05 read-only exposure report for old OVERSOLD stock and newer purchases.
 * No D1/GAS connection, posting, row mutation, FIFO reallocation or repair.
 * The possible remaining value is explicitly CONDITIONAL, not a booked asset.
 */
const isPlain = row => row !== null && typeof row === 'object' && !Array.isArray(row) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(row)) &&
  Object.values(Object.getOwnPropertyDescriptors(row)).every(d => Object.hasOwn(d, 'value'));
const identifier = v => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
  ? String(v).trim() : '';
const quantity = v => {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const unitCost = v => {
  if (v === '' || v === null || v === undefined ||
      (typeof v !== 'number' && typeof v !== 'string')) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const money = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * @param {{products: object[],stockLots: object[],saleItemLots: object[],
 *          purchaseItems: object[],stockMovements: object[]}} snapshot
 * @returns {{products: object[],issues: object[],summary: object}}
 */
export function auditOversoldExposure(snapshot) {
  if (!isPlain(snapshot)) throw new TypeError('Trusted stock snapshot required');
  for (const key of ['products','stockLots','saleItemLots','purchaseItems','stockMovements']) {
    if (!Array.isArray(snapshot[key]) || !snapshot[key].every(isPlain)) {
      throw new TypeError('Trusted '+key+' snapshot array required');
    }
  }
  const issues = [], productsById = new Map(), lotsByProduct = new Map(), seenLots = new Set();
  const issue = (code, productId, data = {}) => issues.push({code, productId, ...data});
  for (const [index, p] of snapshot.products.entries()) {
    const id = identifier(p['Product ID']);
    if (!id) issue('MISSING_PRODUCT_ID', id, {row:index});
    if (productsById.has(id)) issue('DUPLICATE_PRODUCT_ID', id, {row:index});
    const current = quantity(p['Current Stock']);
    if (current === null) issue('INVALID_CURRENT_STOCK', id, {row:index});
    productsById.set(id,p);
  }
  for (const [index, lot] of snapshot.stockLots.entries()) {
    const id = identifier(lot['Lot ID']), pid = identifier(lot['Product ID']);
    if (!id) issue('MISSING_LOT_ID', pid, {row:index});
    if (seenLots.has(id)) issue('DUPLICATE_LOT_ID', pid, {lotId:id});
    seenLots.add(id);
    if (!pid || !productsById.has(pid)) issue('ORPHAN_LOT', pid, {lotId:id});
    const qty = quantity(lot['Remaining Quantity']);
    const cost = unitCost(lot['Purchase Price']);
    if (qty === null) issue('INVALID_LOT_QUANTITY', pid, {lotId:id});
    if (cost === null) issue('INVALID_LOT_COST', pid, {lotId:id});
    if (qty !== null && qty > 0 && String(lot.Status || '').trim().toLowerCase() === 'deleted') {
      issue('DELETED_POSITIVE_LOT', pid, {lotId:id});
    }
    if (qty !== null && qty < 0 && String(lot['Purchase ID']).toUpperCase() !== 'OVERSOLD') {
      issue('UNEXPECTED_NEGATIVE_LOT', pid, {lotId:id});
    }
    if (!lotsByProduct.has(pid)) lotsByProduct.set(pid, []);
    lotsByProduct.get(pid).push({lot,id,qty,cost});
  }
  const rows = snapshot.products.map(p => {
    const pid=identifier(p['Product ID']);
    const all=lotsByProduct.get(pid)||[];
    const cachedStock=quantity(p['Current Stock']);
    let lotStock=0, grossPositiveQty=0, oversoldQty=0, rawValuation=0;
    const negativeLotIds=[], purchaseLotIds=[];
    let valid=true;
    for (const {lot,id,qty,cost} of all) {
      if (qty === null || cost === null) { valid=false; continue; }
      lotStock+=qty;
      rawValuation+=qty*cost;
      if (qty>0) {
        grossPositiveQty+=qty;
        purchaseLotIds.push(id);
        const purchaseId=identifier(lot['Purchase ID']);
        const lines=snapshot.purchaseItems.filter(x=>identifier(x['Purchase ID'])===purchaseId && identifier(x['Product ID'])===pid);
        if (purchaseId.startsWith('PUR-') && lines.length!==1) {
          issue(lines.length?'AMBIGUOUS_PURCHASE_LINE':'UNVERIFIED_PURCHASE_LINE',pid,{lotId:id,purchaseId});
        }
        if (purchaseId.startsWith('PUR-') && !snapshot.stockMovements.some(x=>
          identifier(x['Product ID'])===pid && identifier(x['Lot ID'])===id &&
          identifier(x.Reference)===purchaseId && String(x.Type).toLowerCase()==='purchase')) {
          issue('UNVERIFIED_PURCHASE_MOVEMENT',pid,{lotId:id,purchaseId});
        }
      } else if(qty<0) {
        oversoldQty+=-qty;
        negativeLotIds.push(id);
        if (!snapshot.saleItemLots.some(x=>identifier(x['Product ID'])===pid && identifier(x['Lot ID'])===id && (quantity(x.Quantity)||0)>0)) {
          issue('UNVERIFIED_OVERSOLD_CONSUMPTION',pid,{lotId:id});
        }
      }
    }
    const hasLots=all.length>0;
    if (!hasLots && cachedStock!==0) issue('NO_LOTS_NONZERO',pid);
    const difference=valid && cachedStock!==null && hasLots ? lotStock-cachedStock:null;
    if (hasLots && difference!==null && Math.abs(difference)>1e-8) {
      issue('STOCK_MISMATCH',pid,{difference});
    }
    const ownIssues=issues.filter(i=>i.productId===pid);
    let conditionalRemainingQty=null,conditionalRemainingValue=null,conditionalCostVariance=null;
    const positive=all.filter(x=>x.qty>0),negative=all.filter(x=>x.qty<0);
    if (valid && hasLots && ownIssues.length===0 && positive.length===1 && negative.length>0 &&
        grossPositiveQty>=oversoldQty && lotStock>=0 && cachedStock===lotStock) {
      // Illustration only: a single eligible purchased lot at a known cost.
      // The actual allocation/reversal belongs to the later M05 settlement planner.
      conditionalRemainingQty=lotStock;
      conditionalRemainingValue=money(lotStock*positive[0].cost);
      conditionalCostVariance=money(negative.reduce((sum,x)=>sum+(-x.qty)*(x.cost-positive[0].cost),0));
    }
    const status = ownIssues.length ? 'NEEDS_REVIEW' : !hasLots ? 'NO_LOTS_ZERO' :
      conditionalRemainingValue!==null ? 'PROVISIONAL_ONLY' : 'NO_PROVISIONAL_VALUATION';
    return {
      productId:pid,cachedStock,lotStock:hasLots&&valid?lotStock:null,difference,
      grossPositiveQty:valid?grossPositiveQty:null,oversoldQty:valid?oversoldQty:null,
      rawLotValue:valid?money(rawValuation):null,
      negativeLotIds,purchaseLotIds,conditionalRemainingQty,
      conditionalRemainingValue,conditionalCostVariance,status
    };
  });
  return {
    products: rows, issues,
    summary:{productCount:rows.length,lotCount:snapshot.stockLots.length,
      oversoldLotCount:snapshot.stockLots.filter(l=>(quantity(l['Remaining Quantity'])??0)<0).length,
      productsNeedingReview:rows.filter(r=>r.status==='NEEDS_REVIEW').length}
  };
}
