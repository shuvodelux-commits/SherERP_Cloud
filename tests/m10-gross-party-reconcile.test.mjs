import test from 'node:test';
import assert from 'node:assert/strict';
import {assessM10GrossPartyReconciliation} from '../src/migration/m10-gross-party-reconcile.js';

const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const hex=n=>n.toString(16).padStart(64,'0');
// Exact M02 gross-checkpoint source contracts. No invented account kinds.
const SPEC=[
  ['CUSTOMERS','CUSTOMER_RECEIVABLE','Current Due','SOURCE_CURRENT',100],
  ['CUSTOMERS','CUSTOMER_RECEIVABLE','Opening Balance','HISTORICAL_OPENING',100],
  ['CUSTOMERS','CUSTOMER_ADVANCE','Current Due','SOURCE_CURRENT',101],
  ['CUSTOMERS','CUSTOMER_ADVANCE','Opening Balance','HISTORICAL_OPENING',101],
  ['SUPPLIERS','SUPPLIER_PAYABLE','Current Due','SOURCE_CURRENT',100],
  ['SUPPLIERS','SUPPLIER_PAYABLE','Opening Balance','HISTORICAL_OPENING',100],
  ['SUPPLIERS','SUPPLIER_ADVANCE','Current Due','SOURCE_CURRENT',102],
  ['SUPPLIERS','SUPPLIER_ADVANCE','Opening Balance','HISTORICAL_OPENING',102],
  ['VENDORS','VENDOR_PAYABLE','Current Due','SOURCE_CURRENT',200],
  ['VENDORS','VENDOR_RECEIVABLE','Current Receivable','SOURCE_CURRENT',200],
  ['FINANCE_PERSONS','OWNER_EQUITY','FINANCE_TRANSACTIONS.Amount','SOURCE_CURRENT',300],
  ['FINANCE_PERSONS','OWNER_ADVANCE','FINANCE_TRANSACTIONS.Amount','SOURCE_CURRENT',301],
  ['FINANCE_PERSONS','LENDER_LOAN_PAYABLE','FINANCE_TRANSACTIONS.Amount','SOURCE_CURRENT',300],
  ['FINANCE_PERSONS','LENDER_CREDIT','FINANCE_TRANSACTIONS.Amount','SOURCE_CURRENT',302],
  ['FINANCE_PERSONS','BORROWER_LOAN_RECEIVABLE','FINANCE_TRANSACTIONS.Amount','SOURCE_CURRENT',300],
  ['FINANCE_PERSONS','BORROWER_CREDIT','FINANCE_TRANSACTIONS.Amount','SOURCE_CURRENT',303]
];
const DOMAINS=[
  ['CUSTOMERS','SOURCE_CURRENT'],['CUSTOMERS','HISTORICAL_OPENING'],
  ['SUPPLIERS','SOURCE_CURRENT'],['SUPPLIERS','HISTORICAL_OPENING'],
  ['VENDORS','SOURCE_CURRENT'],['FINANCE_PERSONS','SOURCE_CURRENT']
];
const domains=()=>DOMAINS.map(([sourceGroup,basis])=>({sourceGroup,basis}));
const accounts=()=>SPEC.map(([sourceGroup,accountKind,sourceField,basis,id],i)=>({
  sourceGroup,legacyIdDigest:hex(id),accountKind,sourceField,basis,
  currency:'BDT',amountMinor:i===0?'1234567890123456789012345':'3000'
}));
const evidence=()=>({
  sourcePlanReviewed:true,identityReviewsPending:0,
  source:{captureId:'SOURCE-ACCOUNT-001',capturedAt:'2026-11-17T07:00:00.000Z',
    sourceCommit:PIN,domains:domains(),accounts:accounts()},
  d1:{captureId:'D1-READBACK-001',capturedAt:'2026-11-17T07:30:00.000Z',
    sourceCommit:PIN,domains:domains(),accounts:accounts()}
});
const get=(report,code)=>report.issues.find(item=>item.code===code)?.count??0;
const run=change=>{const x=evidence();change(x);return assessM10GrossPartyReconciliation(x);};

test('all twelve M02 source-faithful gross kinds and six domains are candidate-only',()=>{
  const report=assessM10GrossPartyReconciliation(evidence());
  assert.deepEqual(report,{
    formatVersion:1,phase:'M10_OFFLINE_GROSS_PARTY_PREFLIGHT',
    accountRowsComplete:true,grossOpeningMatched:true,grossCurrentMatched:true,
    candidateGrossParity:true,
    authorizesImport:false,authorizesPosting:false,authorizesSettlement:false,
    productionReady:false,issues:[],
    limitations:'Supplied source-shaped gross checkpoints and domain attestations are not independent source/D1 proof or approved legacy ID links'
  });
});

test('equal and opposite changes on Customer vs Supplier cannot be silently netted',()=>{
  const r=run(x=>{
    x.d1.accounts[0].amountMinor='1234567890123456789012445';
    x.d1.accounts[4].amountMinor='2900';
  });
  assert.equal(get(r,'GROSS_CURRENT_BALANCE_MISMATCH'),2);
  assert.equal(r.grossCurrentMatched,false);
});

test('Vendor payable and receivable remain distinct on one original Vendor ID',()=>{
  const r=run(x=>{x.d1.accounts[9].amountMinor='2999';});
  assert.equal(get(r,'GROSS_CURRENT_BALANCE_MISMATCH'),1);
});

test('Owner capital, Owner advance, Lender payable/credit and Borrower receivable/credit retain M02 roles',()=>{
  const r=run(x=>{
    x.d1.accounts[10].amountMinor='3500';
    x.d1.accounts[12].amountMinor='2500';
    x.d1.accounts[14].amountMinor='2100';
  });
  assert.equal(get(r,'GROSS_CURRENT_BALANCE_MISMATCH'),3);
});

test('negative original Opening Balance becomes positive source account Advance; it is not current Cash turnover',()=>{
  const x=evidence();
  assert.equal(x.source.accounts[3].accountKind,'CUSTOMER_ADVANCE');
  assert.equal(x.source.accounts[3].basis,'HISTORICAL_OPENING');
  const r=run(x=>{x.d1.accounts[3].amountMinor='2999';});
  assert.equal(get(r,'GROSS_OPENING_BALANCE_MISMATCH'),1);
  assert.equal(r.grossOpeningMatched,false);
  assert.equal(r.grossCurrentMatched,true);
  assert.equal(r.authorizesPosting,false);
});

test('source-ID mismatches are detected as missing/extra without any name matching',()=>{
  const r=run(x=>{x.d1.accounts[8].legacyIdDigest=hex(9999);});
  assert.equal(get(r,'GROSS_ACCOUNT_MISSING_D1'),1);
  assert.equal(get(r,'GROSS_ACCOUNT_UNEXPECTED_D1'),1);
});

test('missing and unexpected account identifiers create separate discrepancies',()=>{
  const r=run(x=>{
    x.d1.accounts.shift();
    x.d1.accounts.push({...x.source.accounts[0],legacyIdDigest:hex(7777)});
  });
  assert.equal(get(r,'GROSS_ACCOUNT_MISSING_D1'),1);
  assert.equal(get(r,'GROSS_ACCOUNT_UNEXPECTED_D1'),1);
  assert.equal(r.accountRowsComplete,false);
});

test('duplicate source or D1 evidence fails closed',()=>{
  for(const [side,code] of [
    ['source','GROSS_ACCOUNT_DUPLICATE_SOURCE'],
    ['d1','GROSS_ACCOUNT_DUPLICATE_D1']
  ]){
    const r=run(x=>{x[side].accounts.push({...x[side].accounts[0]});});
    assert.equal(get(r,code),1,side);
    assert.equal(r.accountRowsComplete,false);
  }
});

test('both snapshots silently omitting all historic opening rows must fail when domain coverage is absent',()=>{
  const r=run(x=>{
    for(const side of ['source','d1']){
      x[side].accounts=x[side].accounts.filter(v=>v.basis!=='HISTORICAL_OPENING');
      x[side].domains=x[side].domains.filter(v=>v.basis!=='HISTORICAL_OPENING');
    }
  });
  assert.equal(get(r,'GROSS_DOMAIN_MISSING_SOURCE'),2);
  assert.equal(get(r,'GROSS_DOMAIN_MISSING_D1'),2);
  assert.equal(r.accountRowsComplete,false);
});

test('explicit reviewed zero-row domains permit legitimately empty snapshots without fake obligations',()=>{
  const r=run(x=>{
    x.source.accounts=[];x.d1.accounts=[];
  });
  assert.equal(r.accountRowsComplete,true);
  assert.equal(r.candidateGrossParity,true);
  assert.equal(r.authorizesImport,false);
});

test('duplicate or unexpected domain coverage never passes',()=>{
  const duplicate=run(x=>x.d1.domains.push({...x.d1.domains[0]}));
  assert.equal(get(duplicate,'GROSS_DOMAIN_DUPLICATE_D1'),1);
  const unusual=evidence();
  unusual.source.domains.push({sourceGroup:'EXPENSE_PAYEES',basis:'SOURCE_CURRENT'});
  assert.equal(get(assessM10GrossPartyReconciliation(unusual),
    'GROSS_DOMAIN_UNEXPECTED_SOURCE'),1);
});

test('missing source or D1 capture and missing identity review evidence fail closed',()=>{
  const r=assessM10GrossPartyReconciliation({});
  assert.equal(get(r,'GROSS_SOURCE_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'GROSS_D1_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'GROSS_IDENTITY_REVIEW_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'GROSS_SOURCE_PLAN_EVIDENCE_MISSING'),1);
  assert.equal(r.accountRowsComplete,false);
});

test('unreviewed original account plan or unresolved identity review queue blocks even matching evidence',()=>{
  const r=run(x=>{x.sourcePlanReviewed=false;x.identityReviewsPending=3;});
  assert.equal(get(r,'GROSS_SOURCE_PLAN_UNREVIEWED'),1);
  assert.equal(get(r,'GROSS_IDENTITY_REVIEWS_PENDING'),3);
  assert.equal(r.candidateGrossParity,false);
});

test('captures must have distinct IDs, order and pinned original source commit',()=>{
  const r=run(x=>{
    x.d1.captureId=x.source.captureId;
    x.d1.capturedAt='2026-11-17T06:59:59.000Z';
  });
  assert.equal(get(r,'GROSS_CAPTURES_NOT_DISTINCT'),1);
  assert.equal(get(r,'GROSS_CAPTURES_NOT_ORDERED'),1);
  const x=evidence();x.d1.sourceCommit='PRIVATE-SECRET';
  assert.throws(()=>assessM10GrossPartyReconciliation(x),
    {message:'M10 gross Party evidence invalid'});
});

test('M02 source contract disallows fabricated Payee debt, Vendor opening, finance opening and wrong fields',()=>{
  for(const change of [
    row=>{row.sourceGroup='EXPENSE_PAYEES';},
    row=>{row.sourceGroup='SUPPLIERS';},
    row=>{row.accountKind='VENDOR_RECEIVABLE';},
    row=>{row.currency='USD';},
    row=>{row.sourceField='Opening Balance';},
    row=>{row.basis='HISTORICAL_OPENING';}
  ]){
    const x=evidence();change(x.source.accounts[8]); // Vendor Current Due
    assert.throws(()=>assessM10GrossPartyReconciliation(x),
      {message:'M10 gross Party evidence invalid'});
  }
});

test('a signed source account channel cannot contain both positive and advance directions for same ID/basis',()=>{
  const x=evidence();
  x.source.accounts[2].legacyIdDigest=x.source.accounts[0].legacyIdDigest;
  const r=assessM10GrossPartyReconciliation(x);
  assert.equal(get(r,'GROSS_SIGNED_DIRECTION_CONFLICT_SOURCE'),1);
  assert.equal(r.candidateGrossParity,false);
});

test('noncanonical amounts, negative values or numeric floats are rejected; source sign lives in account kind',()=>{
  for(const v of ['-0','-100','+100','01','1.0','1e3','1,000',' 100','--5','Infinity',
    12.5,NaN,Infinity,null,'','0']){
    const x=evidence();x.d1.accounts[0].amountMinor=v;
    assert.throws(()=>assessM10GrossPartyReconciliation(x),
      {message:'M10 gross Party evidence invalid'});
  }
});

test('M02 one Party can retain multiple roles without merging source IDs or accounts',()=>{
  const x=evidence();
  assert.equal(x.source.accounts[0].legacyIdDigest,x.source.accounts[4].legacyIdDigest);
  assert.equal(x.source.accounts[8].legacyIdDigest,x.source.accounts[9].legacyIdDigest);
  assert.equal(x.source.accounts[10].legacyIdDigest,x.source.accounts[12].legacyIdDigest);
  assert.equal(assessM10GrossPartyReconciliation(x).candidateGrossParity,true);
});

test('malicious getters, inherited fields and unexpected private data cannot leak',()=>{
  for(const change of [
    x=>Object.defineProperty(x.source.accounts[0],'amountMinor',{
      enumerable:true,get(){throw Error('PRIVATE-CUSTOMER-SHOAIB');}
    }),
    x=>{x.d1.accounts[0].customerPhone='PRIVATE-CUSTOMER-SHOAIB';},
    x=>{x.source.accounts[0]=Object.create(x.source.accounts[0]);},
    x=>Object.defineProperty(x,'sourcePlanReviewed',{
      enumerable:true,get(){throw Error('PRIVATE-CUSTOMER-SHOAIB');}
    })
  ]){
    const x=evidence();change(x);
    assert.throws(()=>assessM10GrossPartyReconciliation(x),
      error=>error.message==='M10 gross Party evidence invalid'&&
        !/PRIVATE|CUSTOMER-SHOAIB/.test(error.message));
  }
});

test('reports have sorted counts, no identifiers/money, immutable inputs and deterministic results',()=>{
  const x=evidence();
  x.d1.accounts[0].amountMinor='9999999999999999999999999';
  x.d1.accounts[1].amountMinor='200000000000000000000';
  const before=structuredClone(x);
  const a=assessM10GrossPartyReconciliation(x);
  const b=assessM10GrossPartyReconciliation(x);
  assert.deepEqual(a,b);
  assert.deepEqual(x,before);
  assert.deepEqual(a.issues.map(i=>i.code),[...a.issues.map(i=>i.code)].sort());
  assert.doesNotMatch(JSON.stringify(a),
    /sourceGroup|amountMinor|legacyIdDigest|SOURCE-ACCOUNT-001|D1-READBACK-001|999999999999999|PRIVATE/);
});
