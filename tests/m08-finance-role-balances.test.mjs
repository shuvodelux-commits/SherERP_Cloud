import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFinanceRoleBalances} from '../src/modules/m08-finance-role-balances.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

// Exact nine original type directions; oracle executes frozen GAS balance functions.
const typeFields=[
  ['Owner Investment','owner',1,'in'],
  ['Owner Withdrawal','owner',-1,'out'],
  ['Loan Received','loanPayable',1,'in'],
  ['Loan Repayment','loanPayable',-1,'out'],
  ['Borrower Loan','borrowerReceivable',1,'out'],
  ['Borrower Repayment','borrowerReceivable',-1,'in'],
  ['Opening Owner Capital','owner',1,'none'],
  ['Opening Loan','loanPayable',1,'none'],
  ['Opening Borrower Loan','borrowerReceivable',1,'none']
];
const financeTypes=typeFields.map(([key,account,balanceEffect,cashDirection])=>({
  key,account,balanceEffect,cashDirection
}));
const clone=value=>JSON.parse(JSON.stringify(value));
function tx(type,amount,personId='P1',other={}){
  return {'Finance ID':other['Finance ID']||'F-'+type,
    'Transaction Type':type,'Amount':amount,
    'Person ID':personId,'Person':other.Person||'Finance Person',
    'Is Deleted':'',...other};
}
function source(rows,personId=null){
  const funcs=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'FinanceModule.gs':['financeTransactionType_','financeTxnPersonKey_',
      'financeSignedBalances_','financeBalanceSummary_']
  },{FINANCE_TRANSACTION_TYPES:financeTypes});
  return {
    byPerson:clone(funcs.financeSignedBalances_(rows,personId)),
    summary:clone(funcs.financeBalanceSummary_(rows,personId))
  };
}
function equalSource(rows,personId){
  const actual=projectFinanceRoleBalances(rows,personId?{personId}:undefined);
  assert.deepEqual(actual,source(rows,personId||null));
  return actual;
}

test('all nine source finance types preserve their independent owner, loan-payable and borrower-receivable signs',()=>{
  const rows=[
    tx('Opening Owner Capital',1000),
    tx('Owner Investment',250),
    tx('Owner Withdrawal',100),
    tx('Opening Loan',400),
    tx('Loan Received',100),
    tx('Loan Repayment',550),
    tx('Opening Borrower Loan',300),
    tx('Borrower Loan',200),
    tx('Borrower Repayment',560)
  ];
  const out=equalSource(rows);
  assert.deepEqual(out.byPerson['id:P1'],{
    personId:'P1',person:'Finance Person',owner:1150,
    loanPayable:-50,borrowerReceivable:-60
  });
  assert.deepEqual(out.summary,{
    ownerCapital:1150,ownerAdvance:0,
    outstandingLoan:0,lenderCredit:50,
    borrowerReceivable:0,borrowerCredit:60
  });
});

test('one verified finance person may hold three accounts without combining equity, debt and receivable',()=>{
  const rows=[
    tx('Owner Investment',100),tx('Loan Received',300),
    tx('Borrower Loan',700),tx('Owner Withdrawal',20),
    tx('Loan Repayment',40),tx('Borrower Repayment',50)
  ];
  const result=equalSource(rows);
  assert.equal(result.byPerson['id:P1'].owner,80);
  assert.equal(result.byPerson['id:P1'].loanPayable,260);
  assert.equal(result.byPerson['id:P1'].borrowerReceivable,650);
  assert.equal(result.summary.outstandingLoan,260);
});

test('two distinct original Person IDs with the same display name are not auto-merged',()=>{
  const rows=[
    tx('Owner Investment',500,'A',{Person:'Same Name'}),
    tx('Owner Withdrawal',25,'B',{Person:'Same Name'}),
    tx('Loan Received',80,'B',{Person:'Same Name'})
  ];
  const result=equalSource(rows);
  assert.deepEqual(Object.keys(result.byPerson),['id:A','id:B']);
  assert.equal(result.byPerson['id:A'].owner,500);
  assert.equal(result.byPerson['id:B'].owner,-25);
  assert.equal(result.byPerson['id:B'].loanPayable,80);
  assert.equal(result.summary.ownerCapital,500);
  assert.equal(result.summary.ownerAdvance,25);
});

test('six gross categories never net negative obligations against a different persons positive position',()=>{
  const rows=[
    tx('Owner Investment',80,'A'),
    tx('Loan Received',70,'A'),
    tx('Borrower Loan',60,'A'),
    tx('Owner Withdrawal',100,'B'),
    tx('Loan Repayment',110,'B'),
    tx('Borrower Repayment',120,'B')
  ];
  const result=equalSource(rows);
  assert.deepEqual(result.summary,{
    ownerCapital:80,ownerAdvance:100,
    outstandingLoan:70,lenderCredit:110,
    borrowerReceivable:60,borrowerCredit:120
  });
});

test('exact source Person ID filtering does not infer name, phone or other Party role',()=>{
  const rows=[
    tx('Owner Investment',100,'P1',{Person:'Shared'}),
    tx('Owner Investment',500,'P2',{Person:'Shared'}),
    tx('Borrower Loan',75,'P1',{Person:'Shared'})
  ];
  const result=equalSource(rows,'P1');
  assert.deepEqual(Object.keys(result.byPerson),['id:P1']);
  assert.equal(result.byPerson['id:P1'].owner,100);
  assert.equal(result.byPerson['id:P1'].borrowerReceivable,75);
  assert.equal(result.summary.ownerCapital,100);
});

test('source increments rounded account positions per posted row, not after netting',()=>{
  const rows=[
    tx('Owner Investment',0.1),
    tx('Owner Investment',0.2),
    tx('Owner Withdrawal',0.1),
    tx('Loan Received',0.105),
    tx('Loan Received',0.105)
  ];
  const result=equalSource(rows);
  assert.equal(result.byPerson['id:P1'].owner,0.2);
  assert.equal(result.byPerson['id:P1'].loanPayable,0.22);
});

test('historical opening rows contribute to original account baseline, without inventing any current cash/bank event',()=>{
  const openings=financeTypes.filter(t=>t.key.startsWith('Opening '));
  assert.equal(openings.length,3);
  assert.ok(openings.every(t=>t.cashDirection==='none'));
  const result=equalSource([
    tx('Opening Owner Capital',100),
    tx('Opening Loan',200),
    tx('Opening Borrower Loan',300)
  ]);
  assert.deepEqual(result.summary,{
    ownerCapital:100,ownerAdvance:0,
    outstandingLoan:200,lenderCredit:0,
    borrowerReceivable:300,borrowerCredit:0
  });
});

test('empty source row set returns six zero buckets and no invented persons',()=>{
  const result=equalSource([]);
  assert.deepEqual(result.byPerson,{});
  assert.deepEqual(result.summary,{
    ownerCapital:0,ownerAdvance:0,
    outstandingLoan:0,lenderCredit:0,
    borrowerReceivable:0,borrowerCredit:0
  });
});

test('frozen caller data and record ordering remain unchanged after projection',()=>{
  const a=Object.freeze(tx('Loan Received',90,'P2'));
  const b=Object.freeze(tx('Owner Investment',45,'P1'));
  const rows=Object.freeze([a,b]);
  const before=clone(rows);
  const result=equalSource(rows);
  assert.equal(result.byPerson['id:P1'].owner,45);
  assert.deepEqual(rows,before);
});

test('unreviewed legacy person names, deleted records, malformed amounts and leaked Promise fail closed',()=>{
  const valid=tx('Owner Investment',100);
  assert.throws(()=>projectFinanceRoleBalances(Promise.resolve([valid])),TypeError);
  assert.throws(()=>projectFinanceRoleBalances(null),TypeError);
  assert.throws(()=>projectFinanceRoleBalances([tx('Owner Investment',10,'')]),TypeError);
  assert.throws(()=>projectFinanceRoleBalances([tx('Loan Received',10,' ',{Person:'Same Name'})]),TypeError);
  assert.throws(()=>projectFinanceRoleBalances([tx('Invalid Type',10)]),TypeError);
  assert.throws(()=>projectFinanceRoleBalances([tx('Owner Investment',Infinity)]),TypeError);
  assert.throws(()=>projectFinanceRoleBalances([tx('Owner Investment',-5)]),TypeError);
  assert.throws(()=>projectFinanceRoleBalances([tx('Owner Investment',20,'P1',{'Is Deleted':true})]),TypeError);
  assert.throws(()=>projectFinanceRoleBalances([tx('Loan Received',20,'P1',{'Is Deleted':'TRUE'})]),TypeError);
  assert.throws(()=>projectFinanceRoleBalances([valid],{personId:''}),TypeError);
  assert.throws(()=>projectFinanceRoleBalances([valid],{personId:Promise.resolve('P1')}),TypeError);
});
