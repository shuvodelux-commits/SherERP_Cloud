/**
 * M10-14: OFFLINE per-original-account gross checkpoint comparator.
 * This consumes supplied source-shaped M02 checkpoint evidence only.
 * No Sheets/D1 access, identity approval, account posting, or settlement.
 */
const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const INVALID='M10 gross Party evidence invalid';
const LIMITS='Supplied source-shaped gross checkpoints and domain attestations are not independent source/D1 proof or approved legacy ID links';
const HEX=/^[0-9a-f]{64}$/;
const TOKEN=/^[A-Za-z0-9_-]{8,64}$/;
const UTC=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const MINOR=/^[1-9][0-9]{0,37}$/;
const FIELDS=['source','d1','identityReviewsPending','sourcePlanReviewed'];
const SNAPSHOT=['captureId','capturedAt','sourceCommit','domains','accounts'];
const DOMAIN=['sourceGroup','basis'];
const ROW=['sourceGroup','legacyIdDigest','accountKind','sourceField',
  'basis','currency','amountMinor'];
// Mirror M02's frozen src/party/gross-checkpoint-parity.js sourceAccountKinds.
// Each signed source balance maps to ONE direction, not two signed accounts.
const CONTRACT=Object.freeze({
  CUSTOMERS:{
    SOURCE_CURRENT:{'Current Due':['CUSTOMER_RECEIVABLE','CUSTOMER_ADVANCE']},
    HISTORICAL_OPENING:{'Opening Balance':['CUSTOMER_RECEIVABLE','CUSTOMER_ADVANCE']}
  },
  SUPPLIERS:{
    SOURCE_CURRENT:{'Current Due':['SUPPLIER_PAYABLE','SUPPLIER_ADVANCE']},
    HISTORICAL_OPENING:{'Opening Balance':['SUPPLIER_PAYABLE','SUPPLIER_ADVANCE']}
  },
  VENDORS:{
    SOURCE_CURRENT:{
      'Current Due':['VENDOR_PAYABLE'],
      'Current Receivable':['VENDOR_RECEIVABLE']
    }
  },
  FINANCE_PERSONS:{
    SOURCE_CURRENT:{'FINANCE_TRANSACTIONS.Amount':[
      'OWNER_EQUITY','OWNER_ADVANCE',
      'LENDER_LOAN_PAYABLE','LENDER_CREDIT',
      'BORROWER_LOAN_RECEIVABLE','BORROWER_CREDIT'
    ]}
  }
});
const DOMAINS=[
  'CUSTOMERS|SOURCE_CURRENT','CUSTOMERS|HISTORICAL_OPENING',
  'SUPPLIERS|SOURCE_CURRENT','SUPPLIERS|HISTORICAL_OPENING',
  'VENDORS|SOURCE_CURRENT','FINANCE_PERSONS|SOURCE_CURRENT'
];
const CHANNEL={
  CUSTOMER_RECEIVABLE:'customer',CUSTOMER_ADVANCE:'customer',
  SUPPLIER_PAYABLE:'supplier',SUPPLIER_ADVANCE:'supplier',
  OWNER_EQUITY:'owner',OWNER_ADVANCE:'owner',
  LENDER_LOAN_PAYABLE:'lender',LENDER_CREDIT:'lender',
  BORROWER_LOAN_RECEIVABLE:'borrower',BORROWER_CREDIT:'borrower'
};
const fail=()=>{throw new Error(INVALID);};

/** No inherited names or getters, including on untrusted top-level objects. */
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
const token=s=>typeof s==='string'&&TOKEN.test(s);
const nonneg=n=>Number.isSafeInteger(n)&&n>=0;

function parseCapture(value,side,add){
  if(value===undefined){
    add(side==='SOURCE'?'GROSS_SOURCE_EVIDENCE_MISSING':'GROSS_D1_EVIDENCE_MISSING');
    return null;
  }
  safe(value,SNAPSHOT);
  if(!token(value.captureId)||!time(value.capturedAt)||
    value.sourceCommit!==PIN||
    !Array.isArray(value.domains)||!Array.isArray(value.accounts)||
    value.domains.length>32||value.accounts.length>100000)fail();

  const domains=new Set();
  for(const item of value.domains){
    safe(item,DOMAIN);
    const key=item.sourceGroup+'|'+item.basis;
    if(typeof item.sourceGroup!=='string'||typeof item.basis!=='string')fail();
    if(!DOMAINS.includes(key)){
      add('GROSS_DOMAIN_UNEXPECTED_'+side);
      continue;
    }
    if(domains.has(key)){
      add('GROSS_DOMAIN_DUPLICATE_'+side);
      continue;
    }
    domains.add(key);
  }
  for(const key of DOMAINS)if(!domains.has(key))
    add('GROSS_DOMAIN_MISSING_'+side);

  const index=new Map(),signed=new Map();
  for(const raw of value.accounts){
    const row=safe(raw,ROW);
    if(typeof row.sourceGroup!=='string'||typeof row.basis!=='string'||
      typeof row.sourceField!=='string'||typeof row.accountKind!=='string'||
      CONTRACT[row.sourceGroup]?.[row.basis]?.[row.sourceField]
        ?.includes(row.accountKind)!==true||
      typeof row.legacyIdDigest!=='string'||!HEX.test(row.legacyIdDigest)||
      row.currency!=='BDT'||
      typeof row.amountMinor!=='string'||!MINOR.test(row.amountMinor))fail();

    // M02's original signed channel can be positive OR advance/credit,
    // never both for the same original source ID and basis.
    const channel=CHANNEL[row.accountKind];
    if(channel){
      const slot=[
        row.sourceGroup,row.legacyIdDigest,row.basis,channel
      ].join('|');
      const previous=signed.get(slot);
      if(previous!==undefined&&previous!==row.accountKind)
        add('GROSS_SIGNED_DIRECTION_CONFLICT_'+side);
      else signed.set(slot,row.accountKind);
    }
    const key=[
      row.sourceGroup,row.legacyIdDigest,row.accountKind,row.sourceField,row.basis
    ].join('|');
    if(index.has(key)){
      add('GROSS_ACCOUNT_DUPLICATE_'+side);
      continue;
    }
    index.set(key,{value:BigInt(row.amountMinor),basis:row.basis});
  }
  return {id:value.captureId,at:value.capturedAt,index};
}

/** Candidate-only, redacted aggregate evidence; no source business data leaves. */
export function assessM10GrossPartyReconciliation(input={}){
  try{
    const values=safe(input,FIELDS,true);
    const issues=new Map();
    const add=(code,n=1)=>issues.set(code,(issues.get(code)||0)+n);
    if(values.sourcePlanReviewed===undefined)add('GROSS_SOURCE_PLAN_EVIDENCE_MISSING');
    else if(typeof values.sourcePlanReviewed!=='boolean')fail();
    else if(!values.sourcePlanReviewed)add('GROSS_SOURCE_PLAN_UNREVIEWED');

    if(values.identityReviewsPending===undefined)
      add('GROSS_IDENTITY_REVIEW_EVIDENCE_MISSING');
    else if(!nonneg(values.identityReviewsPending))fail();
    else if(values.identityReviewsPending>0)
      add('GROSS_IDENTITY_REVIEWS_PENDING',values.identityReviewsPending);

    const source=parseCapture(values.source,'SOURCE',add);
    const d1=parseCapture(values.d1,'D1',add);
    let accountRowsComplete=false;
    let grossOpeningMatched=false;
    let grossCurrentMatched=false;
    if(source&&d1){
      if(source.id===d1.id)add('GROSS_CAPTURES_NOT_DISTINCT');
      if(d1.at<=source.at)add('GROSS_CAPTURES_NOT_ORDERED');
      let complete=true,opening=true,current=true;
      const mark=(key,code)=>{
        add(code);complete=false;
        if(key.endsWith('|HISTORICAL_OPENING'))opening=false;
        else current=false;
      };
      for(const [key,record] of source.index){
        const compared=d1.index.get(key);
        if(!compared){
          mark(key,'GROSS_ACCOUNT_MISSING_D1');
          continue;
        }
        if(record.value!==compared.value){
          add(record.basis==='HISTORICAL_OPENING'?
            'GROSS_OPENING_BALANCE_MISMATCH':'GROSS_CURRENT_BALANCE_MISMATCH');
          if(record.basis==='HISTORICAL_OPENING')opening=false;
          else current=false;
        }
      }
      for(const key of d1.index.keys())
        if(!source.index.has(key))mark(key,'GROSS_ACCOUNT_UNEXPECTED_D1');
      const bad=Object.keys(Object.fromEntries(issues)).some(code=>
        code.startsWith('GROSS_DOMAIN_')||
        code.startsWith('GROSS_ACCOUNT_DUPLICATE_')||
        code.startsWith('GROSS_SIGNED_DIRECTION_CONFLICT_'));
      accountRowsComplete=complete&&source.index.size===d1.index.size&&!bad;
      grossOpeningMatched=opening&&!bad;
      grossCurrentMatched=current&&!bad;
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
    // Never expose source identity, private balance values or thrown errors.
    throw new Error(INVALID);
  }
}
