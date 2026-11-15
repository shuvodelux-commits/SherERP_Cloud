import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGrossPartyBalances} from '../src/party/gross-balance-preflight.js';

const master=(id,roles,rowIndex)=>({
  'Person ID':id,'Person Name':'Synthetic '+id,
  Phone:'',Roles:roles,'Person Type':roles.split(',')[0],
  Status:'Active',_rowIndex:rowIndex
});
const txn=(id,personId,type,amount,deleted=false)=>({
  'Finance ID':id,'Person ID':personId,
  'Transaction Type':type,Amount:amount,'Is Deleted':deleted?'TRUE':''
});
const source=(people)=>({
  CUSTOMERS:[],SUPPLIERS:[],VENDORS:[],FINANCE_PERSONS:people,
  EXPENSE_PAYEES:[]
});
const audit=(financeRows,people=[master('FP-001','Owner,Lender',2)])=>
  prepareGrossPartyBalances({sourceRows:source(people),financeRows});
const reasons=result=>result.blockingIssues.map(x=>x.reason);
const positions=result=>result.currentCheckpoints.filter(x=>
  x.sourceGroup==='FINANCE_PERSONS');

test('two distinct literal Finance IDs with whitespace differences are not false duplicates',()=>{
  const rows=[
    txn('TX-001','FP-001','Owner Investment','12.50'),
    txn(' TX-001 ','FP-001','Loan Received','23.45')
  ];
  const masters=[master('FP-001','Owner,Lender',2)];
  const before=structuredClone({rows,masters});
  const result=audit(rows,masters);
  assert.equal(result.readyForAccountDesignReview,true,
    'literal Finance IDs must not be collapsed by trimming');
  assert.deepEqual(result.blockingIssues,[]);
  assert.deepEqual(result.grossCurrentTotalsMinor,{
    LENDER_LOAN_PAYABLE:2345,OWNER_EQUITY:1250
  });
  assert.equal(result.summary.sourceFinanceRows,2);
  assert.equal(result.summary.currentCheckpointCount,2);
  assert.deepEqual(result.summary.effects,{
    cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0
  });
  assert.deepEqual({rows,masters},before);
  assert.doesNotMatch(JSON.stringify(result),/Synthetic FP-001/);
});

test('distinct Finance transaction IDs across original Person IDs do not erase gross roles',()=>{
  const people=[
    master('FP-001','Owner',2),
    master('FP-002','Lender',3)
  ];
  const rows=[
    txn('T-99','FP-001','Owner Investment','10.00'),
    txn(' T-99 ','FP-002','Loan Received','25.00')
  ];
  const out=audit(rows,people);
  assert.equal(out.readyForAccountDesignReview,true);
  assert.deepEqual(out.blockingIssues,[]);
  assert.deepEqual(positions(out).map(({sourceId,kind,amountMinor})=>({
    sourceId,kind,amountMinor
  })),[
    {sourceId:'FP-001',kind:'OWNER_EQUITY',amountMinor:1000},
    {sourceId:'FP-002',kind:'LENDER_LOAN_PAYABLE',amountMinor:2500}
  ]);
  assert.equal(new Set(positions(out).map(x=>x.partyId)).size,2);
});

test('identical literal Finance transaction IDs still block both transactions, even across people',()=>{
  const people=[master('FP-001','Owner',2),master('FP-002','Lender',3)];
  const rows=[
    txn('T-99','FP-001','Owner Investment','10.00'),
    txn('T-99','FP-002','Loan Received','25.00')
  ];
  const result=audit(rows,people);
  assert.equal(result.readyForAccountDesignReview,false);
  assert.ok(reasons(result).includes('FINANCE_ID_DUPLICATE'));
  assert.deepEqual(positions(result),[]);
});

test('blank Finance ID is still quarantined and never assigned a synthetic source key',()=>{
  for(const id of ['', '   ', '\t']){
    const result=audit([txn(id,'FP-001','Owner Investment','19.00')]);
    assert.equal(result.readyForAccountDesignReview,false);
    assert.ok(reasons(result).includes('FINANCE_ID_REQUIRED'));
    assert.deepEqual(positions(result),[]);
  }
});

test('deleted Finance row remains excluded when its literal ID duplicates an active row',()=>{
  const result=audit([
    txn('T-1','FP-001','Owner Investment','5.00'),
    txn('T-1','FP-001','Owner Withdrawal','999.00',true)
  ]);
  assert.equal(result.readyForAccountDesignReview,true);
  assert.deepEqual(result.blockingIssues,[]);
  assert.equal(result.summary.deletedFinanceRows,1);
  assert.deepEqual(result.grossCurrentTotalsMinor,{OWNER_EQUITY:500});
});
