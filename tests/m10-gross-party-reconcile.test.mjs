import test from 'node:test';
import assert from 'node:assert/strict';
import {assessM10GrossPartyReconciliation} from '../src/migration/m10-gross-party-reconcile.js';

const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const hex=n=>n.toString(16).padStart(64,'0');
const KINDS=[
  ['CUSTOMERS','CUSTOMER_AR'],
  ['CUSTOMERS','CUSTOMER_ADVANCE'],
  ['SUPPLIERS','SUPPLIER_AP'],
  ['SUPPLIERS','SUPPLIER_ADVANCE'],
  ['VENDORS','VENDOR_AP'],
  ['VENDORS','VENDOR_AR'],
  ['FINANCE_PERSONS','OWNER_EQUITY'],
  ['FINANCE_PERSONS','OWNER_DRAWINGS'],
  ['FINANCE_PERSONS','LENDER_LOAN_AP'],
  ['FINANCE_PERSONS','BORROWER_LOAN_AR']
];
const accounts=()=>KINDS.flatMap(([sourceGroup,accountKind],i)=>[
  {sourceGroup,legacyIdDigest:hex(100),
   accountKind,contractDigest:hex(500+i),basis:'OPENING',currency:'BDT',
   balanceMinor:i%2===0?'-1234567890123456789012345':'1234567890123456789012345'},
  {sourceGroup,legacyIdDigest:hex(100),
   accountKind,contractDigest:hex(500+i),basis:'CURRENT',currency:'BDT',
   balanceMinor:i%2===0?'3000':'-3000'}
]);
const evidence=()=>({
  sourcePlanReviewed:true,identityReviewsPending:0,
  source:{captureId:'SOURCE-ACCOUNT-001',capturedAt:'2026-11-17T07:00:00.000Z',
    sourceCommit:PIN,accounts:accounts()},
  d1:{captureId:'D1-READBACK-001',capturedAt:'2026-11-17T07:30:00.000Z',
    sourceCommit:PIN,accounts:accounts()}
});
const get=(report,code)=>report.issues.find(item=>item.code===code)?.count??0;
const run=change=>{const x=evidence();change(x);return assessM10GrossPartyReconciliation(x);};

test('20 exact opening/current gross balances for ten independent account kinds are candidate-only',()=>{
  const report=assessM10GrossPartyReconciliation(evidence());
  assert.deepEqual(report,{
    formatVersion:1,phase:'M10_OFFLINE_GROSS_PARTY_PREFLIGHT',
    accountRowsComplete:true,grossOpeningMatched:true,grossCurrentMatched:true,
    candidateGrossParity:true,
    authorizesImport:false,authorizesPosting:false,authorizesSettlement:false,
    productionReady:false,issues:[],
    limitations:'Supplied account commitments and balances are not independently captured source/D1 proof, approved identity links or migration authorization'
  });
});

test('equal and opposite current balance drift on two roles cannot be netted away',()=>{
  const r=run(x=>{
    x.d1.accounts[0+1].balanceMinor='3100'; // customer current
    x.d1.accounts[4+1].balanceMinor='-3100'; // supplier current
  });
  assert.equal(get(r,'GROSS_CURRENT_BALANCE_MISMATCH'),2);
  assert.equal(r.grossCurrentMatched,false);
  assert.equal(r.candidateGrossParity,false);
});

test('vendor receivable and vendor payable remain independent even for one original vendor identity',()=>{
  const r=run(x=>{x.d1.accounts[10+1].balanceMinor='-2999';});
  assert.equal(get(r,'GROSS_CURRENT_BALANCE_MISMATCH'),1);
});

test('owner equity, owner drawings and lender/borrower amounts never become interchangeable',()=>{
  const r=run(x=>{
    x.d1.accounts[12+1].balanceMinor='-3500';
    x.d1.accounts[16+1].balanceMinor='-2500';
  });
  assert.equal(get(r,'GROSS_CURRENT_BALANCE_MISMATCH'),2);
});

test('historical opening balance differences never become today cash movement or current parity',()=>{
  const r=run(x=>{x.d1.accounts[0].balanceMinor='-1234567890123456789012344';});
  assert.equal(get(r,'GROSS_OPENING_BALANCE_MISMATCH'),1);
  assert.equal(r.grossOpeningMatched,false);
  assert.equal(r.grossCurrentMatched,true);
  assert.equal(r.authorizesPosting,false);
});

test('one missing and one unexpected original account produce separate discrepancies',()=>{
  const r=run(x=>{
    x.d1.accounts.shift();
    x.d1.accounts.push({
      ...x.source.accounts[0],legacyIdDigest:hex(700)
    });
  });
  assert.equal(get(r,'GROSS_ACCOUNT_MISSING_D1'),1);
  assert.equal(get(r,'GROSS_ACCOUNT_UNEXPECTED_D1'),1);
  assert.equal(r.accountRowsComplete,false);
});

test('duplicate source or D1 evidence cannot pass by Map key replacement',()=>{
  for(const [side,code] of [
    ['source','GROSS_ACCOUNT_DUPLICATE_SOURCE'],
    ['d1','GROSS_ACCOUNT_DUPLICATE_D1']
  ]){
    const r=run(x=>{x[side].accounts.push({...x[side].accounts[0]});});
    assert.equal(get(r,code),1,side);
    assert.equal(r.accountRowsComplete,false);
    assert.equal(r.candidateGrossParity,false);
  }
});

test('both sides omitting opening for the same account must not fake complete parity',()=>{
  const r=run(x=>{
    x.source.accounts=x.source.accounts.filter(row=>row.basis!=='OPENING');
    x.d1.accounts=x.d1.accounts.filter(row=>row.basis!=='OPENING');
  });
  assert.equal(get(r,'GROSS_ACCOUNT_BASIS_INCOMPLETE_SOURCE'),10);
  assert.equal(get(r,'GROSS_ACCOUNT_BASIS_INCOMPLETE_D1'),10);
  assert.equal(r.accountRowsComplete,false);
});

test('both sides supplying no financial rows is not automatically a passed rehearsal',()=>{
  const r=run(x=>{
    x.source.accounts=[];x.d1.accounts=[];
  });
  assert.equal(get(r,'GROSS_ACCOUNT_EVIDENCE_EMPTY'),1);
  assert.equal(r.candidateGrossParity,false);
});

test('missing capture evidence fails closed with no claim of completeness',()=>{
  const r=assessM10GrossPartyReconciliation({});
  assert.equal(get(r,'GROSS_SOURCE_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'GROSS_D1_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'GROSS_IDENTITY_REVIEW_EVIDENCE_MISSING'),1);
  assert.equal(get(r,'GROSS_SOURCE_PLAN_EVIDENCE_MISSING'),1);
  assert.equal(r.accountRowsComplete,false);
});

test('unreviewed account plan and unresolved legacy identity queue block parity',()=>{
  const r=run(x=>{x.sourcePlanReviewed=false;x.identityReviewsPending=3;});
  assert.equal(get(r,'GROSS_SOURCE_PLAN_UNREVIEWED'),1);
  assert.equal(get(r,'GROSS_IDENTITY_REVIEWS_PENDING'),3);
  assert.equal(r.candidateGrossParity,false);
});

test('capture order/source pins are required, and two captures must not be the same',()=>{
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

test('source group and original account-kind direction must be reviewed; payee is not an implicit payable',()=>{
  for(const edit of [
    row=>{row.sourceGroup='EXPENSE_PAYEES';},
    row=>{row.sourceGroup='SUPPLIERS';},
    row=>{row.accountKind='VENDOR_AR';},
    row=>{row.currency='USD';}
  ]){
    const x=evidence();edit(x.source.accounts[0]);
    assert.throws(()=>assessM10GrossPartyReconciliation(x),
      {message:'M10 gross Party evidence invalid'});
  }
});

test('invalid money formats are never silently rounded or coerced',()=>{
  for(const value of ['-0','+100','01','1.0','1e3','1,000',' 100','--5','Infinity',
    12.5,NaN,Infinity,null,'']){
    const x=evidence();x.d1.accounts[0].balanceMinor=value;
    assert.throws(()=>assessM10GrossPartyReconciliation(x),
      {message:'M10 gross Party evidence invalid'});
  }
});

test('role-preserving same identity, exact BigInt minor units and negative historic positions are supported',()=>{
  const x=evidence();
  assert.equal(x.source.accounts[0].legacyIdDigest,x.source.accounts[2].legacyIdDigest);
  assert.equal(x.source.accounts[0].currency,'BDT');
  assert.equal(assessM10GrossPartyReconciliation(x).candidateGrossParity,true);
});

test('malicious getters, inherited fields and unexpected PII never escape into diagnostic errors',()=>{
  for(const change of [
    x=>Object.defineProperty(x.source.accounts[0],'balanceMinor',{
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

test('reports are stable, sorted and redact all source identifiers and money values',()=>{
  const x=evidence();
  x.d1.accounts[0].balanceMinor='-9999999999999999999999999';
  x.d1.accounts[1].balanceMinor='200000000000000000000';
  const before=structuredClone(x);
  const a=assessM10GrossPartyReconciliation(x);
  const b=assessM10GrossPartyReconciliation(x);
  assert.deepEqual(a,b);
  assert.deepEqual(x,before);
  assert.deepEqual(a.issues.map(i=>i.code),
    [...a.issues.map(i=>i.code)].sort());
  assert.doesNotMatch(JSON.stringify(a),
    /sourceGroup|balanceMinor|legacyIdDigest|contractDigest|SOURCE-ACCOUNT-001|D1-READBACK-001|999999999999999|PRIVATE/);
});
