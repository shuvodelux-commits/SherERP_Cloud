import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDashboardFinanceSummary}
  from '../src/modules/dashboard-finance-summary-read.js';

const finance=readFileSync(new URL('../legacy/source/FinanceModule.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
function fn(source,name){
  const a=source.indexOf('function '+name+'(');
  assert.ok(a>=0,'Frozen original helper absent: '+name);
  const end=source.indexOf('\n}\n',a);
  assert.ok(end>a,'Frozen helper end absent: '+name);
  return source.slice(a,end+3);
}
const typesStart=finance.indexOf('const FINANCE_TRANSACTION_TYPES = [');
const typesEnd=finance.indexOf('\n];',typesStart);
assert.ok(typesStart>=0&&typesEnd>typesStart,'Frozen finance type table missing');
const source=[
  finance.slice(typesStart,typesEnd+3),
  fn(finance,'financeTransactionType_'),
  fn(finance,'financeTxnPersonKey_'),
  fn(finance,'financeSignedBalances_'),
  fn(finance,'financeBalanceSummary_'),
  fn(utils,'roundMoney_')
].join('\n');
function original(rows){
  return JSON.parse(JSON.stringify(runInNewContext(
    source+'\nfinanceBalanceSummary_(activeTransactions)',{activeTransactions:rows}
  )));
}
const snap=(rows=[])=>({activeTransactions:rows});
const tx=(personId,person,type,amount)=>({
  'Person ID':personId,Person:person,'Transaction Type':type,Amount:amount
});
function parity(rows){
  const actual=projectDashboardFinanceSummary(snap(rows));
  assert.deepEqual(actual,original(rows));
  assert.deepEqual(Object.keys(actual),[
    'ownerCapital','ownerAdvance','outstandingLoan','lenderCredit',
    'borrowerReceivable','borrowerCredit'
  ]);
  return actual;
}

test('frozen nine transaction types keep Owner, Lender and Borrower accounts separate including openings',()=>{
  const rows=[
    tx('P-1','Rahman','Opening Owner Capital',100),
    tx('P-1','Rahman','Owner Investment',30),
    tx('P-1','Rahman','Owner Withdrawal',25),
    tx('P-1','Rahman','Opening Loan',75),
    tx('P-1','Rahman','Loan Received',40),
    tx('P-1','Rahman','Loan Repayment',15),
    tx('P-1','Rahman','Opening Borrower Loan',30),
    tx('P-1','Rahman','Borrower Loan',20),
    tx('P-1','Rahman','Borrower Repayment',5)
  ];
  assert.deepEqual(parity(rows),{
    ownerCapital:105,ownerAdvance:0,outstandingLoan:100,
    lenderCredit:0,borrowerReceivable:45,borrowerCredit:0
  });
});
test('gross positive and credit/advance buckets do not cancel across people or between roles',()=>{
  const rows=[
    tx('O+','Same','Owner Investment',100),
    tx('O-','Same','Owner Withdrawal',40),
    tx('L+','Same','Loan Received',80),
    tx('L-','Same','Loan Repayment',30),
    tx('B+','Same','Borrower Loan',60),
    tx('B-','Same','Borrower Repayment',20)
  ];
  assert.deepEqual(parity(rows),{
    ownerCapital:100,ownerAdvance:40,outstandingLoan:80,
    lenderCredit:30,borrowerReceivable:60,borrowerCredit:20
  });
});
test('legacy normalized name grouping differs from identified person; no unsafe name-based identity merger',()=>{
  const rows=[
    tx('','  MD   Rana  ','Loan Received',15),
    tx(null,'md rana','Loan Repayment',5),
    tx('P-200','Md Rana','Loan Received',40),
    tx('P-201','Md Rana','Loan Repayment',2)
  ];
  assert.deepEqual(parity(rows),{
    ownerCapital:0,ownerAdvance:0,outstandingLoan:50,
    lenderCredit:2,borrowerReceivable:0,borrowerCredit:0
  });
});
test('per-person account balance rounds after each transaction and final totals round separately',()=>{
  const rows=[
    tx('P-1','A','Owner Investment',0.105),
    tx('P-1','A','Owner Investment',0.105),
    tx('P-2','B','Owner Investment',0.105),
    tx('P-3','C','Loan Received','2.125'),
    tx('P-3','C','Loan Repayment','0.125')
  ];
  const result=parity(rows);
  assert.equal(result.ownerCapital,0.33);
  assert.equal(result.outstandingLoan,2.01);
});
test('source unknown types ignored; bad scalar amounts become zero; no synthetic cash move',()=>{
  const rows=[
    tx('P-1','A','Not A Finance Transaction',500),
    tx('P-1','A','Loan Received','not-number'),
    tx('P-1','A','Loan Received',null),
    tx('P-1','A','Loan Received',10),
    tx('P-1','A','Loan Repayment',3),
    tx('P-1','A','Borrower Loan',NaN)
  ];
  assert.deepEqual(parity(rows),{
    ownerCapital:0,ownerAdvance:0,outstandingLoan:7,
    lenderCredit:0,borrowerReceivable:0,borrowerCredit:0
  });
});
test('zero, immutable and repeat projections do not modify original transaction rows',()=>{
  assert.deepEqual(parity([]),{
    ownerCapital:0,ownerAdvance:0,outstandingLoan:0,
    lenderCredit:0,borrowerReceivable:0,borrowerCredit:0
  });
  const rows=Object.freeze([
    Object.freeze(tx('P-1','A','Owner Investment',20)),
    Object.freeze(tx('P-2','B','Loan Received',8))
  ]);
  assert.deepEqual(projectDashboardFinanceSummary(Object.freeze(snap(rows))),original(rows));
  assert.equal(projectDashboardFinanceSummary(snap([])).outstandingLoan,0);
});
test('reject malformed, forged, accessor, Promise, Infinity and nonplain source rows',()=>{
  const good=tx('P-1','A','Loan Received',5);
  for(const bad of [
    null,undefined,[],Promise.resolve(snap()),
    {activeTransactions:null},{activeTransactions:{}},
    {...snap(),actor:'Administrator'},
    {...snap(),tenant:'OTHER-BUSINESS'},
    {...snap(),permissions:{finance:{view:true}}},
    snap([Promise.resolve(good)]),
    snap([new Date()]),
    snap([tx('P-1','A','Loan Received',Infinity)]),
    snap([tx('P-1','A','Loan Received',{value:5})]),
    snap([tx('P-1','A','Loan Received',Symbol('5'))]),
    snap([Object.defineProperty({...good},'Amount',{
      enumerable:true,get(){throw Error('ACCESSOR');}
    })]),
    Object.defineProperty({},'activeTransactions',{
      enumerable:true,get(){throw Error('SNAPSHOT GETTER');}
    }),
    snap(new Array(1)),
  ])assert.throws(()=>projectDashboardFinanceSummary(bad),
    /invalid|trusted|row|snapshot|array|amount/i);
});
test('read-only source projector does not enable public Dashboard RPC or D1 access',()=>{
  const implementation=readFileSync(new URL('../src/modules/dashboard-finance-summary-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(implementation,/\b(?:prepare|batch|fetch|exec)\s*\(/);
  assert.doesNotMatch(implementation,/\b(?:INSERT|UPDATE|DELETE)\s+/i);
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.match(dashboard,/financeBalanceSummary_\(activeRows_\('FINANCE_TRANSACTIONS'\)\)/);
  const summary=parity([tx('P-1','A','Borrower Loan',8)]);
  assert.equal(summary.borrowerReceivable,8);
  assert.equal(summary.outstandingLoan,0);
});
