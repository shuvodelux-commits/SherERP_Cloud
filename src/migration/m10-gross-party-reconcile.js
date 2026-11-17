/**
 * M10-14: pure OFFLINE per-source-account gross financial checkpoint comparator.
 * Supplied evidence only: never open original Sheets, D1, or any posting path.
 * Preserve gross Party accounts and independent historical/current baselines.
 */
const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const INVALID='M10 gross Party evidence invalid';
const LIMITS='Supplied account commitments and balances are not independently captured source/D1 proof, approved identity links or migration authorization';
const HEX=/^[0-9a-f]{64}$/;
const TOKEN=/^[A-Za-z0-9_-]{8,64}$/;
const UTC=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const MINOR=/^(?:0|[1-9][0-9]{0,37}|-[1-9][0-9]{0,37})$/;
const FIELDS=['source','d1','identityReviewsPending','sourcePlanReviewed'];
const SNAPSHOT=['captureId','capturedAt','sourceCommit','accounts'];
const ROW=['sourceGroup','legacyIdDigest','accountKind','contractDigest',
  'basis','currency','balanceMinor'];
const KINDS=Object.freeze({
  CUSTOMERS:new Set(['CUSTOMER_AR','CUSTOMER_ADVANCE']),
  SUPPLIERS:new Set(['SUPPLIER_AP','SUPPLIER_ADVANCE']),
  VENDORS:new Set(['VENDOR_AP','VENDOR_AR']),
  FINANCE_PERSONS:new Set([
    'OWNER_EQUITY','OWNER_DRAWINGS','LENDER_LOAN_AP','BORROWER_LOAN_AR'
  ])
});
const fail=()=>{throw new Error(INVALID);};

/** Never access caller-supplied values until their descriptors are verified. */
function safe(value,fields,partial=false){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
  const keys=Reflect.ownKeys(value);
  if((!partial&&keys.length!==fields.length)||
     keys.some(k=>typeof k!=='string'||!fields.includes(k)))fail();
  for(const k of partial?keys:fields){
    const d=Object.getOwnPropertyDescriptor(value,k);
    if(d?.enumerable!==true||!Object.hasOwn(d,'value'))fail();
  }
  return value;
}
const time=s=>typeof s==='string'&&UTC.test(s)&&
  !Number.isNaN(Date.parse(s))&&new Date(s).toISOString()===s;
const name=s=>typeof s==='string'&&TOKEN.test(s);
const nonneg=n=>Number.isSafeInteger(n)&&n>=0;

function parseSnapshot(value,side,add){
  if(value===undefined){
    add(side==='SOURCE'?'GROSS_SOURCE_EVIDENCE_MISSING':'GROSS_D1_EVIDENCE_MISSING');
    return null;
  }
  safe(value,SNAPSHOT);
  if(!name(value.captureId)||!time(value.capturedAt)||
     value.sourceCommit!==PIN||
     !Array.isArray(value.accounts)||value.accounts.length>100000)fail();

  const index=new Map(),basis=new Map();
  for(const raw of value.accounts){
    const row=safe(raw,ROW);
    if(!Object.hasOwn(KINDS,row.sourceGroup)||
      !KINDS[row.sourceGroup].has(row.accountKind)||
      typeof row.legacyIdDigest!=='string'||!HEX.test(row.legacyIdDigest)||
      typeof row.contractDigest!=='string'||!HEX.test(row.contractDigest)||
      !['OPENING','CURRENT'].includes(row.basis)||
      row.currency!=='BDT'||
      typeof row.balanceMinor!=='string'||!MINOR.test(row.balanceMinor))fail();

    const accountKey=[
      row.sourceGroup,row.legacyIdDigest,row.accountKind,row.contractDigest
    ].join('|');
    const key=accountKey+'|'+row.basis;
    if(index.has(key)){
      add(side==='SOURCE'?'GROSS_ACCOUNT_DUPLICATE_SOURCE':
        'GROSS_ACCOUNT_DUPLICATE_D1');
      continue;
    }
    // The immutable source identity and contract are opaque commitments.
    // No global netting is ever calculated or returned.
    index.set(key,{value:BigInt(row.balanceMinor),basis:row.basis});
    if(!basis.has(accountKey))basis.set(accountKey,new Set());
    basis.get(accountKey).add(row.basis);
  }
  for(const modes of basis.values())if(modes.size!==2)
    add(side==='SOURCE'?'GROSS_ACCOUNT_BASIS_INCOMPLETE_SOURCE':
      'GROSS_ACCOUNT_BASIS_INCOMPLETE_D1');
  return {id:value.captureId,at:value.capturedAt,index};
}

/**
 * All values and signs are supplied by independently approved source/D1 readers.
 * The report deliberately contains neither legacy IDs nor balance amounts.
 */
export function assessM10GrossPartyReconciliation(input={}){
  try{
    const values=safe(input,FIELDS,true);
    const issues=new Map();
    const add=(code,count=1)=>issues.set(code,(issues.get(code)||0)+count);

    if(values.sourcePlanReviewed===undefined)
      add('GROSS_SOURCE_PLAN_EVIDENCE_MISSING');
    else if(typeof values.sourcePlanReviewed!=='boolean')fail();
    else if(!values.sourcePlanReviewed)add('GROSS_SOURCE_PLAN_UNREVIEWED');

    if(values.identityReviewsPending===undefined)
      add('GROSS_IDENTITY_REVIEW_EVIDENCE_MISSING');
    else if(!nonneg(values.identityReviewsPending))fail();
    else if(values.identityReviewsPending>0)
      add('GROSS_IDENTITY_REVIEWS_PENDING',values.identityReviewsPending);

    const source=parseSnapshot(values.source,'SOURCE',add);
    const d1=parseSnapshot(values.d1,'D1',add);
    let accountRowsComplete=false;
    let grossOpeningMatched=false;
    let grossCurrentMatched=false;

    if(source&&d1){
      if(source.id===d1.id)add('GROSS_CAPTURES_NOT_DISTINCT');
      if(d1.at<=source.at)add('GROSS_CAPTURES_NOT_ORDERED');
      if(source.index.size===0&&d1.index.size===0)
        add('GROSS_ACCOUNT_EVIDENCE_EMPTY');
      let openingMatched=true,currentMatched=true,complete=true;
      const markMissing=(key,code)=>{
        add(code);complete=false;
        if(key.endsWith('|OPENING'))openingMatched=false;
        else currentMatched=false;
      };
      for(const [key,record] of source.index){
        const compared=d1.index.get(key);
        if(!compared){
          markMissing(key,'GROSS_ACCOUNT_MISSING_D1');
          continue;
        }
        if(record.value!==compared.value){
          add(record.basis==='OPENING'?
            'GROSS_OPENING_BALANCE_MISMATCH':'GROSS_CURRENT_BALANCE_MISMATCH');
          if(record.basis==='OPENING')openingMatched=false;
          else currentMatched=false;
        }
      }
      for(const key of d1.index.keys()){
        if(!source.index.has(key))
          markMissing(key,'GROSS_ACCOUNT_UNEXPECTED_D1');
      }
      const structuralIssues=[
        'GROSS_ACCOUNT_DUPLICATE_SOURCE','GROSS_ACCOUNT_DUPLICATE_D1',
        'GROSS_ACCOUNT_BASIS_INCOMPLETE_SOURCE',
        'GROSS_ACCOUNT_BASIS_INCOMPLETE_D1','GROSS_ACCOUNT_EVIDENCE_EMPTY'
      ];
      accountRowsComplete=complete&&source.index.size===d1.index.size&&
        !structuralIssues.some(k=>issues.has(k));
      grossOpeningMatched=openingMatched&&
        !['GROSS_ACCOUNT_BASIS_INCOMPLETE_SOURCE',
          'GROSS_ACCOUNT_BASIS_INCOMPLETE_D1',
          'GROSS_ACCOUNT_EVIDENCE_EMPTY'].some(k=>issues.has(k));
      grossCurrentMatched=currentMatched&&
        !['GROSS_ACCOUNT_BASIS_INCOMPLETE_SOURCE',
          'GROSS_ACCOUNT_BASIS_INCOMPLETE_D1',
          'GROSS_ACCOUNT_EVIDENCE_EMPTY'].some(k=>issues.has(k));
    }
    const sorted=[...issues].sort(([a],[b])=>a<b?-1:a>b?1:0)
      .map(([code,count])=>({code,count}));
    return {
      formatVersion:1,phase:'M10_OFFLINE_GROSS_PARTY_PREFLIGHT',
      accountRowsComplete,grossOpeningMatched,grossCurrentMatched,
      candidateGrossParity:accountRowsComplete&&grossOpeningMatched&&
        grossCurrentMatched&&sorted.length===0,
      authorizesImport:false,authorizesPosting:false,
      authorizesSettlement:false,productionReady:false,
      issues:sorted,limitations:LIMITS
    };
  }catch{
    // Malicious getters, labels, source IDs, digests and money NEVER leak.
    throw new Error(INVALID);
  }
}
