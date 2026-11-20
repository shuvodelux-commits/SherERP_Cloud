/**
 * M02 Run 11: OFFLINE Supplier payment/return source-money provenance audit.
 * The original ERP's Cash/Bank Book and Supplier Ledger are not interchangeable.
 * Only caller-supplied synthetic evidence is considered; no D1, RPC, import,
 * live ledger, private archive or posting/settlement rights are exercised.
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 */
const MAX_PAISA=9007199254740991n;
const error=()=>new Error('Supplier money provenance audit unavailable');
const isRow=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const literal=x=>typeof x==='string'&&x.trim().length>0;
const deleted=x=>x?.['Is Deleted']===true||
  String(x?.['Is Deleted']??'').trim().toUpperCase()==='TRUE';
const validRow=x=>Number.isSafeInteger(x)&&x>=2;
const KNOWN_LEDGER_TYPES=new Set([
  'Payment','Purchase','Purchase Update','Purchase Return Credit','Opening Balance'
]);
const FIELD_GROUPS=Object.freeze([
  ['suppliers','Supplier ID','SUPPLIER'],
  ['purchases','Purchase ID','PURCHASE'],
  ['purchaseReturns','Return ID','PURCHASE_RETURN'],
  ['supplierLedger','Ledger ID','SUPPLIER_LEDGER'],
  ['cashBook','Entry ID','CASH_BOOK'],
  ['bankBook','Entry ID','BANK_BOOK']
]);
function exactMoney(raw,allowBlank=false){
  if(allowBlank&&raw==='')return 0n;
  if(typeof raw!=='string')throw error();
  if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(raw))
    throw error();
  const [whole,frac='']=raw.split('.');
  const n=BigInt(whole)*100n+BigInt(frac.padEnd(2,'0'));
  if(n>MAX_PAISA)throw error();
  return n;
}
function readMoney(raw,block,code,blank=false){
  try{return exactMoney(raw,blank);}
  catch{block(code);return null;}
}
function index(rows,group,field,block){
  const byId=new Map(),duplicates=new Set(),physical=new Set();
  for(const row of rows){
    if(!validRow(row._rowIndex))block(group+'_ROW_PROVENANCE_INVALID');
    else if(physical.has(row._rowIndex))block('DUPLICATE_'+group+'_SHEET_ROW');
    else physical.add(row._rowIndex);
    const id=row[field];
    if(!literal(id)){
      block(group+'_SOURCE_ID_REQUIRED');continue;
    }
    if(byId.has(id)||duplicates.has(id)){
      block('DUPLICATE_'+group+'_SOURCE_ID');
      duplicates.add(id);
      byId.delete(id);
    }else byId.set(id,row);
    if(deleted(row)&&group!=='SUPPLIER')
      block('DELETED_'+(group==='CASH_BOOK'||group==='BANK_BOOK'?'MONEY_BOOK':group)+'_REQUIRES_REVIEW');
    const flag=row['Is Deleted'];
    if(flag!==undefined&&flag!==null&&flag!==''&&flag!==false&&flag!==true&&
       String(flag).trim().toUpperCase()!=='TRUE'&&
       String(flag).trim().toUpperCase()!=='FALSE')
      block('UNKNOWN_SOURCE_DELETE_FLAG');
  }
  return byId;
}
const countBlock=map=>code=>map.set(code,(map.get(code)||0)+1);
const relevant=(map,type,reference)=>[...map.values()].filter(x=>x.Type===type&&x.Reference===reference);
const noSide=x=>x!==null&&x===0n;
function matchBook(row,book,amount,kind,block){
  const debit=readMoney(row.Debit,block,'MONEY_BOOK_EVIDENCE_UNSUPPORTED',true);
  const credit=readMoney(row.Credit,block,'MONEY_BOOK_EVIDENCE_UNSUPPORTED',true);
  if(debit===null||credit===null)return;
  if(kind==='PAYMENT'){
    if(amount!==null&&(debit!==amount||credit!==0n))
      block('SUPPLIER_PAYMENT_BOOK_AMOUNT_MISMATCH');
  }else if(amount!==null&&(debit!==0n||credit!==amount))
    block('CASH_RETURN_REFUND_MISMATCH');
  if(book==='BANK'){
    if(!literal(row['Bank Account ID']))block('BANK_ACCOUNT_ID_REQUIRED');
    if(row.Status==='Reversed'||literal(row['Reversal Of']))
      block('REVERSED_BANK_ENTRY_REQUIRES_REVIEW');
    else if(row.Status!==undefined&&row.Status!==''&&row.Status!=='Active')
      block('BANK_ENTRY_STATUS_UNREVIEWED');
  }else if(row['Payment Method']!==undefined&&row['Payment Method']!==''&&
    row['Payment Method']!=='Cash')block('CASH_BOOK_METHOD_UNREVIEWED');
}

/**
 * Passing a shape review proves neither historical source authenticity nor
 * permission to allocate money-backed Supplier advances, pay refunds or post
 * entries. Returned information is aggregate-only; never logs real source IDs.
 */
export function auditSupplierPaymentReturnBacking(input){
  if(!isRow(input)||!literal(input.shopId)||input.shopId.trim()!==input.shopId||
     FIELD_GROUPS.some(([field])=>!Array.isArray(input[field])||
       input[field].some(row=>!isRow(row))))
    throw error();
  const errors=new Map(),block=countBlock(errors);
  const data={};
  for(const [field,idField,group] of FIELD_GROUPS)
    data[field]=index(input[field],group,idField,block);
  const suppliers=data.suppliers,purchases=data.purchases,
    returns=data.purchaseReturns,ledger=data.supplierLedger,
    cash=data.cashBook,bank=data.bankBook;
  const counts={
    supplierPaymentRows:0,cashPaymentLegs:0,bankPaymentLegs:0,
    cashReturnRefunds:0,noncashSupplierCreditReturns:0,
    discountsRequiringReview:0
  };
  const payments=new Map();
  for(const [id,row] of ledger){
    if(!KNOWN_LEDGER_TYPES.has(row.Type)){
      block('LEDGER_TYPE_UNREVIEWED');continue;
    }
    if(row.Type!=='Payment')continue;
    counts.supplierPaymentRows++;
    payments.set(id,row);
    if(!suppliers.has(row['Supplier ID']))
      block('PAYMENT_SUPPLIER_REFERENCE_MISSING');
    if(row.Reference!=='PAYMENT')block('PAYMENT_LEDGER_REFERENCE_UNREVIEWED');
    const method=row['Payment Method'];
    if(method===''||method===undefined||method===null)
      block('LEGACY_PAYMENT_METHOD_UNVERIFIED');
    else if(!['Cash','Bank','Mobile Banking'].includes(method))
      block('PAYMENT_METHOD_UNSUPPORTED');
    let payment=null;
    if(row['Payment Amount']===''||row['Payment Amount']===undefined)
      block('PAYMENT_AMOUNT_UNATTRIBUTED');
    else payment=readMoney(row['Payment Amount'],block,'PAYMENT_MONEY_EVIDENCE_UNSUPPORTED');
    const discount=readMoney(row['Discount Amount'],block,
      'PAYMENT_MONEY_EVIDENCE_UNSUPPORTED',true);
    const credit=readMoney(row.Credit,block,'PAYMENT_MONEY_EVIDENCE_UNSUPPORTED',true);
    const debit=readMoney(row.Debit,block,'PAYMENT_MONEY_EVIDENCE_UNSUPPORTED',true);
    if(payment!==null&&payment===0n)block('PAYMENT_AMOUNT_NONPOSITIVE');
    if(discount!==null&&discount>0n){
      counts.discountsRequiringReview++;
      if(!literal(row['Discount Reason']))block('DISCOUNT_REASON_REQUIRED');
      block('DISCOUNT_AUTHORITY_UNVERIFIED');
    }
    if(payment!==null&&discount!==null&&credit!==null&&debit!==null&&
      (debit!==0n||credit!==payment+discount))
      block('PAYMENT_TOTAL_NOT_CONSERVED');
    const cashLegs=relevant(cash,'Supplier Payment',id);
    const bankLegs=relevant(bank,'Supplier Payment',id);
    if(cashLegs.length+bankLegs.length>1)
      block('DUPLICATE_SUPPLIER_PAYMENT_LEG');
    const bankLike=method==='Bank'||method==='Mobile Banking';
    const target=bankLike?bankLegs:cashLegs;
    const foreign=bankLike?cashLegs:bankLegs;
    if(foreign.length)block('PAYMENT_MONEY_BOOK_MISMATCH');
    if(!target.length)block('PAYMENT_MONEY_BACKING_MISSING');
    for(const b of target){
      if(bankLike)counts.bankPaymentLegs++;
      else counts.cashPaymentLegs++;
      matchBook(b,bankLike?'BANK':'CASH',payment,'PAYMENT',block);
      // Original BankLedger.gs writes a linked Reversal Of mirror and
      // can preserve both rows; never count the original as still
      // independently money-backed, even if its status is stale.
      if(bankLike&&[...bank.values()].some(row=>row['Reversal Of']===b['Entry ID']))
        block('REVERSED_BANK_ENTRY_REQUIRES_REVIEW');
    }
  }

  for(const entry of cash.values()){
    if(entry.Type==='Supplier Payment'&&!payments.has(entry.Reference))
      block('ORPHAN_SUPPLIER_PAYMENT_BOOK');
  }
  for(const entry of bank.values()){
    if(entry.Type==='Supplier Payment'&&!payments.has(entry.Reference))
      block('ORPHAN_SUPPLIER_PAYMENT_BOOK');
  }
  const creditLedgers=[...ledger.values()].filter(row=>row.Type==='Purchase Return Credit');
  for(const row of creditLedgers){
    if(!returns.has(row.Reference))
      block('ORPHAN_SUPPLIER_RETURN_CREDIT');
  }
  for(const [id,row] of returns){
    const purchase=purchases.get(row['Purchase ID']);
    if(!purchase)block('RETURN_PURCHASE_REFERENCE_MISSING');
    else if(purchase['Supplier ID']!==row['Supplier ID'])
      block('RETURN_SUPPLIER_MISMATCH');
    if(!suppliers.has(row['Supplier ID']))
      block('RETURN_SUPPLIER_REFERENCE_MISSING');
    const money=readMoney(row['Total Return Amount'],block,
      'RETURN_MONEY_EVIDENCE_UNSUPPORTED');
    if(money===0n)block('RETURN_AMOUNT_NONPOSITIVE');
    const cashReturns=relevant(cash,'Purchase Return',id),
      bankReturns=relevant(bank,'Purchase Return',id),
      creditRows=creditLedgers.filter(x=>x.Reference===id);
    if(row['Refund Method']==='Cash'){
      if(!cashReturns.length)block('CASH_RETURN_REFUND_MISSING');
      if(cashReturns.length>1)block('DUPLICATE_PURCHASE_REFUND_LEG');
      if(bankReturns.length)block('CASH_RETURN_HAS_UNREVIEWED_BANK_BOOK');
      if(creditRows.length)block('CASH_RETURN_HAS_NONCASH_LEDGER');
      for(const entry of cashReturns){
        counts.cashReturnRefunds++;
        matchBook(entry,'CASH',money,'REFUND',block);
      }
    }else if(row['Refund Method']==='Supplier Credit'){
      counts.noncashSupplierCreditReturns++;
      if(cashReturns.length||bankReturns.length)
        block('NONCASH_RETURN_HAS_MONEY_BOOK');
      if(!creditRows.length)block('SUPPLIER_CREDIT_LEDGER_MISSING');
      if(creditRows.length>1)block('DUPLICATE_SUPPLIER_CREDIT_LEDGER');
      for(const creditRow of creditRows){
        const debit=readMoney(creditRow.Debit,block,'LEDGER_MONEY_EVIDENCE_UNSUPPORTED',true);
        const credit=readMoney(creditRow.Credit,block,'LEDGER_MONEY_EVIDENCE_UNSUPPORTED',true);
        if(creditRow['Supplier ID']!==row['Supplier ID']||
           (debit!==null&&debit!==0n)||
           (credit!==null&&money!==null&&credit!==money))
          block('RETURN_CREDIT_LEDGER_MISMATCH');
      }
    }else block('RETURN_REFUND_METHOD_UNREVIEWED');
  }
  for(const row of cash.values()){
    if(row.Type==='Purchase Return'&&!returns.has(row.Reference))
      block('ORPHAN_PURCHASE_REFUND_BOOK');
  }
  for(const row of bank.values()){
    if(row.Type==='Purchase Return'&&!returns.has(row.Reference))
      block('ORPHAN_PURCHASE_REFUND_BOOK');
  }
  const blockers=[...errors].sort(([a],[b])=>a.localeCompare(b))
    .map(([code,count])=>({code,count}));
  return {
    candidateReady:blockers.length===0,
    counts,blockers,
    sourceAuthenticityVerified:false,
    cashAdvanceAllocationVerified:false,
    cashRefundEntitlementVerified:false,
    postingAuthorized:false
  };
}
