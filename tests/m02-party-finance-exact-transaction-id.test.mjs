import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareGrossPartyBalances} from '../src/party/gross-balance-preflight.js';

const masters=()=>({
  CUSTOMERS:[],SUPPLIERS:[],VENDORS:[],
  FINANCE_PERSONS:[{
    'Person ID':'FIN-PERSON-1','Person Name':'Synthetic Finance Person',
    'Person Type':'Owner',Roles:'Owner,Lender,Borrower',
    Phone:'',Status:'Active',_rowIndex:2
  }],
  EXPENSE_PAYEES:[]
});
const tx=(financeId,type='Owner Investment',amount='100.00')=>({
  'Finance ID':financeId,'Person ID':'FIN-PERSON-1',
  'Person':'Synthetic Finance Person',
  'Transaction Type':type,Amount:amount,'Is Deleted':''
});
const report=rows=>prepareGrossPartyBalances({
  sourceRows:masters(),approvedGroups:[],financeRows:rows
});
const financePositions=out=>out.currentCheckpoints.filter(row=>
  row.sourceGroup==='FINANCE_PERSONS'
);
const reasons=out=>out.blockingIssues.map(x=>x.reason);

test('literal Finance IDs with equal trimmed text both contribute source Owner balance',()=>{
  const rows=[
    tx('F-001','Owner Investment','100.00'),
    tx(' F-001 ','Owner Withdrawal','30.00')
  ];
  const before=structuredClone(rows);
  const out=report(rows);
  assert.equal(out.readyForAccountDesignReview,true);
  assert.deepEqual(out.blockingIssues,[]);
  assert.equal(out.summary.sourceFinanceRows,2);
  assert.equal(out.grossCurrentTotalsMinor.OWNER_EQUITY,7000);
  assert.equal(out.grossCurrentTotalsMinor.OWNER_ADVANCE,undefined);
  assert.deepEqual(financePositions(out).map(x=>({
    sourceId:x.sourceId,kind:x.kind,amountMinor:x.amountMinor
  })),[{
    sourceId:'FIN-PERSON-1',kind:'OWNER_EQUITY',amountMinor:7000
  }]);
  assert.deepEqual(rows,before,'preflight may never normalize source finance IDs in place');
});

test('two whitespace-distinct Finance IDs preserve full Lender payable rather than drop both',()=>{
  const rows=[tx('F-L1','Loan Received','180.00'),tx(' F-L1 ','Loan Repayment','80.00')];
  const out=report(rows);
  assert.equal(out.readyForAccountDesignReview,true);
  assert.equal(out.grossCurrentTotalsMinor.LENDER_LOAN_PAYABLE,10000);
  assert.equal(out.blockingIssues.length,0);
});

test('two exact repeated active Finance IDs remain quarantined and do not count either',()=>{
  const out=report([tx('F-DUP'),tx('F-DUP','Owner Investment','5.00')]);
  assert.equal(out.readyForAccountDesignReview,false);
  assert.deepEqual(reasons(out),['FINANCE_ID_DUPLICATE']);
  assert.equal(out.grossCurrentTotalsMinor.OWNER_EQUITY,undefined);
  assert.deepEqual(financePositions(out),[]);
});

test('blank and whitespace-only original Finance IDs remain missing-ID blockers',()=>{
  for(const id of ['', '   ', '\t\n']){
    const out=report([tx(id)]);
    assert.equal(out.readyForAccountDesignReview,false);
    assert.deepEqual(reasons(out),['FINANCE_ID_REQUIRED']);
    assert.deepEqual(financePositions(out),[]);
  }
});

test('inactive soft-deleted transaction never conflicts with its valid active ID',()=>{
  const rows=[tx('F-SAME','Owner Investment','100.00'),tx('F-SAME','Owner Withdrawal','90.00')];
  rows[1]['Is Deleted']='TRUE';
  const out=report(rows);
  assert.equal(out.readyForAccountDesignReview,true);
  assert.equal(out.summary.deletedFinanceRows,1);
  assert.equal(out.grossCurrentTotalsMinor.OWNER_EQUITY,10000);
  assert.equal(reasons(out).includes('FINANCE_ID_DUPLICATE'),false);
});

test('source row order does not change checkpoint totals for whitespace-distinct Finance IDs',()=>{
  const rows=[tx(' F-A ','Borrower Loan','24.50'),tx('F-A','Borrower Repayment','10.25')];
  const original=structuredClone(rows);
  const a=report(rows),b=report([...rows].reverse());
  assert.equal(a.readyForAccountDesignReview,true);
  assert.deepEqual(a.grossCurrentTotalsMinor,b.grossCurrentTotalsMinor);
  assert.equal(a.grossCurrentTotalsMinor.BORROWER_LOAN_RECEIVABLE,1425);
  assert.deepEqual(a.currentCheckpoints,b.currentCheckpoints);
  assert.deepEqual(rows,original);
  assert.deepEqual(a.summary.effects,{cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0});
});

test('frozen GAS finance source retains literal Finance ID identity rather than trim-normalizing it',()=>{
  const original=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
  assert.match(original,/'Finance ID': id,/);
  assert.match(original,/String\(a\['Finance ID'\]\)\.localeCompare\(String\(b\['Finance ID'\]\)\)/);
});
