/**
 * M05 read-only Purchase Management History list projection.
 *
 * Frozen source:
 *   Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 *   PurchaseManagement.gs::getPurchaseManagementList
 *
 * Purchases, returns and settlements MUST come from independently trusted,
 * tenant-scoped source-equivalent snapshots. A future M03/M04 reader must
 * authorize purchase.view before acquisition; settlement evidence must be
 * calculated from the approved Supplier-only ledger, never browser fields.
 *
 * No RPC, SQL, Cash Session checks, stock change or financial posting here.
 */
function plain(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)) return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}

function trustedRows(snapshot,key) {
  const value=snapshot[key]===undefined && key==='settlements'
    ? [] : snapshot[key];
  if (!Array.isArray(value))
    throw new TypeError('Explicit trusted '+key+' snapshot array required.');
  if (value.some(row=>!plain(row)))
    throw new TypeError('Invalid trusted '+key+' row or accessor.');
  return value;
}

function originalId(value,label) {
  const valid=typeof value==='string' ? value.trim().length>0 :
    typeof value==='number' && Number.isFinite(value);
  if (!valid)
    throw new Error('Missing '+label+' original ID in trusted snapshot.');
  return String(value);
}

function amount(value,label) {
  if (value===null || value===undefined || value==='')return 0;
  if (typeof value!=='string' && typeof value!=='number')
    throw new TypeError('Invalid '+label+' amount in source snapshot.');
  const parsed=Number(value);
  if (!Number.isFinite(parsed))
    throw new TypeError('Invalid '+label+' amount in source snapshot.');
  return parsed;
}

function dateOnly(value) {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new TypeError('Purchase date must be a canonical YYYY-MM-DD date.');
  const parsed=new Date(value+'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0,10)!==value)
    throw new TypeError('Invalid purchase date in source snapshot.');
  return value;
}

const deleted=row=>String(row['Is Deleted']??'').trim().toUpperCase()==='TRUE';

/**
 * Returns the exact getPurchaseManagementList.data array for reviewed rows.
 * Settlement proof is REQUIRED for supplier-linked purchases with original
 * Due Amount > 0.004; no fallback to stale purchase header is permitted.
 */
export function projectPurchaseManagementList(snapshot) {
  if (!plain(snapshot))
    throw new TypeError('Trusted Purchase History snapshot required.');
  const purchases=trustedRows(snapshot,'purchases').filter(p=>!deleted(p));
  const returns=trustedRows(snapshot,'returns').filter(r=>!deleted(r));
  const settlementRows=trustedRows(snapshot,'settlements');
  const purchaseById=new Map(),settlements=new Map(),returned=new Map();
  const seenReturns=new Set();

  for(const purchase of purchases){
    const purchaseId=originalId(purchase['Purchase ID'],'purchase');
    if(purchaseById.has(purchaseId))
      throw new Error('Duplicate active purchase ID: '+purchaseId);
    purchaseById.set(purchaseId,purchase);
    dateOnly(purchase.Date);
    amount(purchase['Grand Total'],'grand total');
    amount(purchase['Paid Amount'],'paid');
    amount(purchase['Due Amount'],'due');
  }

  for(const entry of returns) {
    const returnId=originalId(entry['Return ID'],'purchase return');
    if(seenReturns.has(returnId))
      throw new Error('Duplicate purchase return ID: '+returnId);
    seenReturns.add(returnId);
    const purchaseId=originalId(entry['Purchase ID'],'purchase return parent');
    if(!purchaseById.has(purchaseId))
      throw new Error('Orphan purchase return references missing active purchase: '+purchaseId);
    const value=amount(entry['Total Return Amount'],'purchase return');
    if(value<0)
      throw new TypeError('Invalid negative purchase return amount.');
    returned.set(purchaseId,(returned.get(purchaseId)||0)+value);
    if(!Number.isFinite(returned.get(purchaseId)))
      throw new TypeError('Invalid accumulated purchase return amount.');
  }

  for(const evidence of settlementRows) {
    const purchaseId=originalId(evidence.purchaseId,'settlement purchase');
    if(settlements.has(purchaseId))
      throw new Error('Duplicate settlement evidence for purchase: '+purchaseId);
    if(!purchaseById.has(purchaseId))
      throw new Error('Orphan settlement evidence for purchase: '+purchaseId);
    originalId(evidence.supplierId,'settlement supplier');
    amount(evidence.paidAmount,'settlement paid');
    amount(evidence.dueAmount,'settlement due');
    if(typeof evidence.paymentStatus!=='string' || !evidence.paymentStatus.trim())
      throw new TypeError('Invalid settlement payment status.');
    settlements.set(purchaseId,evidence);
  }

  return purchases.map(purchase=>{
    const purchaseId=String(purchase['Purchase ID']);
    const grand=amount(purchase['Grand Total'],'grand total');
    const returnAmount=returned.get(purchaseId)||0;
    const supplierId=String(purchase['Supplier ID']||'');
    const originalDue=amount(purchase['Due Amount'],'due');
    let settlement=null;
    if(supplierId && originalDue>0.004){
      settlement=settlements.get(purchaseId);
      if(!settlement)
        throw new Error('Missing verified settlement evidence for purchase '+purchaseId);
      if(String(settlement.supplierId)!==supplierId)
        throw new Error('Settlement supplier mismatch for purchase '+purchaseId);
    }
    const paidAmount=settlement
      ? amount(settlement.paidAmount,'settlement paid')
      : amount(purchase['Paid Amount'],'paid');
    const dueAmount=settlement
      ? amount(settlement.dueAmount,'settlement due')
      : originalDue;
    return {
      purchaseId:purchase['Purchase ID'],
      date:dateOnly(purchase.Date),
      supplierId:purchase['Supplier ID'],
      supplierName:purchase['Supplier Name'],
      grandTotal:grand,
      paidAmount,
      dueAmount,
      returnedAmount:returnAmount,
      netPurchase:grand-returnAmount,
      paymentStatus:settlement ? settlement.paymentStatus : purchase['Payment Status'],
      paymentMethod:purchase['Payment Method']||'Cash',
      returnStatus:returnAmount>0
        ?(returnAmount>=grand ? 'Fully Returned' : 'Partially Returned')
        :'No Return',
      notes:purchase['Notes']||'',
      editable:returnAmount===0
    };
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
