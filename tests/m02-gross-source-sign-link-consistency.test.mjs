import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileGrossPartyCheckpoints} from '../src/party/gross-checkpoint-parity.js';

const SHA='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const CURRENT='SOURCE_CURRENT',OPENING='HISTORICAL_OPENING';
function row(group,id,party,basis,field,kind,amount=125){
  return {partyId:party,sourceGroup:group,sourceId:id,
    kind,sourceField:field,basis,amountMinor:amount};
}
const customer=(id='CUS-001',party='PT-CUSTOMER',kind='CUSTOMER_RECEIVABLE')=>
  row('CUSTOMERS',id,party,CURRENT,'Current Due',kind);
const supplier=(id='SUP-001',party='PT-SUPPLIER',kind='SUPPLIER_ADVANCE')=>
  row('SUPPLIERS',id,party,CURRENT,'Current Due',kind);
const vendor=(kind,party='PT-VENDOR')=>
  row('VENDORS','VEN-001',party,CURRENT,
    kind==='VENDOR_PAYABLE'?'Current Due':'Current Receivable',kind);
const finance=(kind,party='PT-FINANCE')=>
  row('FINANCE_PERSONS','FIN-001',party,CURRENT,
    'FINANCE_TRANSACTIONS.Amount',kind);
const openingCustomer=(party='PT-CUSTOMER',kind='CUSTOMER_ADVANCE')=>
  row('CUSTOMERS','CUS-001',party,OPENING,'Opening Balance',kind);
const openingSupplier=(party='PT-SUPPLIER',kind='SUPPLIER_PAYABLE')=>
  row('SUPPLIERS','SUP-001',party,OPENING,'Opening Balance',kind);
const sum=rows=>{
  const totals={};
  for(const entry of rows)totals[entry.kind]=(totals[entry.kind]||0)+entry.amountMinor;
  return totals;
};
function scenario(current,opening=[]){
  const preflight={
    formatVersion:1,sourceCommit:SHA,currency:'BDT',
    readyForAccountDesignReview:true,blockingIssues:[],
    currentCheckpoints:current,openingCheckpoints:opening,
    grossCurrentTotalsMinor:sum(current),
    grossOpeningTotalsMinor:sum(opening),
    summary:{
      currentCheckpointCount:current.length,
      historicalOpeningCheckpointCount:opening.length,
      pendingIdentityReviews:0,
      effects:{cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0}
    }
  };
  return {preflight,readback:{
    currentCheckpoints:structuredClone(current),
    openingCheckpoints:structuredClone(opening)
  }};
}
const run=(x)=>reconcileGrossPartyCheckpoints(x);
const exact=rows=>scenario(rows.current||[],rows.opening||[]);
const assertRejected=(x)=>assert.throws(()=>run(x),
  /^Error: Gross checkpoint parity unavailable$/);
const normal=()=>scenario([
  customer(),supplier(),vendor('VENDOR_PAYABLE'),vendor('VENDOR_RECEIVABLE'),
  finance('OWNER_EQUITY'),finance('LENDER_LOAN_PAYABLE'),
  finance('BORROWER_CREDIT')
],[openingCustomer(),openingSupplier()]);

test('one source identity can preserve current receivable and opposite historical advance',()=>{
  const r=run(normal());
  assert.equal(r.offlineCheckpointParity,true);
  assert.deepEqual(r.counts,{
    expectedCurrent:7,observedCurrent:7,
    expectedOpening:2,observedOpening:2
  });
  assert.deepEqual(r.issues,[]);
});
test('Customer same original Current Due cannot be both receivable and advance at once',()=>{
  assertRejected(scenario([customer(),customer('CUS-001','PT-CUSTOMER','CUSTOMER_ADVANCE')]));
});
test('Supplier same original Current Due cannot be both payable and advance at once',()=>{
  assertRejected(scenario([supplier(),supplier('SUP-001','PT-SUPPLIER','SUPPLIER_PAYABLE')]));
});
test('Finance Owner equity and advance cannot coexist for one original Person ID',()=>{
  assertRejected(scenario([finance('OWNER_EQUITY'),finance('OWNER_ADVANCE')]));
});
test('Finance Lender payable and credit cannot coexist for one original Person ID',()=>{
  assertRejected(scenario([finance('LENDER_LOAN_PAYABLE'),finance('LENDER_CREDIT')]));
});
test('Finance Borrower receivable and credit cannot coexist for one original Person ID',()=>{
  assertRejected(scenario([finance('BORROWER_LOAN_RECEIVABLE'),finance('BORROWER_CREDIT')]));
});
test('Customer current and historical balances from one source ID must retain same Party identity',()=>{
  assertRejected(scenario([customer()],[openingCustomer('PT-IMPROPER-NEW')]));
});
test('Vendor payable and receivable for one Vendor cannot be assigned to different Parties',()=>{
  assertRejected(scenario([vendor('VENDOR_PAYABLE'),
    vendor('VENDOR_RECEIVABLE','PT-OTHER-VENDOR')]));
});
test('one original Finance Person cannot split Owner and Lender accounts across Parties',()=>{
  assertRejected(scenario([
    finance('OWNER_EQUITY'),finance('LENDER_LOAN_PAYABLE','PT-OTHER')
  ]));
});
test('same original Customer ID in current and historical may have opposite kinds for same Party',()=>{
  const r=run(scenario([customer()],[openingCustomer()]));
  assert.equal(r.offlineCheckpointParity,true);
});
test('two distinct original Customer IDs can correctly belong to different Parties',()=>{
  const r=run(scenario([customer(),
    customer('CUS-002','PT-CUSTOMER-2','CUSTOMER_ADVANCE')]));
  assert.equal(r.offlineCheckpointParity,true);
});
test('separate original Finance roles of one Person may hold three different signed positions',()=>{
  const r=run(scenario([finance('OWNER_ADVANCE'),finance('LENDER_CREDIT'),
    finance('BORROWER_LOAN_RECEIVABLE')]));
  assert.equal(r.offlineCheckpointParity,true);
});
test('both two-way Vendor obligations remain independent and valid together',()=>{
  assert.equal(run(scenario([vendor('VENDOR_PAYABLE'),
    vendor('VENDOR_RECEIVABLE')])).offlineCheckpointParity,true);
});
test('one repeated identical expected checkpoint still uses existing PLAN_DUPLICATE_CHECKPOINT report',()=>{
  const original=customer();
  const r=run(scenario([original,{...original}]));
  assert.equal(r.sourcePlanValid,false);
  assert.equal(r.readbackChecked,false);
  assert.ok(r.issues.some(i=>i.stage==='PLAN'&&i.code==='PLAN_DUPLICATE_CHECKPOINT'));
});
test('readback-only Party or sign drift stays a redacted missing/extra mismatch, not a source exception',()=>{
  for(const mutate of [
    x=>x.readback.currentCheckpoints[0].partyId='PT-OTHER',
    x=>x.readback.currentCheckpoints[0].kind='CUSTOMER_ADVANCE'
  ]){
    const x=scenario([customer()]);mutate(x);
    const r=run(x);
    assert.equal(r.sourcePlanValid,true);
    assert.equal(r.currentMatch,false);
    assert.equal(r.offlineCheckpointParity,false);
    assert.equal(r.issues.find(i=>i.code==='MISSING_CHECKPOINT').count,1);
    assert.equal(r.issues.find(i=>i.code==='EXTRA_CHECKPOINT').count,1);
  }
});
test('expected contradiction rejects before inspecting caller-provided readback and leaks nothing',()=>{
  const x=scenario([customer(),customer('CUS-001','PT-CUSTOMER','CUSTOMER_ADVANCE')]);
  x.readback=new Proxy({},{
    get(){throw new Error('PRIVATE_SOURCE_AND_AMOUNT_12345')},
    getPrototypeOf(){throw new Error('PRIVATE_SOURCE_AND_AMOUNT_12345')}
  });
  assertRejected(x);
});
test('the new expected source guard is immutable and results contain only redacted counters',()=>{
  const x=normal(),before=structuredClone(x);
  const result=run(x);
  assert.deepEqual(x,before);
  assert.doesNotMatch(JSON.stringify(result),
    /PT-CUSTOMER|PT-SUPPLIER|PT-VENDOR|PT-FINANCE|CUS-001|SUP-001|VEN-001|FIN-001|OWNER_EQUITY|BORROWER_CREDIT|amountMinor|sourceId/);
});
