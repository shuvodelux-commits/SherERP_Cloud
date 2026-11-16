/**
 * M07-B: read-only, source-shaped Sales Return edit/delete evidence preflight.
 *
 * Frozen source: Mohim_ERP@29aa4a5 SalesReturn.gs::prepareSalesReturnChange_
 * and DeleteEngine.gs::isDeleted_. Never use this result as posting authority:
 * authenticated actor/tenant, source rows, locks and balances must be rechecked
 * by the single M03/M04/M05/M06/M08 atomic transaction owner.
 */
const key=row=>String(row??'').trim();
const isDeleted=row=>row?.['Is Deleted']===true||
  String(row?.['Is Deleted']??'').toUpperCase()==='TRUE';
const active=rows=>rows.filter(row=>!isDeleted(row));
const roundMoney=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
const money=value=>Number(value)||0;
const OPERATION_ID=/^[A-Za-z0-9_-]{12,100}$/;
const safeObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function verifySnapshot(snapshot){
  if(!safeObject(snapshot))throw new TypeError('Invalid Sales Return correction snapshot');
  for(const name of ['returnHeaders','sales','returnItems','cashBook',
    'customerLedger','customers','cashSessions']){
    const rows=snapshot[name];
    if(!Array.isArray(rows)||rows.some(row=>!safeObject(row)))
      throw new TypeError('Invalid Sales Return correction '+name+' rows');
  }
}

/**
 * Return only historical evidence needed by a *future* authorized, atomic
 * correction writer. No SQL or GAS I/O is performed here.
 *
 * snapshot: normalized, trusted M03 read-model rows, retaining source IDs and
 * _rowIndex; historicalSession is a trusted M08 lookup for original Created At.
 * options.activeCashSessionOpen signals a previously successful *policy gate*,
 * not independently verified caller identity. M04 must authorize inside SQL.
 */
export function planSalesReturnCorrectionEvidence(snapshot,options){
  verifySnapshot(snapshot);
  if(!safeObject(options))throw new TypeError('Invalid Sales Return correction request');
  const {mode,returnId,payload={},activeCashSessionOpen}=options;
  if(mode!=='Edit'&&mode!=='Delete')
    throw new Error('Unsupported return correction operation.');
  const id=key(returnId);
  if(!id)throw new Error('Return ID is required.');
  if(!safeObject(payload))throw new TypeError('Invalid Sales Return correction payload');

  const matches=snapshot.returnHeaders.filter(row=>String(row['Return ID'])===id);
  if(matches.length!==1)
    throw new Error(matches.length?'Duplicate Sales Return ID. Needs Review.':'Sales Return not found.');
  const original=matches[0];
  if(isDeleted(original))throw new Error('This Sales Return was deleted.');
  // Permission and historical-date delete authority belong to M04, not here.
  if(activeCashSessionOpen!==true)
    throw new Error('An active Cash Session is required.');
  if(snapshot.cashSessions.length &&
    (!safeObject(snapshot.historicalSession)||
      snapshot.historicalSession['Status']!=='Open'))
    throw new Error('Original return Cash Session is closed. Manual reconciliation required.');

  const expectedVersion=money(original['Edit Version']);
  if(payload.expectedVersion!==undefined&&Number(payload.expectedVersion)!==expectedVersion)
    throw new Error('Sales Return changed since it was opened. Reload before correcting.');
  const reason=key(mode==='Delete'?payload.reason:payload.editReason);
  if(!reason)throw new Error(mode+' reason is required.');
  if(payload.operationId!==undefined&&!OPERATION_ID.test(String(payload.operationId)))
    throw new Error('Valid immutable return correction operation ID required.');

  const invoiceId=String(original['Invoice ID']);
  const saleMatches=snapshot.sales.filter(row=>String(row['Invoice ID'])===invoiceId);
  if(saleMatches.length>1)
    throw new Error('Duplicate invoice ID detected: '+invoiceId+
      '. This invoice must be repaired before View, Update, Delete or Return actions can continue.');
  const sale=saleMatches[0];
  if(!sale||isDeleted(sale))
    throw new Error('Source invoice is missing or deleted. Needs Review.');

  const items=active(snapshot.returnItems).filter(row=>String(row['Return ID'])===id);
  if(!items.length)throw new Error('Return has no active product lines. Needs Review.');

  const oldAmount=roundMoney(money(original['Total Return Amount']));
  const refundMethod=String(original['Refund Method']||'');
  let moneyUndo;
  if(refundMethod==='Cash'){
    const cash=active(snapshot.cashBook).filter(row=>
      String(row['Reference'])===id&&row['Type']==='Sales Return');
    if(cash.length!==1||
      Math.abs(money(cash[0]['Debit'])-oldAmount)>0.005||
      Number(cash[0]['Credit']||0)!==0)
      throw new Error('Original Cash refund evidence is missing or inconsistent. Needs Review.');
    if(!Number.isSafeInteger(cash[0]._rowIndex)||cash[0]._rowIndex<1)
      throw new Error('Original Cash refund evidence is missing or inconsistent. Needs Review.');
    moneyUndo={kind:'Cash',rowIndex:cash[0]._rowIndex,amount:oldAmount};
  }else if(refundMethod==='Store Credit'){
    const credits=active(snapshot.customerLedger).filter(row=>
      String(row['Reference'])===id&&row['Type']==='Sales Return Credit');
    if(credits.length!==1||
      Math.abs(money(credits[0]['Credit'])-oldAmount)>0.005)
      throw new Error('Original Store Credit evidence is missing or inconsistent. Needs Review.');
    const credit=credits[0],customerId=String(original['Customer ID']||'');
    if(!customerId||String(credit['Customer ID'])!==customerId)
      throw new Error('Store Credit customer attribution mismatch. Needs Review.');
    if(!Number.isSafeInteger(credit._rowIndex)||credit._rowIndex<1)
      throw new Error('Original Store Credit evidence is missing or inconsistent. Needs Review.');
    const later=active(snapshot.customerLedger).some(row=>
      String(row['Customer ID'])===customerId&&row._rowIndex>credit._rowIndex);
    if(later)
      throw new Error('Later customer settlement/ledger entries exist; reconcile Store Credit first.');
    const customers=active(snapshot.customers).filter(row=>
      String(row['Customer ID'])===customerId);
    if(customers.length!==1)
      throw new Error('Store Credit customer missing or ambiguous. Needs Review.');
    moneyUndo={kind:'Store Credit',rowIndex:credit._rowIndex,
      customerId,amount:oldAmount};
  }else{
    throw new Error('Unsupported historical refund method. Needs Review.');
  }

  const batchId=String(original['Batch ID']||'');
  if(mode==='Edit'&&batchId){
    const siblings=active(snapshot.returnHeaders).filter(row=>
      String(row['Batch ID']||'')===batchId&&String(row['Return ID'])!==id);
    if(siblings.some(row=>String(row['Refund Method']||'')!==String(payload.refundMethod||'')))
      throw new Error('Mixed-method Sales Return batch is not supported. Correct each child using the batch refund method, or resolve sibling returns first.');
  }

  let needsStockChange=mode==='Delete';
  if(mode==='Edit'){
    if(!Array.isArray(payload.items)||!payload.items.length)
      throw new Error('Return correction requires at least one item.');
    if(payload.refundMethod!=='Cash'&&payload.refundMethod!=='Store Credit')
      throw new Error('Choose a valid return refund method.');
    const oldQty=new Map(),newQty=new Map();
    for(const item of items){
      const p=String(item['Product ID']);
      const qty=Number(item['Return Quantity']||0);
      if(!Number.isFinite(qty)||qty<=0)throw new Error('Original return item quantity is invalid. Needs Review.');
      oldQty.set(p,(oldQty.get(p)||0)+qty);
    }
    for(const item of payload.items){
      if(!safeObject(item))throw new Error('Invalid return correction item.');
      const p=String(item.productId||''),qty=Number(item.qty||0);
      if(!p||!Number.isFinite(qty)||qty<=0)
        throw new Error('Invalid return correction item quantity.');
      newQty.set(p,(newQty.get(p)||0)+qty);
    }
    needsStockChange=[...new Set([...oldQty.keys(),...newQty.keys()])]
      .some(p=>Math.abs((oldQty.get(p)||0)-(newQty.get(p)||0))>1e-8);
    if(payload.refundMethod==='Store Credit'&&!String(sale['Customer ID']||''))
      throw new Error('Editing to Store Credit requires an existing customer account.');
  }

  return Object.freeze({
    returnId:id,invoiceId,customerId:String(original['Customer ID']||''),
    mode,expectedVersion,refundMethod,oldAmount,batchId,
    originalItemCount:items.length,needsStockChange,
    moneyUndo:Object.freeze(moneyUndo)
  });
}
