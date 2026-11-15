import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareGrossPartyBalances} from '../src/party/gross-balance-preflight.js';

const source=()=>({
  CUSTOMERS:[],
  SUPPLIERS:[],
  VENDORS:[],
  FINANCE_PERSONS:[{
    'Person ID':'FP-A1',
    'Person Name':'Synthetic Finance Person',
    'Person Type':'Owner',
    Roles:'Owner,Lender,Borrower',
    Phone:'01912340000',
    Status:'Active',
    _rowIndex:2
  }],
  EXPENSE_PAYEES:[]
});
const txn=(id,type='Owner Investment',amount='100.00')=>({
  'Finance ID':id,
  'Person ID':'FP-A1',
  Person:'Synthetic Finance Person',
  'Transaction Type':type,
  Amount:amount,
  'Is Deleted':''
});
const audit=(financeRows,sourceRows=source())=>prepareGrossPartyBalances({
  sourceRows,financeRows,approvedGroups:[]
});
const codes=result=>result.blockingIssues.map(x=>x.reason);
const financePositions=result=>result.currentCheckpoints.filter(x=>x.sourceGroup==='FINANCE_PERSONS');

for(const [label,mutate] of [
  ['missing Amount column',row=>{delete row.Amount;}],
  ['explicit undefined Amount',row=>{row.Amount=undefined;}],
  ['null Amount',row=>{row.Amount=null;}],
  ['empty-string Amount',row=>{row.Amount='';}],
  ['whitespace-only Amount',row=>{row.Amount='   ';}]
]){
  test('active finance transaction with '+label+' must be quarantined instead of certified zero',()=>{
    const rows=[txn('FIN-T1')];mutate(rows[0]);
    const originals=structuredClone(rows),masters=source();
    const result=audit(rows,masters);
    assert.equal(result.readyForAccountDesignReview,false);
    assert.ok(codes(result).includes('FINANCE_AMOUNT_REQUIRED'));
    assert.deepEqual(financePositions(result),[]);
    assert.equal(result.summary.sourceFinanceRows,1);
    assert.equal(result.summary.deletedFinanceRows,0);
    assert.equal(result.summary.effects.cashMovementMinor,0);
    assert.deepEqual(rows,originals);
    assert.deepEqual(masters,source());
    assert.doesNotMatch(JSON.stringify(result),/Synthetic Finance Person|01912340000/);
  });
}

for(const value of [0,'0','0.00']){
  test('active Finance Amount '+JSON.stringify(value)+' is not positive and cannot certify import',()=>{
    const result=audit([txn('FIN-ZERO','Loan Received',value)]);
    assert.equal(result.readyForAccountDesignReview,false);
    assert.ok(codes(result).includes('FINANCE_ZERO_AMOUNT'));
    assert.deepEqual(financePositions(result),[]);
    assert.equal(result.grossCurrentTotalsMinor.LENDER_LOAN_PAYABLE,undefined);
  });
}

test('valid money remains intact while a separate missing transaction blocks overall readiness',()=>{
  const good=txn('FIN-GOOD','Loan Received','145.20');
  const missing=txn('FIN-BAD','Borrower Loan',null);
  const rows=[good,missing],before=structuredClone(rows);
  const result=audit(rows);
  assert.equal(result.readyForAccountDesignReview,false);
  assert.ok(codes(result).includes('FINANCE_AMOUNT_REQUIRED'));
  assert.deepEqual(financePositions(result).map(x=>({
    kind:x.kind,amountMinor:x.amountMinor,sourceId:x.sourceId
  })),[{kind:'LENDER_LOAN_PAYABLE',amountMinor:14520,sourceId:'FP-A1'}]);
  assert.deepEqual(rows,before);
});

test('valid positive Owner Lender Borrower transactions retain independent gross account buckets',()=>{
  const rows=[
    txn('FIN-1','Owner Investment','22.50'),
    txn('FIN-2','Loan Received','30.01'),
    txn('FIN-3','Borrower Loan','11.25')
  ];
  const result=audit(rows);
  assert.equal(result.readyForAccountDesignReview,true);
  assert.deepEqual(result.blockingIssues,[]);
  assert.deepEqual(result.grossCurrentTotalsMinor,{
    BORROWER_LOAN_RECEIVABLE:1125,
    LENDER_LOAN_PAYABLE:3001,
    OWNER_EQUITY:2250
  });
  assert.deepEqual(result.summary.effects,{
    cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0
  });
});

test('deleted finance row with incomplete Amount does not affect current balances',()=>{
  const deleted=txn('FIN-DELETED','Owner Withdrawal',null);
  deleted['Is Deleted']=true;
  const result=audit([txn('FIN-LIVE','Owner Investment','9.01'),deleted]);
  assert.equal(result.readyForAccountDesignReview,true);
  assert.deepEqual(result.blockingIssues,[]);
  assert.equal(result.summary.sourceFinanceRows,2);
  assert.equal(result.summary.deletedFinanceRows,1);
  assert.equal(result.grossCurrentTotalsMinor.OWNER_EQUITY,901);
});

test('negative finance Amount retains existing blocker and invalid precision remains hard-rejected',()=>{
  const negative=audit([txn('FIN-NEG','Borrower Loan','-1.00')]);
  assert.equal(negative.readyForAccountDesignReview,false);
  assert.ok(codes(negative).includes('FINANCE_NEGATIVE_AMOUNT'));
  assert.ok(!codes(negative).includes('FINANCE_ZERO_AMOUNT'));
  assert.throws(()=>audit([txn('FIN-FRAC','Loan Received','0.001')]),
    /Invalid monetary amount or precision/);
});

test('original source finance transaction writer requires a strictly positive amount',()=>{
  const pinned=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
  assert.match(pinned,/!isValidNonNegativeNumber_\(payload\.amount\)\s*\|\|\s*Number\(payload\.amount\)\s*<=\s*0/);
  assert.match(pinned,/if\s*\(amount\s*<=\s*0\)\s*return fail_\(/);
});
