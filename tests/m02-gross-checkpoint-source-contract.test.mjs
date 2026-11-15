import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileGrossPartyCheckpoints} from '../src/party/gross-checkpoint-parity.js';

const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const row=(sourceGroup,basis,sourceField,kind)=>({
  partyId:'PRIVATE-PARTY-01',sourceGroup,sourceId:'PRIVATE-SOURCE-01',
  kind,sourceField,basis,amountMinor:125
});
const sample=checkpoint=>{
  const opening=checkpoint.basis==='HISTORICAL_OPENING';
  const currentCheckpoints=opening?[]:[checkpoint];
  const openingCheckpoints=opening?[checkpoint]:[];
  const preflight={
    formatVersion:1,sourceCommit:SOURCE,currency:'BDT',
    readyForAccountDesignReview:true,blockingIssues:[],
    currentCheckpoints,openingCheckpoints,
    grossCurrentTotalsMinor:opening?{}:{[checkpoint.kind]:125},
    grossOpeningTotalsMinor:opening?{[checkpoint.kind]:125}:{},
    summary:{
      currentCheckpointCount:currentCheckpoints.length,
      historicalOpeningCheckpointCount:openingCheckpoints.length,
      pendingIdentityReviews:0,
      effects:{cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0}
    }
  };
  return {preflight,readback:{
    currentCheckpoints:structuredClone(currentCheckpoints),
    openingCheckpoints:structuredClone(openingCheckpoints)
  }};
};
const compare=tuple=>reconcileGrossPartyCheckpoints(sample(row(...tuple)));

const valid=[
  ['CUSTOMERS','SOURCE_CURRENT','Current Due','CUSTOMER_RECEIVABLE'],
  ['CUSTOMERS','SOURCE_CURRENT','Current Due','CUSTOMER_ADVANCE'],
  ['CUSTOMERS','HISTORICAL_OPENING','Opening Balance','CUSTOMER_RECEIVABLE'],
  ['CUSTOMERS','HISTORICAL_OPENING','Opening Balance','CUSTOMER_ADVANCE'],
  ['SUPPLIERS','SOURCE_CURRENT','Current Due','SUPPLIER_PAYABLE'],
  ['SUPPLIERS','SOURCE_CURRENT','Current Due','SUPPLIER_ADVANCE'],
  ['SUPPLIERS','HISTORICAL_OPENING','Opening Balance','SUPPLIER_PAYABLE'],
  ['SUPPLIERS','HISTORICAL_OPENING','Opening Balance','SUPPLIER_ADVANCE'],
  ['VENDORS','SOURCE_CURRENT','Current Due','VENDOR_PAYABLE'],
  ['VENDORS','SOURCE_CURRENT','Current Receivable','VENDOR_RECEIVABLE'],
  ['FINANCE_PERSONS','SOURCE_CURRENT','FINANCE_TRANSACTIONS.Amount','OWNER_EQUITY'],
  ['FINANCE_PERSONS','SOURCE_CURRENT','FINANCE_TRANSACTIONS.Amount','OWNER_ADVANCE'],
  ['FINANCE_PERSONS','SOURCE_CURRENT','FINANCE_TRANSACTIONS.Amount','LENDER_LOAN_PAYABLE'],
  ['FINANCE_PERSONS','SOURCE_CURRENT','FINANCE_TRANSACTIONS.Amount','LENDER_CREDIT'],
  ['FINANCE_PERSONS','SOURCE_CURRENT','FINANCE_TRANSACTIONS.Amount','BORROWER_LOAN_RECEIVABLE'],
  ['FINANCE_PERSONS','SOURCE_CURRENT','FINANCE_TRANSACTIONS.Amount','BORROWER_CREDIT']
];
const invalid=[
  ['CUSTOMERS','SOURCE_CURRENT','Current Due','VENDOR_PAYABLE'],
  ['SUPPLIERS','SOURCE_CURRENT','Current Due','CUSTOMER_ADVANCE'],
  ['VENDORS','SOURCE_CURRENT','Current Due','VENDOR_RECEIVABLE'],
  ['VENDORS','SOURCE_CURRENT','Current Receivable','VENDOR_PAYABLE'],
  ['FINANCE_PERSONS','SOURCE_CURRENT','FINANCE_TRANSACTIONS.Amount','CUSTOMER_RECEIVABLE'],
  ['FINANCE_PERSONS','SOURCE_CURRENT','Current Due','OWNER_EQUITY'],
  ['CUSTOMERS','SOURCE_CURRENT','Opening Balance','CUSTOMER_ADVANCE'],
  ['CUSTOMERS','HISTORICAL_OPENING','Current Due','CUSTOMER_RECEIVABLE'],
  ['SUPPLIERS','HISTORICAL_OPENING','Current Due','SUPPLIER_PAYABLE'],
  ['VENDORS','HISTORICAL_OPENING','Opening Balance','VENDOR_PAYABLE'],
  ['FINANCE_PERSONS','HISTORICAL_OPENING','FINANCE_TRANSACTIONS.Amount','OWNER_EQUITY'],
  ['VENDORS','SOURCE_CURRENT','Current Due','BORROWER_LOAN_RECEIVABLE']
];

test('all 16 frozen source/role/account/basis combinations still reconcile exactly',()=>{
  for(const tuple of valid){
    const r=compare(tuple);
    assert.equal(r.sourcePlanValid,true,JSON.stringify(tuple));
    assert.equal(r.readbackChecked,true,JSON.stringify(tuple));
    assert.equal(r.offlineCheckpointParity,true,JSON.stringify(tuple));
    assert.deepEqual(r.issues,[],JSON.stringify(tuple));
  }
});
test('forged ready source preflight cannot reclassify gross accounts even when totals are consistent',()=>{
  for(const tuple of invalid){
    assert.throws(()=>compare(tuple),
      /^Error: Gross checkpoint parity unavailable$/,
      JSON.stringify(tuple));
  }
});
test('invalid expected account contract never reads caller readback or reveals identifiers',()=>{
  for(const tuple of invalid){
    const x=sample(row(...tuple));
    x.readback=new Proxy({},{
      get(){throw new Error('SECRET-ACCOUNT-SOURCE-INFO')},
      getPrototypeOf(){throw new Error('SECRET-ACCOUNT-SOURCE-INFO')}
    });
    assert.throws(()=>reconcileGrossPartyCheckpoints(x),
      e=>e.message==='Gross checkpoint parity unavailable'&&
        !/SECRET|PRIVATE/.test(e.message));
  }
});
test('readback-only kind substitution keeps fixed-code difference reports instead of becoming a new exception',()=>{
  const x=sample(row('VENDORS','SOURCE_CURRENT','Current Due','VENDOR_PAYABLE'));
  x.readback.currentCheckpoints[0].kind='VENDOR_RECEIVABLE';
  const r=reconcileGrossPartyCheckpoints(x);
  assert.equal(r.sourcePlanValid,true);
  assert.equal(r.currentMatch,false);
  assert.equal(r.offlineCheckpointParity,false);
  assert.deepEqual(r.issues,[
    {stage:'SOURCE_CURRENT',code:'EXTRA_CHECKPOINT',count:1},
    {stage:'SOURCE_CURRENT',code:'MISSING_CHECKPOINT',count:1}
  ]);
});
test('source tuple guard is pure and report remains redacted for an exact Party account match',()=>{
  const x=sample(row('FINANCE_PERSONS','SOURCE_CURRENT',
    'FINANCE_TRANSACTIONS.Amount','LENDER_CREDIT'));
  const original=structuredClone(x);
  const result=reconcileGrossPartyCheckpoints(x);
  assert.equal(result.offlineCheckpointParity,true);
  assert.deepEqual(x,original);
  assert.doesNotMatch(JSON.stringify(result),
    /PRIVATE-PARTY-01|PRIVATE-SOURCE-01|LENDER_CREDIT|amountMinor|sourceField|partyId/);
});
