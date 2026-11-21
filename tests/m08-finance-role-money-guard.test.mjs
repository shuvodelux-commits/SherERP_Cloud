import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectFinanceRoleBalances} from '../src/modules/m08-finance-role-balances.js';

const tx=(type,amount,id='FP-01',extra={})=>({
  'Finance ID':'F-'+type,
  'Person ID':id,
  Person:'Finance Person',
  'Transaction Type':type,
  Amount:amount,
  'Is Deleted':'',
  ...extra
});

test('Owner/Lender/Borrower finance rejects coerced missing, boolean and nonliteral money before calculating',()=>{
  const bad=[null,true,false,'',' ','\t','1e3','1.2e2','Infinity','1.00 BDT',{},[]];
  for(const amount of bad){
    assert.throws(()=>projectFinanceRoleBalances([tx('Opening Loan',amount)]),TypeError,
      'must fail closed for '+JSON.stringify(amount));
  }
});

test('original Person ID is immutable and whitespace cannot merge two finance identities',()=>{
  for(const id of [' FP-01','FP-01 ','\tFP-01', '\nFP-01']){
    assert.throws(()=>projectFinanceRoleBalances([tx('Loan Received','10.00',id)]),TypeError);
  }
  assert.throws(()=>projectFinanceRoleBalances([
    tx('Loan Received','10.00','FP-01')
  ],{personId:' FP-01'}),TypeError);
});

test('finance rejects numeric paisa evidence that cannot safely survive the numeric result contract',()=>{
  for(const amount of [
    '90071992547409.91',
    '90071992547409.92',
    '999999999999999.99',
    Number.MAX_SAFE_INTEGER
  ])assert.throws(()=>projectFinanceRoleBalances([
    tx('Opening Owner Capital',amount)
  ]),TypeError,'should reject '+String(amount));
});

test('six gross buckets must detect overflow even when each person is individually displayable',()=>{
  const rows=[
    tx('Opening Loan','50000000000000.00','LENDER-A'),
    tx('Opening Loan','50000000000000.00','LENDER-B')
  ];
  assert.throws(()=>projectFinanceRoleBalances(rows),TypeError);
});

test('exact decimal input retains source per-row rounding including signed repayments',()=>{
  const rows=[
    tx('Opening Loan','0.105'),
    tx('Loan Repayment','0.105'),
    tx('Owner Investment','1.005'),
    tx('Owner Withdrawal','0.005'),
    tx('Opening Borrower Loan','0.20'),
    tx('Borrower Repayment','0.305')
  ];
  const result=projectFinanceRoleBalances(rows);
  assert.deepEqual(result.byPerson['id:FP-01'],{
    personId:'FP-01',person:'Finance Person',
    owner:1.01,loanPayable:0.01,borrowerReceivable:-0.1
  });
  assert.deepEqual(result.summary,{
    ownerCapital:1.01,ownerAdvance:0,
    outstandingLoan:0.01,lenderCredit:0,
    borrowerReceivable:0,borrowerCredit:0.1
  });
  assert.equal(Object.hasOwn(result,'cash'),false);
});

test('normal near-cents and independent same-name persons preserve exact debt without automatic netting',()=>{
  const rows=[
    tx('Opening Loan','12500.99','A',{Person:'Same display'}),
    tx('Owner Investment','300.10','A',{Person:'Same display'}),
    tx('Loan Repayment','600.01','B',{Person:'Same display'}),
    tx('Opening Borrower Loan','90.03','B',{Person:'Same display'}),
    tx('Opening Owner Capital',0,'B',{Person:'Same display'})
  ];
  const out=projectFinanceRoleBalances(rows);
  assert.deepEqual(Object.keys(out.byPerson),['id:A','id:B']);
  assert.equal(out.byPerson['id:A'].loanPayable,12500.99);
  assert.equal(out.byPerson['id:B'].loanPayable,-600.01);
  assert.deepEqual(out.summary,{
    ownerCapital:300.1,ownerAdvance:0,
    outstandingLoan:12500.99,lenderCredit:600.01,
    borrowerReceivable:90.03,borrowerCredit:0
  });
});
