import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareGrossPartyBalances} from '../src/party/gross-balance-preflight.js';

const member=(sourceGroup,sourceId)=>({sourceGroup,sourceId});
const reviewed=[{members:[
  member('CUSTOMERS','CUS-001'),member('SUPPLIERS','SUP-001'),
  member('VENDORS','VEN-001'),member('FINANCE_PERSONS','FIN-001'),
  member('EXPENSE_PAYEES','PAY-001')
],reviewedBy:'synthetic-reviewer',reviewedAt:'2026-11-15T08:00:00Z',approvalRef:'SYN-ONLY-1'}];

const snapshot=()=>({
  CUSTOMERS:[{'Customer ID':'CUS-001','Customer Name':'Shared Company','Phone':'01700000000',
    'Current Due':'500.00','Opening Balance':'-100.00','_rowIndex':2}],
  SUPPLIERS:[{'Supplier ID':'SUP-001','Supplier Name':'Shared Company','Phone':'01700000000',
    'Current Due':'-300.00','Opening Balance':'80.00','_rowIndex':2}],
  VENDORS:[{'Vendor ID':'VEN-001','Vendor Name':'Shared Company','Phone':'01700000000',
    'Current Due':'300.00','Current Receivable':'150.00','_rowIndex':2}],
  FINANCE_PERSONS:[{'Person ID':'FIN-001','Person Name':'Shared Company','Phone':'01700000000',
    Roles:'Owner,Lender,Borrower','_rowIndex':2}],
  EXPENSE_PAYEES:[{'Payee ID':'PAY-001','Payee Name':'Shared Company','Phone':'01700000000','_rowIndex':2}]
});
const finance=()=>[
  {'Finance ID':'F-001','Person ID':'FIN-001','Person':'Shared Company',
    'Transaction Type':'Opening Owner Capital','Amount':'100.00'},
  {'Finance ID':'F-002','Person ID':'FIN-001','Person':'Shared Company',
    'Transaction Type':'Owner Investment','Amount':'50.00'},
  {'Finance ID':'F-003','Person ID':'FIN-001','Person':'Shared Company',
    'Transaction Type':'Owner Withdrawal','Amount':'200.00'},
  {'Finance ID':'F-004','Person ID':'FIN-001','Person':'Shared Company',
    'Transaction Type':'Loan Received','Amount':'300.00'},
  {'Finance ID':'F-005','Person ID':'FIN-001','Person':'Shared Company',
    'Transaction Type':'Loan Repayment','Amount':'80.00'},
  {'Finance ID':'F-006','Person ID':'FIN-001','Person':'Shared Company',
    'Transaction Type':'Borrower Loan','Amount':'90.00'},
  {'Finance ID':'F-007','Person ID':'FIN-001','Person':'Shared Company',
    'Transaction Type':'Borrower Repayment','Amount':'20.00'}
];
const preflight=(sourceRows=snapshot(),financeRows=finance(),approvedGroups=reviewed)=>
  prepareGrossPartyBalances({sourceRows,financeRows,approvedGroups});
const amount=(items,kind)=>items.filter(x=>x.kind===kind).reduce((t,x)=>t+x.amountMinor,0);

test('one reviewed Party preserves independent gross Customer, Supplier and two Vendor accounts',()=>{
  const result=preflight();
  assert.equal(result.readyForAccountDesignReview,true);
  assert.equal(result.summary.proposedParties,1);
  assert.deepEqual(result.blockingIssues,[]);
  assert.equal(amount(result.currentCheckpoints,'CUSTOMER_RECEIVABLE'),50000);
  assert.equal(amount(result.currentCheckpoints,'SUPPLIER_ADVANCE'),30000);
  assert.equal(amount(result.currentCheckpoints,'VENDOR_PAYABLE'),30000);
  assert.equal(amount(result.currentCheckpoints,'VENDOR_RECEIVABLE'),15000);
  assert.equal(amount(result.currentCheckpoints,'SUPPLIER_PAYABLE'),0);
  assert.equal(new Set(result.currentCheckpoints.map(x=>x.partyId)).size,1);
  assert.ok(result.currentCheckpoints.some(x=>x.sourceGroup==='VENDORS' && x.sourceField==='Current Receivable'));
  assert.ok(!JSON.stringify(result).includes('Shared Company'));
  assert.ok(!JSON.stringify(result).includes('01700000000'));
});

test('signed historical openings are separate baselines, never added to current money',()=>{
  const result=preflight();
  assert.equal(amount(result.openingCheckpoints,'CUSTOMER_ADVANCE'),10000);
  assert.equal(amount(result.openingCheckpoints,'SUPPLIER_PAYABLE'),8000);
  assert.equal(amount(result.currentCheckpoints,'CUSTOMER_ADVANCE'),0);
  assert.equal(amount(result.currentCheckpoints,'SUPPLIER_PAYABLE'),0);
  assert.deepEqual(result.summary.effects,{cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0});
  assert.ok(result.openingCheckpoints.every(x=>x.basis==='HISTORICAL_OPENING'));
  assert.ok(result.currentCheckpoints.every(x=>x.basis==='SOURCE_CURRENT'));
});

test('finance transactions use independent signed Owner, Lender and Borrower ledgers by stable Person ID',()=>{
  const result=preflight();
  assert.equal(amount(result.currentCheckpoints,'OWNER_ADVANCE'),5000);
  assert.equal(amount(result.currentCheckpoints,'OWNER_EQUITY'),0);
  assert.equal(amount(result.currentCheckpoints,'LENDER_LOAN_PAYABLE'),22000);
  assert.equal(amount(result.currentCheckpoints,'BORROWER_LOAN_RECEIVABLE'),7000);
  assert.equal(amount(result.currentCheckpoints,'LENDER_CREDIT'),0);
  assert.equal(amount(result.currentCheckpoints,'BORROWER_CREDIT'),0);
  assert.ok(result.currentCheckpoints.filter(x=>x.sourceGroup==='FINANCE_PERSONS').every(x=>x.sourceId==='FIN-001'));
  assert.ok(result.currentCheckpoints.every(x=>x.kind!=='PAYEE_PAYABLE'));
});

test('soft-deleted finance transactions do not change current balances',()=>{
  const rows=finance();
  rows[2]['Is Deleted']='TRUE';
  const result=preflight(snapshot(),rows);
  assert.equal(amount(result.currentCheckpoints,'OWNER_EQUITY'),15000);
  assert.equal(amount(result.currentCheckpoints,'OWNER_ADVANCE'),0);
  assert.equal(result.summary.deletedFinanceRows,1);
});

test('finance Person ID cannot be inferred by matching name, even on a reviewed Party',()=>{
  const rows=finance();
  rows[0]['Person ID']='';
  const result=preflight(snapshot(),rows);
  assert.equal(result.readyForAccountDesignReview,false);
  assert.ok(result.blockingIssues.some(x=>x.reason==='FINANCE_PERSON_ID_REQUIRED'));
  assert.equal(amount(result.currentCheckpoints,'OWNER_ADVANCE'),15000);
  assert.ok(result.blockingIssues.every(x=>!('personName' in x)));
});

test('unlinked or role-incompatible finance entries block design readiness',()=>{
  const rows=finance();
  rows[0]['Person ID']='OTHER-ID';
  const out=preflight(snapshot(),rows);
  assert.ok(out.blockingIssues.some(x=>x.reason==='FINANCE_LEGACY_LINK_MISSING'));
  const limited=snapshot();
  limited.FINANCE_PERSONS[0].Roles='Owner';
  const checked=preflight(limited,finance());
  assert.ok(checked.blockingIssues.some(x=>x.reason==='FINANCE_ROLE_NOT_MAPPED'));
  assert.equal(amount(checked.currentCheckpoints,'LENDER_LOAN_PAYABLE'),0);
});

test('duplicate active Finance ID and unknown transaction type are explicit blockers',()=>{
  const rows=finance();
  rows.push({...rows[0]});
  const duplicate=preflight(snapshot(),rows);
  assert.ok(duplicate.blockingIssues.some(x=>x.reason==='FINANCE_ID_DUPLICATE'));
  assert.equal(duplicate.readyForAccountDesignReview,false);
  const unknown=finance();
  unknown[0]['Transaction Type']='Loan Surprise';
  assert.ok(preflight(snapshot(),unknown).blockingIssues.some(x=>x.reason==='FINANCE_TYPE_UNKNOWN'));
});

test('bad amounts and negative vendor positions fail closed, with no invented account reversals',()=>{
  const bad=snapshot();
  bad.CUSTOMERS[0]['Current Due']='12.005';
  assert.throws(()=>preflight(bad),/invalid.*amount|precision/i);
  bad.CUSTOMERS[0]['Current Due']='Infinity';
  assert.throws(()=>preflight(bad),/invalid.*amount|precision/i);
  const vendor=snapshot();
  vendor.VENDORS[0]['Current Receivable']='-2.00';
  assert.ok(preflight(vendor).blockingIssues.some(x=>x.reason==='VENDOR_NEGATIVE_DIRECTION'));
  const financeBad=finance();
  financeBad[0].Amount='0.001';
  assert.throws(()=>preflight(snapshot(),financeBad),/invalid.*amount|precision/i);
});

test('pending identity reviews, malformed sources, and missing finance coverage never certify readiness',()=>{
  const unreviewed=preflight(snapshot(),finance(),[]);
  assert.equal(unreviewed.readyForAccountDesignReview,false);
  assert.ok(unreviewed.blockingIssues.some(x=>x.reason==='IDENTITY_REVIEW_PENDING'));
  assert.ok(new Set(unreviewed.currentCheckpoints.map(x=>x.partyId)).size>1);
  const missing=snapshot();
  missing.CUSTOMERS[0]['Customer ID']='';
  const blocked=preflight(missing,finance(),[]);
  assert.equal(blocked.readyForAccountDesignReview,false);
  assert.ok(blocked.blockingIssues.some(x=>x.reason==='UNRESOLVED_MASTER_ID'));
  assert.throws(()=>prepareGrossPartyBalances({sourceRows:snapshot(),approvedGroups:reviewed}),/finance.*required|coverage/i);
});

test('preflight is deterministic, never mutates source or posts money',()=>{
  const masters=snapshot(),transactions=finance(),before=structuredClone(masters),txBefore=structuredClone(transactions);
  const a=preflight(masters,transactions),b=preflight(masters,transactions);
  assert.deepEqual(a,b);
  assert.deepEqual(masters,before);
  assert.deepEqual(transactions,txBefore);
  assert.ok(Object.values(a.grossCurrentTotalsMinor).every(Number.isSafeInteger));
  assert.equal(a.summary.effects.postedLedgerRows,0);
});

test('source contract still contains all nine reviewed finance transaction directions and master sign rules',()=>{
  const financeSource=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
  const openingSource=readFileSync(new URL('../legacy/source/OpeningBalance.gs',import.meta.url),'utf8');
  const vendorSource=readFileSync(new URL('../legacy/source/Vendors.gs',import.meta.url),'utf8');
  for(const type of ['Owner Investment','Owner Withdrawal','Loan Received','Loan Repayment',
    'Borrower Loan','Borrower Repayment','Opening Owner Capital','Opening Loan','Opening Borrower Loan'])
    assert.ok(financeSource.includes("key:'"+type+"'"),type);
  assert.match(openingSource,/Customer\s+\+\s*= customer owes us/);
  assert.match(openingSource,/Supplier\s+\+\s*= we owe supplier/);
  assert.match(vendorSource,/Current Receivable.*they owe us|Current Receivable.*THEY owe US/i);
});

test('reviewed Party merge never grants one finance source ID another finance source ID role',()=>{
  const masters=snapshot();
  masters.FINANCE_PERSONS[0].Roles='Owner';
  masters.FINANCE_PERSONS.push({'Person ID':'FIN-002','Person Name':'Different Person',
    'Phone':'01700000000',Roles:'Lender','_rowIndex':3});
  const approvals=[{...reviewed[0],members:[...reviewed[0].members,member('FINANCE_PERSONS','FIN-002')]}];
  const transactions=[{'Finance ID':'F-L1','Person ID':'FIN-001','Transaction Type':'Loan Received','Amount':'500.00'},
    {'Finance ID':'F-L2','Person ID':'FIN-002','Transaction Type':'Loan Received','Amount':'20.00'}];
  const out=preflight(masters,transactions,approvals);
  assert.equal(out.summary.proposedParties,1);
  assert.ok(out.blockingIssues.some(x=>x.reason==='FINANCE_ROLE_NOT_MAPPED'&&x.sourceId==='FIN-001'));
  assert.equal(amount(out.currentCheckpoints,'LENDER_LOAN_PAYABLE'),2000);
});

test('two original finance IDs stay gross even after a reviewed Party merge',()=>{
  const masters=snapshot();
  masters.FINANCE_PERSONS.push({'Person ID':'FIN-002','Person Name':'Alternate Record',
    'Phone':'01700000000',Roles:'Owner','_rowIndex':3});
  const approvals=[{...reviewed[0],members:[...reviewed[0].members,member('FINANCE_PERSONS','FIN-002')]}];
  const transactions=[
    {'Finance ID':'F-A','Person ID':'FIN-001','Transaction Type':'Owner Investment','Amount':'100.00'},
    {'Finance ID':'F-B','Person ID':'FIN-002','Transaction Type':'Owner Withdrawal','Amount':'30.00'}
  ];
  const out=preflight(masters,transactions,approvals);
  assert.equal(out.readyForAccountDesignReview,true);
  assert.equal(out.summary.proposedParties,1);
  assert.equal(amount(out.currentCheckpoints,'OWNER_EQUITY'),10000);
  assert.equal(amount(out.currentCheckpoints,'OWNER_ADVANCE'),3000);
  assert.equal(out.currentCheckpoints.filter(x=>x.sourceGroup==='FINANCE_PERSONS').length,2);
});
