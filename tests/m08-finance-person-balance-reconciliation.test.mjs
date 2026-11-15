import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileFinancePersonBalances} from '../src/modules/m08-finance-person-balance-reconciliation.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const clone=x=>JSON.parse(JSON.stringify(x));
const master=(id,name,more={})=>({
  'Person ID':id,'Person Name':name,'Person Type':'Owner',
  Roles:'Owner',Status:'Active',...more
});
const txn=(id,personId,type,amount,more={})=>({
  'Finance ID':id,'Person ID':personId,'Person':'Historic display name',
  'Transaction Type':type,Amount:amount,'Is Deleted':'',...more
});
const SOURCE_TYPES=[
  ['Owner Investment','owner',1],['Owner Withdrawal','owner',-1],
  ['Loan Received','loanPayable',1],['Loan Repayment','loanPayable',-1],
  ['Borrower Loan','borrowerReceivable',1],['Borrower Repayment','borrowerReceivable',-1],
  ['Opening Owner Capital','owner',1],['Opening Loan','loanPayable',1],
  ['Opening Borrower Loan','borrowerReceivable',1]
].map(([key,account,balanceEffect])=>({key,account,balanceEffect}));

/** Original pinned GAS is executed only under test VM with synthetic data. */
function original(masterRows,financeRows){
  const fx=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'FinanceModule.gs':[
      'financeCanonicalRoles_','financePersonRoles_','getAllFinancePersonsForUI_',
      'financePersonNameAliasMap_','financeTransactionType_','financeTxnPersonKey_',
      'financeSignedBalances_','financeBalanceSummary_','financePersonBalancesForUI_'
    ]
  },{
    FINANCE_PERSON_ROLES:['Owner','Lender','Borrower'],
    FINANCE_TRANSACTION_TYPES:SOURCE_TYPES,
    getAllRows_:table=>{
      assert.equal(table,'FINANCE_PERSONS');
      return clone(masterRows);
    }
  });
  const persons=fx.getAllFinancePersonsForUI_();
  return clone({
    persons,
    personBalances:fx.financePersonBalancesForUI_(persons,clone(financeRows)),
    summary:fx.financeBalanceSummary_(clone(financeRows))
  });
}
function parity(masters,financeRows){
  const actual=reconcileFinancePersonBalances(masters,financeRows);
  assert.deepEqual(actual,original(masters,financeRows));
  return actual;
}
const zero=()=>({owner:0,loanPayable:0,borrowerReceivable:0});

test('empty master and empty finance transactions preserve exact source bootstrap balance shape',()=>{
  assert.deepEqual(parity([],[]),{
    persons:[],personBalances:{},
    summary:{
      ownerCapital:0,ownerAdvance:0,outstandingLoan:0,
      lenderCredit:0,borrowerReceivable:0,borrowerCredit:0
    }
  });
});

test('one original person with all three roles keeps three independent signed accounts',()=>{
  const masters=[master('FP-01','Nayem',{
    'Person Type':'Lender',Roles:'Borrower,Owner,Lender'
  })];
  const rows=[
    txn('F1','FP-01','Owner Investment',600),
    txn('F2','FP-01','Owner Withdrawal',50),
    txn('F3','FP-01','Loan Received',1000),
    txn('F4','FP-01','Loan Repayment',150),
    txn('F5','FP-01','Borrower Loan',400),
    txn('F6','FP-01','Borrower Repayment',25)
  ];
  const out=parity(masters,rows);
  assert.deepEqual(out.personBalances['FP-01'],
    {owner:550,loanPayable:850,borrowerReceivable:375});
  assert.deepEqual(out.persons[0].roles,['Owner','Lender','Borrower']);
  assert.equal(out.summary.ownerCapital,550);
  assert.equal(out.summary.outstandingLoan,850);
  assert.equal(out.summary.borrowerReceivable,375);
});

test('two verified IDs with same names and phones remain two people with independent amounts',()=>{
  const masters=[
    master('P1','Same Name',{Phone:'01700000000'}),
    master('P2','Same Name',{Phone:'01700000000'})
  ];
  const out=parity(masters,[
    txn('F1','P1','Owner Investment',450,{Person:'Same Name'}),
    txn('F2','P2','Owner Withdrawal',20,{Person:'Same Name'}),
    txn('F3','P2','Loan Received',180,{Person:'Same Name'})
  ]);
  assert.deepEqual(Object.keys(out.personBalances),['P1','P2']);
  assert.deepEqual(out.personBalances.P1,{owner:450,loanPayable:0,borrowerReceivable:0});
  assert.deepEqual(out.personBalances.P2,{owner:-20,loanPayable:180,borrowerReceivable:0});
  assert.equal(out.summary.ownerCapital,450);
  assert.equal(out.summary.ownerAdvance,20);
});

test('inactive Finance Person remains with historical balances and never affects current role permission',()=>{
  const out=parity([
    master('P1','Inactive owner',{Status:'Inactive'}),
    master('P2','Active lender',{Status:'Active',Roles:'Lender'})
  ],[
    txn('T1','P1','Opening Owner Capital',200),
    txn('T2','P1','Owner Withdrawal',50),
    txn('T3','P2','Opening Loan',90)
  ]);
  assert.equal(out.persons[0].status,'Inactive');
  assert.deepEqual(out.personBalances.P1,{owner:150,loanPayable:0,borrowerReceivable:0});
  assert.equal(out.summary.ownerCapital,150);
  assert.equal(out.summary.outstandingLoan,90);
});

test('zero-activity masters appear in source order with three zero account positions',()=>{
  const masters=[
    master('Z','First',{Roles:'Lender'}),
    master('A','Second',{Roles:'Borrower'}),
    master('Q','Third',{Roles:'Owner,Borrower'})
  ];
  const out=parity(masters,[]);
  assert.deepEqual(out.persons.map(p=>p.id),['Z','A','Q']);
  assert.deepEqual(Object.keys(out.personBalances),['Z','A','Q']);
  assert.deepEqual(out.personBalances,{Z:zero(),A:zero(),Q:zero()});
});

test('gross buckets keep signed overpayments separate across persons and account relationships',()=>{
  const masters=[master('P1','One'),master('P2','Two'),master('P3','Three')];
  const out=parity(masters,[
    txn('1','P1','Owner Withdrawal',75),
    txn('2','P2','Owner Investment',125),
    txn('3','P1','Loan Repayment',55),
    txn('4','P2','Loan Received',250),
    txn('5','P1','Borrower Repayment',20),
    txn('6','P3','Borrower Loan',300)
  ]);
  assert.deepEqual(out.summary,{
    ownerCapital:125,ownerAdvance:75,
    outstandingLoan:250,lenderCredit:55,
    borrowerReceivable:300,borrowerCredit:20
  });
  assert.equal(out.personBalances.P1.owner,-75);
  assert.equal(out.personBalances.P2.owner,125);
});

test('all three source opening types seed historical balances but do not imply cash posting',()=>{
  const out=parity([master('P','Historic',{Roles:'Owner,Lender,Borrower'})],[
    txn('A','P','Opening Owner Capital',300),
    txn('B','P','Opening Loan',400),
    txn('C','P','Opening Borrower Loan',500)
  ]);
  assert.deepEqual(out.personBalances.P,{owner:300,loanPayable:400,borrowerReceivable:500});
  assert.deepEqual(out.summary,{
    ownerCapital:300,ownerAdvance:0,
    outstandingLoan:400,lenderCredit:0,
    borrowerReceivable:500,borrowerCredit:0
  });
  assert.equal(Object.hasOwn(out,'cashBalance'),false);
});

test('historic transactions are preserved despite current person Role changes and renamed Person display',()=>{
  const masters=[master('P1','Renamed',{
    'Person Type':'Owner',Roles:'Owner',
    Description:'Former lender'
  })];
  const out=parity(masters,[
    txn('A','P1','Loan Received',200,{Person:'Old name'}),
    txn('B','P1','Borrower Loan',90,{Person:'Old name'})
  ]);
  assert.deepEqual(out.persons[0].roles,['Owner']);
  assert.deepEqual(out.personBalances.P1,{owner:0,loanPayable:200,borrowerReceivable:90});
  assert.equal(out.summary.outstandingLoan,200);
  assert.equal(out.summary.borrowerReceivable,90);
});

test('per-transaction source rounding is retained instead of rounding only final float totals',()=>{
  const masters=[master('P1','Rounding')];
  const rows=[
    txn('F1','P1','Owner Investment',0.1),
    txn('F2','P1','Owner Investment',0.2),
    txn('F3','P1','Owner Withdrawal',0.03),
    txn('F4','P1','Loan Received',1.005),
    txn('F5','P1','Loan Repayment',0.01)
  ];
  const out=parity(masters,rows);
  assert.equal(out.personBalances.P1.owner,0.27);
});

test('source masters and active finance arrays remain unchanged and projection is repeatable',()=>{
  const a=Object.freeze(master('P1','Fixed',{'Roles':'Owner,Lender'}));
  const row=Object.freeze(txn('F1','P1','Loan Received',222));
  const masters=Object.freeze([a]);
  const txns=Object.freeze([row]);
  const once=parity(masters,txns), twice=parity(masters,txns);
  assert.deepEqual(once,twice);
  assert.equal(Object.hasOwn(a,'balances'),false);
  assert.equal(Object.hasOwn(row,'account'),false);
});

test('unmatched source Finance Person ID fails closed even with an exact display name',()=>{
  const masters=[master('FP-1','Shared Name')];
  for(const id of ['MISSING','',' ',' FP-1','FP-1 ']){
    const rows=[txn('T',''+id,'Owner Investment',100,{Person:'Shared Name'})];
    assert.throws(()=>reconcileFinancePersonBalances(masters,rows),TypeError);
  }
  assert.throws(()=>reconcileFinancePersonBalances([],[
    txn('T','FP-1','Owner Investment',100)
  ]),TypeError);
});

test('missing, duplicate or whitespace-altered master IDs are never accepted as finance identities',()=>{
  const valid=master('FP-1','Valid');
  for(const rows of [
    [master('','Invalid')],
    [master(' ','Invalid')],
    [master(' FP-1','Invalid')],
    [master('FP-1 ','Invalid')],
    [master(8,'Numeric')],
    [master('X','')],
    [valid,master('FP-1','Duplicate')]
  ])assert.throws(()=>reconcileFinancePersonBalances(rows,[]),TypeError);
});

test('unloaded, deleted, malformed or unapproved original finance rows never produce a partial reconciliation',()=>{
  const masters=[master('FP-1','Valid')];
  const good=txn('OK','FP-1','Owner Investment',100);
  for(const [m,rows] of [
    [null,[]],[Promise.resolve(masters),[]],[{},[]],
    [masters,null],[masters,Promise.resolve([good])],
    [masters,[good,txn('DEL','FP-1','Loan Received',80,{'Is Deleted':true})]],
    [masters,[good,txn('BAD','FP-1','Unknown Type',50)]],
    [masters,[good,txn('BAD','FP-1','Loan Received',-1)]],
    [masters,[good,txn('BAD','FP-1','Loan Received',Infinity)]]
  ])assert.throws(()=>reconcileFinancePersonBalances(m,rows),TypeError);
});
