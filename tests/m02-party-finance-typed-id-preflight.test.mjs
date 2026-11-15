import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareGrossPartyBalances} from '../src/party/gross-balance-preflight.js';

const source=(id='42')=>({
  CUSTOMERS:[],SUPPLIERS:[],VENDORS:[],
  FINANCE_PERSONS:[{
    'Person ID':id,
    'Person Name':'Synthetic Owner',
    Roles:'Owner,Lender,Borrower','Person Type':'Owner',
    Phone:'01977770000',Status:'Active',_rowIndex:2
  }],
  EXPENSE_PAYEES:[]
});
const txn=(financeId='TX-001',personId='42',type='Owner Investment',amount='20.00')=>({
  'Finance ID':financeId,'Person ID':personId,'Person':'Synthetic Owner',
  'Transaction Type':type,'Amount':amount,'Is Deleted':''
});
const audit=(rows,masters=source())=>prepareGrossPartyBalances({
  sourceRows:masters,financeRows:rows,approvedGroups:[]
});
const codes=result=>result.blockingIssues.map(item=>item.reason);
const positions=result=>result.currentCheckpoints.filter(row=>row.sourceGroup==='FINANCE_PERSONS');
const privateValues=/Synthetic Owner|01977770000|TX-001|TX-002/;

test('numeric Person ID cannot impersonate a string master with equal printed characters',()=>{
  const rows=[txn('TX-001',42)],original=structuredClone(rows);
  const report=audit(rows);
  assert.equal(report.readyForAccountDesignReview,false);
  assert.ok(codes(report).includes('FINANCE_PERSON_ID_INVALID_TYPE'));
  assert.deepEqual(positions(report),[]);
  assert.deepEqual(rows,original);
  assert.doesNotMatch(JSON.stringify(report.blockingIssues),privateValues);
});

for(const invalid of [true,{id:'42'},['42']]){
  test('nonstring Person ID '+typeof invalid+' cannot be coerced into source identity',()=>{
    const result=audit([txn('TX-001',invalid)]);
    assert.equal(result.readyForAccountDesignReview,false);
    assert.ok(codes(result).includes('FINANCE_PERSON_ID_INVALID_TYPE'));
    assert.deepEqual(positions(result),[]);
  });
}

for(const invalid of [123,true,{id:'TX-001'}]){
  test('nonstring Finance ID '+typeof invalid+' blocks import readiness',()=>{
    const result=audit([txn(invalid)]);
    assert.equal(result.readyForAccountDesignReview,false);
    assert.ok(codes(result).includes('FINANCE_ID_INVALID_TYPE'));
    assert.deepEqual(positions(result),[]);
  });
}

test('numeric Finance ID must not collide with a legitimate string ID of same printed form',()=>{
  const rows=[
    txn(123,'42','Loan Received','99.00'),
    txn('123','42','Owner Investment','20.01')
  ];
  const original=structuredClone(rows);
  const result=audit(rows);
  assert.equal(result.readyForAccountDesignReview,false);
  assert.ok(codes(result).includes('FINANCE_ID_INVALID_TYPE'));
  assert.ok(!codes(result).includes('FINANCE_ID_DUPLICATE'));
  assert.deepEqual(positions(result).map(row=>({
    kind:row.kind,amountMinor:row.amountMinor,sourceId:row.sourceId
  })),[{kind:'OWNER_EQUITY',amountMinor:2001,sourceId:'42'}]);
  assert.deepEqual(rows,original);
});

test('distinct literal string Finance IDs differing only in whitespace remain separate',()=>{
  const rows=[
    txn('TX-001','42','Owner Investment','10.00'),
    txn(' TX-001 ','42','Owner Investment','15.00')
  ];
  const result=audit(rows);
  assert.equal(result.readyForAccountDesignReview,true);
  assert.deepEqual(result.blockingIssues,[]);
  assert.equal(result.grossCurrentTotalsMinor.OWNER_EQUITY,2500);
  assert.equal(positions(result).length,1,'source account totals stay per Person ID');
});

for(const [field,invalid] of [
  ['Finance ID',null],['Finance ID','   '],
  ['Person ID',undefined],['Person ID','  ']
]){
  test('missing or blank '+field+' retains existing REQUIRED blocker',()=>{
    const row=txn();
    row[field]=invalid;
    const result=audit([row]);
    assert.equal(result.readyForAccountDesignReview,false);
    assert.ok(codes(result).includes(field==='Finance ID'?
      'FINANCE_ID_REQUIRED':'FINANCE_PERSON_ID_REQUIRED'));
    assert.deepEqual(positions(result),[]);
  });
}

test('exact duplicate valid Finance ID still blocks, without double posting',()=>{
  const result=audit([
    txn('TX-SAME','42','Owner Investment','10.00'),
    txn('TX-SAME','42','Owner Investment','30.00')
  ]);
  assert.equal(result.readyForAccountDesignReview,false);
  assert.ok(codes(result).includes('FINANCE_ID_DUPLICATE'));
  assert.deepEqual(positions(result),[]);
});

test('deleted finance transaction with malformed IDs has no current effect',()=>{
  const deleted=txn({id:'bad'},true,'Owner Withdrawal',null);
  deleted['Is Deleted']=true;
  const report=audit([txn('TX-LIVE','42','Owner Investment','7.50'),deleted]);
  assert.equal(report.readyForAccountDesignReview,true);
  assert.equal(report.summary.deletedFinanceRows,1);
  assert.deepEqual(report.blockingIssues,[]);
  assert.equal(report.grossCurrentTotalsMinor.OWNER_EQUITY,750);
});

test('strictly typed valid ID source still preserves three independent finance accounts',()=>{
  const rows=[
    txn('TX-OWNER','42','Owner Investment','21.10'),
    txn('TX-LENDER','42','Loan Received','8.05'),
    txn('TX-BORROW','42','Borrower Loan','7.02')
  ],masters=source();
  const original=structuredClone({rows,masters});
  const report=audit(rows,masters);
  assert.equal(report.readyForAccountDesignReview,true);
  assert.deepEqual(report.grossCurrentTotalsMinor,{
    BORROWER_LOAN_RECEIVABLE:702,LENDER_LOAN_PAYABLE:805,OWNER_EQUITY:2110
  });
  assert.deepEqual(report.summary.effects,{cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0});
  assert.deepEqual({rows,masters},original);
});

test('frozen original Finance writer generates a transaction ID and persists selected Person ID',()=>{
  const sourceCode=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
  assert.match(sourceCode,/generateId_\('FINANCE_TRANSACTIONS'\)/);
  assert.match(sourceCode,/'Finance ID': id, 'Date': txDate\.dateStr/);
  assert.match(sourceCode,/'Person ID': personId, 'Person': personName/);
});
