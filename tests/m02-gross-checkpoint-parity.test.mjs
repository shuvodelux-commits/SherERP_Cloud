import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGrossPartyBalances} from '../src/party/gross-balance-preflight.js';
import {reconcileGrossPartyCheckpoints} from '../src/party/gross-checkpoint-parity.js';

const member=(sourceGroup,sourceId)=>({sourceGroup,sourceId});
const reviewed=[{members:[
  member('CUSTOMERS','CUS-001'),member('SUPPLIERS','SUP-001'),
  member('VENDORS','VEN-001'),member('FINANCE_PERSONS','FIN-001'),
  member('EXPENSE_PAYEES','PAY-001')
],reviewedBy:'synthetic-reviewer',reviewedAt:'2026-11-15T08:00:00Z',
  approvalRef:'PRIVATE-REVIEW-REF'}];
const masters=()=>({
  CUSTOMERS:[{'Customer ID':'CUS-001','Customer Name':'PRIVATE PERSON',
    'Current Due':'500.00','Opening Balance':'-100.00','_rowIndex':2}],
  SUPPLIERS:[{'Supplier ID':'SUP-001','Supplier Name':'PRIVATE PERSON',
    'Current Due':'-300.00','Opening Balance':'80.00','_rowIndex':2}],
  VENDORS:[{'Vendor ID':'VEN-001','Vendor Name':'PRIVATE PERSON',
    'Current Due':'300.00','Current Receivable':'150.00','_rowIndex':2}],
  FINANCE_PERSONS:[{'Person ID':'FIN-001','Person Name':'PRIVATE PERSON',
    Roles:'Owner,Lender,Borrower','_rowIndex':2}],
  EXPENSE_PAYEES:[{'Payee ID':'PAY-001','Payee Name':'PRIVATE PERSON','_rowIndex':2}]
});
const finance=()=>[
  {'Finance ID':'TX-001','Person ID':'FIN-001','Transaction Type':'Opening Owner Capital','Amount':'100.00'},
  {'Finance ID':'TX-002','Person ID':'FIN-001','Transaction Type':'Owner Investment','Amount':'50.00'},
  {'Finance ID':'TX-003','Person ID':'FIN-001','Transaction Type':'Owner Withdrawal','Amount':'200.00'},
  {'Finance ID':'TX-004','Person ID':'FIN-001','Transaction Type':'Loan Received','Amount':'300.00'},
  {'Finance ID':'TX-005','Person ID':'FIN-001','Transaction Type':'Loan Repayment','Amount':'80.00'},
  {'Finance ID':'TX-006','Person ID':'FIN-001','Transaction Type':'Borrower Loan','Amount':'90.00'},
  {'Finance ID':'TX-007','Person ID':'FIN-001','Transaction Type':'Borrower Repayment','Amount':'20.00'}
];
const expected=({sourceRows=masters(),financeRows=finance(),approvedGroups=reviewed}={})=>
  prepareGrossPartyBalances({sourceRows,financeRows,approvedGroups});
function input(){
  const preflight=expected();
  return {preflight,readback:{
    currentCheckpoints:structuredClone(preflight.currentCheckpoints),
    openingCheckpoints:structuredClone(preflight.openingCheckpoints)
  }};
}
const run=(arg=input())=>reconcileGrossPartyCheckpoints(arg);
const has=(r,stage,code)=>r.issues.find(x=>x.stage===stage&&x.code===code);
const changed=(fn)=>{const x=input();fn(x);return run(x);};

test('original reviewed gross Party source checkpoints match independent exact account rows',()=>{
  const r=run();
  assert.deepEqual({
    version:r.formatVersion,source:r.sourcePlanValid,checked:r.readbackChecked,
    current:r.currentMatch,opening:r.openingMatch,offline:r.offlineCheckpointParity
  },{version:1,source:true,checked:true,current:true,opening:true,offline:true});
  assert.deepEqual(r.counts,{
    expectedCurrent:7,observedCurrent:7,expectedOpening:2,observedOpening:2
  });
  assert.deepEqual(r.issues,[]);
});
test('order of independently supplied current and historical readback never matters',()=>{
  const r=changed(x=>{
    x.readback.currentCheckpoints.reverse();
    x.readback.openingCheckpoints.reverse();
  });
  assert.equal(r.offlineCheckpointParity,true);
});
test('one reviewed Party identity retains every independent gross account kind, not a net Party Due',()=>{
  const x=input(),p=x.preflight.currentCheckpoints;
  assert.equal(new Set(p.map(r=>r.partyId)).size,1);
  assert.ok(['CUSTOMER_RECEIVABLE','SUPPLIER_ADVANCE','VENDOR_PAYABLE',
    'VENDOR_RECEIVABLE','OWNER_ADVANCE','LENDER_LOAN_PAYABLE',
    'BORROWER_LOAN_RECEIVABLE'].every(k=>p.some(r=>r.kind===k)));
  assert.equal(run(x).offlineCheckpointParity,true);
});
test('one missing Customer current gross row fails even if other role accounts remain',()=>{
  const r=changed(x=>{x.readback.currentCheckpoints.splice(
    x.readback.currentCheckpoints.findIndex(row=>row.kind==='CUSTOMER_RECEIVABLE'),1
  );});
  assert.equal(r.currentMatch,false);
  assert.equal(r.openingMatch,true);
  assert.equal(r.offlineCheckpointParity,false);
  assert.equal(has(r,'SOURCE_CURRENT','MISSING_CHECKPOINT').count,1);
});
test('one extra synthetic readback account fails despite all expected rows present',()=>{
  const r=changed(x=>x.readback.currentCheckpoints.push({
    ...x.readback.currentCheckpoints[0],sourceId:'NEW-ORIGINAL-SOURCE'
  }));
  assert.equal(has(r,'SOURCE_CURRENT','EXTRA_CHECKPOINT').count,1);
});
test('duplicate current readback original source/account is blocked instead of double counted',()=>{
  const r=changed(x=>x.readback.currentCheckpoints.push({
    ...x.readback.currentCheckpoints[0]
  }));
  assert.equal(r.currentMatch,false);
  assert.equal(has(r,'SOURCE_CURRENT','DUPLICATE_CHECKPOINT').count,1);
});
test('duplicate historical opening cannot be accepted as extra current due',()=>{
  const r=changed(x=>x.readback.openingCheckpoints.push({
    ...x.readback.openingCheckpoints[0]
  }));
  assert.equal(has(r,'HISTORICAL_OPENING','DUPLICATE_CHECKPOINT').count,1);
  assert.equal(r.openingMatch,false);
});
test('one-cent gross checkpoint drift fails on the exact original source and account',()=>{
  const r=changed(x=>{x.readback.currentCheckpoints[0].amountMinor+=1});
  assert.equal(r.offlineCheckpointParity,false);
  assert.equal(has(r,'SOURCE_CURRENT','AMOUNT_MISMATCH').count,1);
});
test('changing payable to receivable while holding amount constant must not cross-net',()=>{
  const r=changed(x=>{
    const row=x.readback.currentCheckpoints.find(r=>r.kind==='VENDOR_PAYABLE');
    row.kind='VENDOR_RECEIVABLE';
  });
  assert.equal(r.currentMatch,false);
  assert.ok(has(r,'SOURCE_CURRENT','MISSING_CHECKPOINT'));
  assert.ok(has(r,'SOURCE_CURRENT','EXTRA_CHECKPOINT'));
});
test('rewriting Party identity while keeping name and phone equivalent cannot establish parity',()=>{
  const r=changed(x=>{x.readback.currentCheckpoints[0].partyId='ALIAS-PARTY'});
  assert.equal(r.offlineCheckpointParity,false);
  assert.ok(has(r,'SOURCE_CURRENT','MISSING_CHECKPOINT'));
});
test('changing exact original source ID cannot be replaced by Party-level net totals',()=>{
  const r=changed(x=>{x.readback.currentCheckpoints[0].sourceId='DIFFERENT-LEGACY-ID'});
  assert.equal(r.offlineCheckpointParity,false);
  assert.ok(has(r,'SOURCE_CURRENT','EXTRA_CHECKPOINT'));
});
test('wrong source group with same Party ID, account and amount remains an error',()=>{
  const r=changed(x=>{x.readback.currentCheckpoints[0].sourceGroup='SUPPLIERS'});
  assert.equal(r.offlineCheckpointParity,false);
});
test('wrong original source field Current Due versus Opening Balance cannot pass',()=>{
  const r=changed(x=>{x.readback.currentCheckpoints[0].sourceField='Opening Balance'});
  assert.equal(r.offlineCheckpointParity,false);
});
test('historical opening cannot be silently moved into present-day SOURCE_CURRENT',()=>{
  const r=changed(x=>{
    const row=x.readback.openingCheckpoints.pop();
    x.readback.currentCheckpoints.push({...row,basis:'SOURCE_CURRENT'});
  });
  assert.equal(r.currentMatch,false);
  assert.equal(r.openingMatch,false);
  assert.ok(has(r,'HISTORICAL_OPENING','MISSING_CHECKPOINT'));
  assert.ok(has(r,'SOURCE_CURRENT','EXTRA_CHECKPOINT'));
});
test('a historical amount drift does not change correct current gross balance parity',()=>{
  const r=changed(x=>{x.readback.openingCheckpoints[0].amountMinor+=1});
  assert.equal(r.currentMatch,true);
  assert.equal(r.openingMatch,false);
  assert.equal(has(r,'HISTORICAL_OPENING','AMOUNT_MISMATCH').count,1);
});
test('soft-deleted Finance source events are not expected in the gross account snapshot',()=>{
  const tx=finance();tx[3]['Is Deleted']='TRUE';
  const preflight=expected({financeRows:tx});
  const r=run({preflight,readback:{
    currentCheckpoints:structuredClone(preflight.currentCheckpoints),
    openingCheckpoints:structuredClone(preflight.openingCheckpoints)
  }});
  assert.equal(r.offlineCheckpointParity,true);
});
test('unapproved identity plan causes readback stage to be skipped without inspecting supplied data',()=>{
  const preflight=expected({approvedGroups:[]});
  const r=run({preflight,readback:new Proxy({},{
    get(){throw new Error('must never examine unreviewed readback');}
  })});
  assert.equal(r.sourcePlanValid,false);
  assert.equal(r.readbackChecked,false);
  assert.equal(r.currentMatch,null);
  assert.equal(r.openingMatch,null);
  assert.equal(r.offlineCheckpointParity,false);
  assert.equal(r.counts.observedCurrent,null);
  assert.equal(r.counts.observedOpening,null);
  assert.ok(has(r,'PLAN','PLAN_BLOCKED'));
});
test('a forged preflight summary count blocks readback before touching it',()=>{
  const r=changed(x=>{x.preflight.summary.currentCheckpointCount--});
  assert.equal(r.readbackChecked,false);
  assert.ok(has(r,'PLAN','PLAN_COUNT_MISMATCH'));
});
test('a forged gross total cannot authorize parities despite unchanged per-source checkpoints',()=>{
  const r=changed(x=>{x.preflight.grossCurrentTotalsMinor.CUSTOMER_RECEIVABLE+=1});
  assert.equal(r.readbackChecked,false);
  assert.ok(has(r,'PLAN','PLAN_TOTAL_MISMATCH'));
});
test('a fabricated cash, bank or posted-ledger effect is disallowed at source plan stage',()=>{
  const r=changed(x=>{x.preflight.summary.effects.cashMovementMinor=100});
  assert.equal(r.readbackChecked,false);
  assert.ok(has(r,'PLAN','PLAN_EFFECTS_UNSAFE'));
});
test('wrong source pin or currency cannot claim approved source-based parity',()=>{
  for(const [field,value] of [['sourceCommit','different-sha'],['currency','USD']]){
    const r=changed(x=>{x.preflight[field]=value});
    assert.equal(r.readbackChecked,false);
    assert.ok(has(r,'PLAN','PLAN_SOURCE_MISMATCH'));
  }
});
test('duplicate checkpoint in claimed preflight is a blocked source plan',()=>{
  const r=changed(x=>{
    x.preflight.currentCheckpoints.push({...x.preflight.currentCheckpoints[0]});
    x.preflight.summary.currentCheckpointCount++;
  });
  assert.equal(r.readbackChecked,false);
  assert.ok(has(r,'PLAN','PLAN_DUPLICATE_CHECKPOINT'));
});
test('zero, negative, fractional or unsafe integer monetary readback is rejected without leaking value',()=>{
  for(const value of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'300',null]){
    const x=input();x.readback.currentCheckpoints[0].amountMinor=value;
    assert.throws(()=>run(x),/^Error: Gross checkpoint parity unavailable$/);
  }
});
test('invalid or missing original source checkpoint IDs are never coerced from numerics',()=>{
  for(const value of [null,0,'',true]){
    const x=input();x.readback.currentCheckpoints[0].sourceId=value;
    assert.throws(()=>run(x),/^Error: Gross checkpoint parity unavailable$/);
  }
});
test('extra unapproved row keys cannot silently become an accepted D1-shaped contract',()=>{
  const x=input();x.readback.currentCheckpoints[0].name='SECRET';
  assert.throws(()=>run(x),/^Error: Gross checkpoint parity unavailable$/);
});
test('missing or incorrect basis in a historical opening array fails closed',()=>{
  const x=input();x.readback.openingCheckpoints[0].basis='SOURCE_CURRENT';
  assert.throws(()=>run(x),/^Error: Gross checkpoint parity unavailable$/);
});
test('invalid outer data shapes fail with fixed error, not caller-provided data',()=>{
  for(const x of [null,{}, {preflight:{PRIVATE_ID:'SECRET'},readback:{}},
    {preflight:input().preflight,readback:{currentCheckpoints:[]}}]){
    assert.throws(()=>run(x),/^Error: Gross checkpoint parity unavailable$/);
  }
});
test('readback with no checkpoints is a well-formed mismatch, not a false pass',()=>{
  const r=changed(x=>{
    x.readback.currentCheckpoints=[];x.readback.openingCheckpoints=[];
  });
  assert.equal(r.offlineCheckpointParity,false);
  assert.equal(r.counts.observedCurrent,0);
  assert.equal(r.counts.observedOpening,0);
  assert.equal(has(r,'SOURCE_CURRENT','MISSING_CHECKPOINT').count,7);
  assert.equal(has(r,'HISTORICAL_OPENING','MISSING_CHECKPOINT').count,2);
});
test('report is fixed vocabulary only, never names, private IDs, account amounts or account kinds',()=>{
  const r=changed(x=>{
    x.readback.currentCheckpoints[0].amountMinor+=1;
    x.readback.currentCheckpoints[1].sourceId='SECRET_PARTY_SOURCE';
  });
  const out=JSON.stringify(r);
  assert.doesNotMatch(out,/CUS-001|SUP-001|VEN-001|FIN-001|PRIVATE PERSON|PRIVATE-REVIEW-REF|SECRET_PARTY_SOURCE|50000|30000|OWNER_ADVANCE|LENDER_LOAN_PAYABLE|CUSTOMER_RECEIVABLE|amountMinor|partyId/);
  assert.ok(r.issues.every(x=>Object.keys(x).sort().join(',')==='code,count,stage'));
  assert.equal(r.offlineCheckpointParity,false);
});
test('the comparison never mutates supplied source checkpoint or readback objects',()=>{
  const x=input(),prior=structuredClone(x);
  run(x);assert.deepEqual(x,prior);
});
test('no report claims D1 reconciliation, authenticated approval or production migration',()=>{
  const r=run();
  for(const k of ['productionReady','cutoverApproved','D1','partyAccounts',
    'postedLedgerRows','settlements','grossCurrentTotalsMinor','currentCheckpoints'])
    assert.equal(Object.hasOwn(r,k),false);
});
