/**
 * M02 Run 12 — pure OFFLINE original Bank Account and Bank Book source audit.
 *
 * Frozen original: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * No real archive, staging/prod D1, Worker, RPC, ledger writer or permission.
 *
 * Bank Book Debit is money OUT; Credit is money IN. The original optional
 * Opening Balance backfill is explanatory and may be appended LATER without
 * affecting Current Balance; never count it as a second financial movement.
 */
const MAX_PAISA=9007199254740991n;
const unavailable=()=>new Error('Historical Bank Account audit unavailable');
const isRecord=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const nonblank=x=>typeof x==='string'&&x.trim().length>0;
const validRow=x=>Number.isSafeInteger(x)&&x>=2;
const isDeleted=x=>x?.['Is Deleted']===true||
  String(x?.['Is Deleted']??'').trim().toUpperCase()==='TRUE';
function exactMoney(raw,signed=false,blank=false){
  if(blank&&raw==='')return 0n;
  if(typeof raw!=='string')throw unavailable();
  if(!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(raw))throw unavailable();
  const negative=raw.startsWith('-'),m=negative?raw.slice(1):raw;
  if(negative&&!signed)throw unavailable();
  const [whole,fraction='']=m.split('.');
  const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(amount>MAX_PAISA||(negative&&amount===0n))throw unavailable();
  return negative?-amount:amount;
}
const flagger=issues=>code=>issues.set(code,(issues.get(code)||0)+1);
const amount=(raw,block,signed=false,blank=false)=>{
  try{return exactMoney(raw,signed,blank);}
  catch{block('BANK_MONEY_EVIDENCE_UNSUPPORTED');return null;}
};
function buildIndex(rows,field,prefix,block){
  const ids=new Map(),seenIds=new Set(),seenRows=new Set();
  for(const row of rows){
    if(!validRow(row._rowIndex))block(prefix+'_ROW_PROVENANCE_INVALID');
    else if(seenRows.has(row._rowIndex))block(prefix+'_ROW_DUPLICATE');
    else seenRows.add(row._rowIndex);
    const id=row[field];
    if(!nonblank(id)){
      block(prefix+'_SOURCE_ID_REQUIRED');
    }else if(seenIds.has(id)){
      block(prefix+'_SOURCE_ID_DUPLICATE');
      // Retain first solely to continue redacted diagnostics; this does NOT
      // accept or choose a source row because candidateReady is false.
    }else{
      seenIds.add(id);
      ids.set(id,row);
    }
    if(isDeleted(row))block(prefix+'_DELETED_REQUIRES_REVIEW');
  }
  return ids;
}
const safeAdd=(left,right,block)=>{
  if(left===null||right===null)return null;
  const sum=left+right;
  if(sum>MAX_PAISA||sum< -MAX_PAISA){
    block('BANK_RUNNING_SUM_UNSAFE');return null;
  }
  return sum;
};
function inspectReversals(book,block){
  const byTarget=new Map();
  for(const row of book.values()){
    const targetId=row['Reversal Of'];
    if(!nonblank(targetId))continue;
    if(!byTarget.has(targetId))byTarget.set(targetId,[]);
    byTarget.get(targetId).push(row);
    const original=book.get(targetId);
    if(!original){
      block('BANK_REVERSAL_TARGET_MISSING');continue;
    }
    if(original['Bank Account ID']!==row['Bank Account ID'])
      block('BANK_REVERSAL_ACCOUNT_MISMATCH');
    if(original.Status!=='Reversed')
      block('BANK_REVERSAL_ORIGINAL_STATUS_INVALID');
    if(row.Status!=='Active')
      block('BANK_REVERSAL_MIRROR_STATUS_INVALID');
    if(row.Type!=='Reversal')
      block('BANK_REVERSAL_TYPE_INVALID');
    if(!validRow(original._rowIndex)||!validRow(row._rowIndex)||
       row._rowIndex<=original._rowIndex)
      block('BANK_REVERSAL_ORDER_UNVERIFIED');
    if(row.Reference!==original['Entry ID'])
      block('BANK_REVERSAL_REFERENCE_MISMATCH');
    const originDebit=amount(original.Debit,block,false,true),
      originCredit=amount(original.Credit,block,false,true),
      mirrorDebit=amount(row.Debit,block,false,true),
      mirrorCredit=amount(row.Credit,block,false,true);
    if([originDebit,originCredit,mirrorDebit,mirrorCredit].every(x=>x!==null)&&
       (originDebit!==mirrorCredit||originCredit!==mirrorDebit))
      block('BANK_REVERSAL_AMOUNT_MISMATCH');
  }
  for(const [id,rows] of byTarget){
    if(rows.length>1)block('BANK_REVERSAL_DUPLICATE_TARGET');
  }
  for(const [id,row] of book){
    if(row.Type==='Reversal'&&!nonblank(row['Reversal Of']))
      block('BANK_REVERSAL_TARGET_MISSING');
    if(row.Status==='Reversed'&&!byTarget.has(id)&&row.Type!=='Opening Balance')
      block('BANK_VOID_PROVENANCE_UNVERIFIED');
  }
  return byTarget;
}
/**
 * No account ownership is inferred from a matching name/phone/account
 * number or even an exact source ID. The input is a caller-provided synthetic
 * snapshot and the only return values are fixed codes and aggregate counts.
 */
export function auditBankMasterSourceBalance(input){
  if(!isRecord(input)||!nonblank(input.shopId)||
     input.shopId!==input.shopId.trim()||
     !Array.isArray(input.bankAccounts)||!Array.isArray(input.bankBook)||
     input.bankAccounts.some(x=>!isRecord(x))||
     input.bankBook.some(x=>!isRecord(x)))throw unavailable();
  const issues=new Map(),block=flagger(issues);
  const accounts=buildIndex(input.bankAccounts,'Bank Account ID','BANK_ACCOUNT',block);
  const book=buildIndex(input.bankBook,'Entry ID','BANK_BOOK',block);
  for(const row of accounts.values()){
    if(row.Status!=='Active'&&row.Status!=='Inactive')
      block('BANK_ACCOUNT_STATUS_UNREVIEWED');
  }
  for(const row of book.values()){
    if(row.Status!=='Active'&&row.Status!=='Reversed')
      block('BANK_BOOK_STATUS_UNREVIEWED');
    if(!nonblank(row.Type))block('BANK_BOOK_TYPE_REQUIRED');
    if(!accounts.has(row['Bank Account ID']))
      block('BANK_BOOK_ACCOUNT_MISSING');
  }
  const reversals=inspectReversals(book,block);
  const rowsByAccount=new Map();
  for(const row of book.values()){
    const id=row['Bank Account ID'];
    if(!accounts.has(id))continue;
    if(!rowsByAccount.has(id))rowsByAccount.set(id,[]);
    rowsByAccount.get(id).push(row);
  }
  const counts={
    bankAccounts:input.bankAccounts.length,bankBookRows:input.bankBook.length,
    openingBackfillRows:0,pairedReversals:0,unpairedVoids:0,
    supplierPaymentBankRows:0
  };
  for(const row of book.values()){
    if(row.Type==='Opening Balance')counts.openingBackfillRows++;
    if(row.Type==='Supplier Payment')counts.supplierPaymentBankRows++;
    if(nonblank(row['Reversal Of']))counts.pairedReversals++;
    if(row.Status==='Reversed'&&!reversals.has(row['Entry ID'])&&
       row.Type!=='Opening Balance')counts.unpairedVoids++;
  }
  for(const [id,master] of accounts){
    const opening=amount(master['Opening Balance'],block);
    const current=amount(master['Current Balance'],block,true);
    const rows=(rowsByAccount.get(id)||[])
      .sort((a,b)=>a._rowIndex-b._rowIndex);
    const openingRows=rows.filter(row=>row.Type==='Opening Balance');
    if(openingRows.length>1)block('BANK_OPENING_DUPLICATE');
    for(const row of openingRows){
      if(row.Reference!==id)block('BANK_OPENING_REFERENCE_MISMATCH');
      if(row.Status!=='Active'||nonblank(row['Reversal Of']))
        block('BANK_OPENING_STATUS_UNREVIEWED');
      const debit=amount(row.Debit,block,false,true);
      const credit=amount(row.Credit,block,false,true);
      const reported=amount(row.Balance,block,true);
      if(opening!==null&&debit!==null&&credit!==null&&
         (debit!==0n||credit!==opening))
        block('BANK_OPENING_AMOUNT_MISMATCH');
      if(opening!==null&&reported!==null&&opening!==reported)
        block('BANK_OPENING_BALANCE_MISMATCH');
    }
    // Opening backfill rows must not be summed as account money. The original
    // BANK_ACCOUNTS balance already contains this figure from creation.
    let running=opening;
    for(const row of rows){
      if(row.Type==='Opening Balance')continue;
      const debit=amount(row.Debit,block,false,true);
      const credit=amount(row.Credit,block,false,true);
      const recorded=amount(row.Balance,block,true);
      if(debit===null||credit===null||recorded===null)continue;
      if(debit>0n&&credit>0n)block('BANK_BOOK_BOTH_SIDES');
      if(debit===0n&&credit===0n)block('BANK_BOOK_ZERO_MOVEMENT_UNREVIEWED');
      // DeleteEngine voids have no reversal mirror; they no longer count as
      // current money but require independent deletion audit provenance.
      if(row.Status==='Reversed'&&!reversals.has(row['Entry ID']))continue;
      if(row.Status!=='Active'&&row.Status!=='Reversed')continue;
      running=safeAdd(running,credit-debit,block);
      if(running!==null&&running!==recorded)
        block('BANK_STORED_POSTING_BALANCE_MISMATCH');
    }
    if(running!==null&&current!==null&&running!==current)
      block('BANK_CURRENT_BALANCE_MISMATCH');
  }
  const blockers=[...issues].sort(([a],[b])=>a.localeCompare(b))
    .map(([code,count])=>({code,count}));
  return {
    candidateReady:blockers.length===0,
    counts,blockers,
    historicalSourceVerified:false,
    bankAccountOwnershipVerified:false,
    d1Reconciled:false,
    moneyPostingAuthorized:false
  };
}
