/**
 * M02-P INTERNAL OFFLINE-only gross checkpoint parity.
 * Frozen GAS source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * Never reads D1, posts money, authorizes identity or approves cutover.
 */
const sourceCommit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const sourceGroups=new Set(['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS']);
const kinds=new Set([
  'CUSTOMER_RECEIVABLE','CUSTOMER_ADVANCE',
  'SUPPLIER_PAYABLE','SUPPLIER_ADVANCE',
  'VENDOR_PAYABLE','VENDOR_RECEIVABLE',
  'OWNER_EQUITY','OWNER_ADVANCE',
  'LENDER_LOAN_PAYABLE','LENDER_CREDIT',
  'BORROWER_LOAN_RECEIVABLE','BORROWER_CREDIT'
]);
const fields=new Set([
  'Current Due','Current Receivable','Opening Balance',
  'FINANCE_TRANSACTIONS.Amount'
]);
const rowFields=['partyId','sourceGroup','sourceId','kind','sourceField','basis','amountMinor'];
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||
    Object.getPrototypeOf(x)===null);
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
const issue=(stage,code,count=1)=>({stage,code,count});
const sorted=(a,b)=>a.stage.localeCompare(b.stage)||a.code.localeCompare(b.code);
const add=(items,stage,code,count=1)=>{
  if(count>0)items.push(issue(stage,code,count));
};
const identity=row=>JSON.stringify([
  row.partyId,row.sourceGroup,row.sourceId,row.kind,row.sourceField,row.basis
]);
function validateRow(row,basis){
  if(!plain(row)||Object.keys(row).length!==rowFields.length||
     rowFields.some(field=>!Object.hasOwn(row,field))||
     !nonempty(row.partyId)||!nonempty(row.sourceId)||
     !sourceGroups.has(row.sourceGroup)||!kinds.has(row.kind)||
     !fields.has(row.sourceField)||row.basis!==basis||
     !Number.isSafeInteger(row.amountMinor)||row.amountMinor<=0)
    throw new Error('Invalid checkpoint');
}
function index(rows,basis){
  const found=new Map();
  let duplicates=0;
  for(const row of rows){
    validateRow(row,basis);
    const key=identity(row);
    if(found.has(key))duplicates++;
    else found.set(key,row);
  }
  return {found,duplicates};
}
function totalsMatch(rows,sourceTotals){
  if(!plain(sourceTotals))throw new Error('Invalid source gross totals');
  const totals=new Map();
  for(const row of rows){
    const value=(totals.get(row.kind)||0)+row.amountMinor;
    if(!Number.isSafeInteger(value))throw new Error('Unsafe gross total');
    totals.set(row.kind,value);
  }
  const entries=Object.entries(sourceTotals);
  return entries.length===totals.size&&entries.every(([kind,value])=>
    kinds.has(kind)&&Number.isSafeInteger(value)&&value>0&&
      totals.get(kind)===value);
}
function compare(expected,actual,stage,items){
  const seen=index(actual,stage);
  add(items,stage,'DUPLICATE_CHECKPOINT',seen.duplicates);
  for(const [key,row] of expected){
    const other=seen.found.get(key);
    if(!other)add(items,stage,'MISSING_CHECKPOINT');
    else if(other.amountMinor!==row.amountMinor)
      add(items,stage,'AMOUNT_MISMATCH');
  }
  for(const key of seen.found.keys()){
    if(!expected.has(key))add(items,stage,'EXTRA_CHECKPOINT');
  }
}
function aggregate(items){
  const counts=new Map();
  for(const {stage,code,count} of items){
    const key=JSON.stringify([stage,code]);
    counts.set(key,(counts.get(key)||0)+count);
  }
  return [...counts].map(([key,count])=>{
    const [stage,code]=JSON.parse(key);
    return issue(stage,code,count);
  }).sort(sorted);
}

/** Compares private preflight and independently SUPPLIED private readback. */
export function reconcileGrossPartyCheckpoints(input={}){
  try{
    const {preflight,readback}=input;
    if(!plain(preflight)||!Array.isArray(preflight.blockingIssues)||
      !Array.isArray(preflight.currentCheckpoints)||
      !Array.isArray(preflight.openingCheckpoints)||
      !plain(preflight.summary)||!plain(preflight.summary.effects))
      throw new Error('Invalid gross plan');
    const current=preflight.currentCheckpoints;
    const opening=preflight.openingCheckpoints;
    const counts={
      expectedCurrent:current.length,observedCurrent:null,
      expectedOpening:opening.length,observedOpening:null
    };
    const issues=[];
    const expectedCurrent=index(current,'SOURCE_CURRENT');
    const expectedOpening=index(opening,'HISTORICAL_OPENING');
    if(preflight.formatVersion!==1||
       preflight.sourceCommit!==sourceCommit||
       preflight.currency!=='BDT')
      add(issues,'PLAN','PLAN_SOURCE_MISMATCH');
    if(preflight.readyForAccountDesignReview!==true||
       preflight.blockingIssues.length>0||
       preflight.summary.pendingIdentityReviews!==0)
      add(issues,'PLAN','PLAN_BLOCKED');
    if(preflight.summary.currentCheckpointCount!==current.length||
       preflight.summary.historicalOpeningCheckpointCount!==opening.length)
      add(issues,'PLAN','PLAN_COUNT_MISMATCH');
    if(Object.values(preflight.summary.effects).length!==3||
       ['cashMovementMinor','bankMovementMinor','postedLedgerRows'].some(
         key=>preflight.summary.effects[key]!==0))
      add(issues,'PLAN','PLAN_EFFECTS_UNSAFE');
    if(!totalsMatch(current,preflight.grossCurrentTotalsMinor)||
       !totalsMatch(opening,preflight.grossOpeningTotalsMinor))
      add(issues,'PLAN','PLAN_TOTAL_MISMATCH');
    add(issues,'PLAN','PLAN_DUPLICATE_CHECKPOINT',
      expectedCurrent.duplicates+expectedOpening.duplicates);
    if(issues.length>0){
      return {
        formatVersion:1,sourcePlanValid:false,readbackChecked:false,
        currentMatch:null,openingMatch:null,offlineCheckpointParity:false,
        counts,issues:aggregate(issues)
      };
    }
    if(!plain(readback)||!Array.isArray(readback.currentCheckpoints)||
       !Array.isArray(readback.openingCheckpoints))
      throw new Error('Invalid checkpoint readback');
    counts.observedCurrent=readback.currentCheckpoints.length;
    counts.observedOpening=readback.openingCheckpoints.length;
    compare(expectedCurrent.found,readback.currentCheckpoints,'SOURCE_CURRENT',issues);
    compare(expectedOpening.found,readback.openingCheckpoints,'HISTORICAL_OPENING',issues);
    const currentMatch=!issues.some(i=>i.stage==='SOURCE_CURRENT');
    const openingMatch=!issues.some(i=>i.stage==='HISTORICAL_OPENING');
    return {
      formatVersion:1,sourcePlanValid:true,readbackChecked:true,
      currentMatch,openingMatch,
      offlineCheckpointParity:currentMatch&&openingMatch,
      counts,issues:aggregate(issues)
    };
  }catch{
    // Source IDs, phone, amounts and client exceptions must never escape.
    throw new Error('Gross checkpoint parity unavailable');
  }
}
