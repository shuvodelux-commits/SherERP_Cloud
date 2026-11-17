/**
 * M08 test-only imported Bank Transfer provenance audit.
 * Three read-only, tenant-bound SELECTs in a consistent local D1.batch.
 * Reconciles GAS BANK_TRANSFERS headers against exact BANK_BOOK legs.
 * Not an auth check, posting kernel, remote migration, or public API.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const ISO_DAY=/^(\d{4})-(\d{2})-(\d{2})$/;

const BANKS=`
 SELECT legacy_row,account_id FROM m08_bank_accounts
 WHERE tenant_id=? ORDER BY legacy_row
`;
const HEADERS=`
 SELECT legacy_row,transfer_id,date_text,from_account_id,
        to_account_id,amount_cents,is_deleted
 FROM m08_transfer_headers WHERE tenant_id=? ORDER BY legacy_row
`;
const BOOK=`
 SELECT legacy_row,entry_id,account_id,type,reference,
        debit_cents,credit_cents,status,reversal_of
 FROM m08_bank_book WHERE tenant_id=? ORDER BY legacy_row
`;

function requireTenant(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
    (Object.getPrototypeOf(input)!==Object.prototype &&
     Object.getPrototypeOf(input)!==null))
    throw new TypeError('Invalid M08 bank transfer audit request');
  const keys=Reflect.ownKeys(input);
  if(keys.length!==1 || keys[0]!=='tenantId'){
    throw new TypeError('Untrusted M08 bank transfer audit fields');
  }
  const descriptor=Object.getOwnPropertyDescriptor(input,'tenantId');
  if(!descriptor || !descriptor.enumerable ||
     !Object.hasOwn(descriptor,'value') ||
     typeof descriptor.value!=='string' || !ID.test(descriptor.value))
    throw new TypeError('Invalid tenant identity for bank transfer audit');
  return descriptor.value;
}
function readRows(result){
  if(result?.success!==true || !Array.isArray(result.results))
    throw new Error('M08 bank transfer D1 snapshot unavailable');
  return result.results;
}
function requireId(value,label){
  if(typeof value!=='string' || !ID.test(value))
    throw new TypeError('Unresolved '+label);
  return value;
}
function requireUnique(rows,column,label){
  const seen=new Set();
  for(const row of rows){
    const value=requireId(row[column],label);
    if(seen.has(value))throw new TypeError('Duplicate '+label);
    seen.add(value);
  }
}
function requireCents(value,label){
  if(!Number.isSafeInteger(value))
    throw new TypeError('Invalid source '+label+' cents');
  return value;
}
function validateDay(value){
  const match=typeof value==='string' && ISO_DAY.exec(value);
  if(!match)throw new TypeError('Invalid canonical bank transfer date');
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year ||
     date.getUTCMonth()+1!==month ||
     date.getUTCDate()!==day)
    throw new TypeError('Invalid canonical bank transfer date');
}
const isLeg=entry=>entry.type==='Transfer Out' || entry.type==='Transfer In';

function classify(header,legs,accountIds){
  const reasons=[];
  const out=legs.filter(x=>x.reference===header.transfer_id &&
    x.type==='Transfer Out');
  const inbound=legs.filter(x=>x.reference===header.transfer_id &&
    x.type==='Transfer In');
  if(header.from_account_id===header.to_account_id)
    reasons.push('SAME_BANK_ACCOUNT');
  if(!accountIds.has(header.from_account_id))
    reasons.push('UNKNOWN_FROM_ACCOUNT');
  if(!accountIds.has(header.to_account_id))
    reasons.push('UNKNOWN_TO_ACCOUNT');
  if(header.amount_cents<=0)reasons.push('NONPOSITIVE_AMOUNT');

  if(out.length===0)reasons.push('MISSING_OUT_LEG');
  else if(out.length>1)reasons.push('DUPLICATE_OUT_LEG');
  else {
    const row=out[0];
    if(row.account_id!==header.from_account_id)
      reasons.push('OUT_ACCOUNT_MISMATCH');
    if(row.debit_cents!==header.amount_cents || row.credit_cents!==0)
      reasons.push('OUT_AMOUNT_MISMATCH');
    if(row.status!=='Active' || row.reversal_of!=='')
      reasons.push('CORRECTED_OUT_LEG');
  }
  if(inbound.length===0)reasons.push('MISSING_IN_LEG');
  else if(inbound.length>1)reasons.push('DUPLICATE_IN_LEG');
  else {
    const row=inbound[0];
    if(row.account_id!==header.to_account_id)
      reasons.push('IN_ACCOUNT_MISMATCH');
    if(row.credit_cents!==header.amount_cents || row.debit_cents!==0)
      reasons.push('IN_AMOUNT_MISMATCH');
    if(row.status!=='Active' || row.reversal_of!=='')
      reasons.push('CORRECTED_IN_LEG');
  }

  return {
    transferId:header.transfer_id,
    fromAccountId:header.from_account_id,
    toAccountId:header.to_account_id,
    amount:header.amount_cents/100,
    status:reasons.length?'NEEDS_REVIEW':'BALANCED',
    reasons,
    outEntryId:out.length===1?out[0].entry_id:null,
    inEntryId:inbound.length===1?inbound[0].entry_id:null
  };
}

/** Read-only test proof; never authorizes source Bank Book writes. */
export async function auditD1BankTransfers(DB,request){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new TypeError('D1 M08 bank transfer audit binding unavailable');
  const tenantId=requireTenant(request);
  const result=await DB.batch([
    DB.prepare(BANKS).bind(tenantId),
    DB.prepare(HEADERS).bind(tenantId),
    DB.prepare(BOOK).bind(tenantId)
  ]);
  if(!Array.isArray(result)||result.length!==3)
    throw new Error('M08 bank transfer incomplete D1 snapshot');
  const [accounts,headers,book]=result.map(readRows);
  requireUnique(accounts,'account_id','Bank Account ID');
  requireUnique(headers,'transfer_id','Transfer ID');
  requireUnique(book,'entry_id','Bank Book Entry ID');
  const accountIds=new Set(accounts.map(x=>x.account_id));
  for(const header of headers){
    requireId(header.from_account_id,'source bank From Account ID');
    requireId(header.to_account_id,'source bank To Account ID');
    validateDay(header.date_text);
    requireCents(header.amount_cents,'transfer amount');
  }
  for(const entry of book){
    requireCents(entry.debit_cents,'book debit');
    requireCents(entry.credit_cents,'book credit');
    if(isLeg(entry)){
      requireId(entry.account_id,'Bank Book Account ID');
      requireId(entry.reference,'Bank Book Transfer reference');
    }
  }
  const activeHeaders=headers.filter(h=>h.is_deleted===0);
  const activeIds=new Set(activeHeaders.map(h=>h.transfer_id));
  const transferLegs=book.filter(isLeg);
  const transfers=activeHeaders.map(h=>classify(h,transferLegs,accountIds));
  const orphanLegs=transferLegs
    .filter(e=>!activeIds.has(e.reference))
    .map(e=>({entryId:e.entry_id,reference:e.reference,type:e.type}));
  return {
    transfers,
    orphanLegs,
    summary:{
      balanced:transfers.filter(x=>x.status==='BALANCED').length,
      needsReview:transfers.filter(x=>x.status==='NEEDS_REVIEW').length,
      orphanLegs:orphanLegs.length
    }
  };
}
