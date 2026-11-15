import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFinanceLedgerRows} from '../src/modules/m08-finance-ledger-rows.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const TYPES=[
  ['Owner Investment','Owner Credit','owner',1,'in','Owner',false],
  ['Owner Withdrawal','Owner Debit','owner',-1,'out','Owner',false],
  ['Loan Received','Lender Credit','loanPayable',1,'in','Lender',false],
  ['Loan Repayment','Lender Debit','loanPayable',-1,'out','Lender',false],
  ['Borrower Loan','Borrower Debit','borrowerReceivable',1,'out','Borrower',false],
  ['Borrower Repayment','Borrower Credit','borrowerReceivable',-1,'in','Borrower',false],
  ['Opening Owner Capital','Opening Owner Capital','owner',1,'none','Owner',true],
  ['Opening Loan','Opening Loan','loanPayable',1,'none','Lender',true],
  ['Opening Borrower Loan','Opening Borrower Loan','borrowerReceivable',1,'none','Borrower',true]
].map(([key,label,account,balanceEffect,cashDirection,role,isOpening])=>
  ({key,label,account,balanceEffect,cashDirection,role,isOpening}));
const clone=value=>JSON.parse(JSON.stringify(value));
const tx=(id,date,type,amount,personId='P1',other={})=>({
  'Finance ID':id,'Date':date,'Transaction Type':type,
  'Person ID':personId,'Person':other.Person??'Alex Trade',
  'Amount':amount,'Is Deleted':'',
  ...other
});
function source(rows,filters={}) {
  const funcs=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'FinanceModule.gs':[
      'financeTransactionType_','financeTxnPersonKey_','financeSignedBalances_',
      'financeBalanceSummary_','financePersonNameAliasMap_','financeAccountLabel_',
      'getFinanceLedger'
    ]
  },{
    FINANCE_TRANSACTION_TYPES:TYPES,
    requirePermission_:(token,module,action)=>assert.deepEqual([token,module,action],['synthetic','finance','view']),
    sanitizeInput_:value=>value===null||value===undefined?'':String(value).trim(),
    safeDateOnly_:value=>String(value??'').slice(0,10),
    activeRows_:sheet=>{assert.equal(sheet,'FINANCE_TRANSACTIONS');return clone(rows);},
    getAllFinancePersonsForUI_:()=>[],
    getSettingsMap_:()=>({'Currency Symbol':'৳'}),
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:(label,error)=>{throw new Error(label+': '+error.message);}
  });
  const result=funcs.getFinanceLedger('synthetic',filters);
  assert.equal(result.success,true,JSON.stringify(result));
  return clone({rows:result.data.rows,summary:result.data.summary});
}
function parity(rows,filters={}) {
  const actual=projectFinanceLedgerRows(rows,filters);
  assert.deepEqual(actual,source(rows,filters));
  return actual;
}

test('all nine original source finance types shape exact account labels and cash debit/credit directions',()=>{
  const rows=TYPES.map((t,i)=>tx('FIN-'+String(i+1).padStart(3,'0'),'2026-11-10',t.key,100));
  const result=parity(rows);
  assert.equal(result.rows.length,9);
  assert.deepEqual(result.rows.filter(row=>row.transactionType.startsWith('Opening '))
    .map(row=>[row.debit,row.credit]),[[0,0],[0,0],[0,0]]);
  assert.deepEqual(result.rows.find(row=>row.transactionType==='Borrower Loan') &&
    ['Borrower Balance',100,0],['Borrower Balance',100,0]);
  const borrower=result.rows.find(row=>row.transactionType==='Borrower Loan');
  assert.equal(borrower.account,'borrowerReceivable');
  assert.equal(borrower.accountLabel,'Borrower Balance');
  assert.equal(borrower.debit,100);
  assert.equal(borrower.credit,0);
  const paid=result.rows.find(row=>row.transactionType==='Borrower Repayment');
  assert.equal(paid.debit,0);
  assert.equal(paid.credit,100);
});

test('sort by business Date then Finance ID before computing account balances, not input order',()=>{
  const rows=[
    tx('FIN-20','2026-11-15','Owner Withdrawal',20),
    tx('FIN-01','2026-11-15','Owner Investment',100),
    tx('FIN-00','2026-11-13','Opening Owner Capital',300)
  ];
  const out=parity(rows);
  assert.deepEqual(out.rows.map(row=>[row.financeId,row.balance]),[
    ['FIN-20',380],['FIN-01',400],['FIN-00',300]
  ]);
  assert.equal(out.summary.ownerCapital,380);
});

test('date filter retains all previous finance running balances and entire selected gross summary',()=>{
  const rows=[
    tx('F1','2026-11-01','Opening Loan',1000),
    tx('F2','2026-11-03','Loan Received',500),
    tx('F3','2026-11-12','Loan Repayment',300),
    tx('F4','2026-11-18','Loan Repayment',200)
  ];
  const out=parity(rows,{dateFrom:'2026-11-12',dateTo:'2026-11-12'});
  assert.deepEqual(out.rows.map(row=>[row.financeId,row.balance]),[['F3',1200]]);
  assert.equal(out.summary.outstandingLoan,1000);
});

test('same person owner/lender/borrower accounts have independent running balances',()=>{
  const rows=[
    tx('F1','2026-11-01','Owner Investment',400),
    tx('F2','2026-11-01','Loan Received',300),
    tx('F3','2026-11-02','Borrower Loan',250),
    tx('F4','2026-11-02','Owner Withdrawal',100),
    tx('F5','2026-11-03','Loan Repayment',60),
    tx('F6','2026-11-03','Borrower Repayment',40)
  ];
  const out=parity(rows);
  assert.deepEqual(out.rows.map(row=>[row.account,row.balance]),[
    ['borrowerReceivable',210],['loanPayable',240],['owner',300],
    ['borrowerReceivable',250],['loanPayable',300],['owner',400]
  ]);
  assert.deepEqual(out.summary,{
    ownerCapital:300,ownerAdvance:0,
    outstandingLoan:240,lenderCredit:0,
    borrowerReceivable:210,borrowerCredit:0
  });
});

test('filtered by exact Person ID after running and no name-alias merge of same names',()=>{
  const rows=[
    tx('F1','2026-11-01','Owner Investment',100,'P1',{Person:'Shared'}),
    tx('F2','2026-11-01','Owner Withdrawal',200,'P2',{Person:'Shared'}),
    tx('F3','2026-11-03','Owner Withdrawal',10,'P1',{Person:'Shared'}),
    tx('F4','2026-11-05','Loan Received',70,'P2',{Person:'Shared'})
  ];
  const out=parity(rows,{personId:'P1'});
  assert.deepEqual(out.rows.map(row=>[row.financeId,row.balance]),[['F3',90],['F1',100]]);
  assert.equal(out.summary.ownerCapital,90);
  assert.equal(out.summary.ownerAdvance,0);
  assert.deepEqual(out.rows.map(row=>row.personKey),['id:P1','id:P1']);
});

test('transaction type and case-insensitive search filter after running without altering six-bucket summary',()=>{
  const rows=[
    tx('F1','2026-11-01','Owner Investment',200,'P1',{Notes:'capital'}),
    tx('F2','2026-11-02','Loan Received',75,'P1',{'Reference No':'LN-778'}),
    tx('F3','2026-11-04','Loan Repayment',25,'P1',{'Reference No':'LN-779'}),
    tx('F4','2026-11-07','Owner Withdrawal',30,'P1',{Notes:'rent'})
  ];
  const out=parity(rows,{transactionType:'Loan Repayment',query:'LN-779'});
  assert.equal(out.rows.length,1);
  assert.equal(out.rows[0].balance,50);
  assert.equal(out.summary.ownerCapital,170);
  assert.equal(out.summary.outstandingLoan,50);
  assert.deepEqual(parity(rows,{query:'LENDER BALANCE'}).rows.map(x=>x.financeId),['F3','F2']);
});

test('negative lender credit and owner advance are reported gross, never netted against other persons',()=>{
  const rows=[
    tx('F1','2026-11-01','Loan Received',100,'A'),
    tx('F2','2026-11-02','Loan Repayment',170,'A'),
    tx('F3','2026-11-02','Loan Received',240,'B'),
    tx('F4','2026-11-02','Owner Withdrawal',25,'A'),
    tx('F5','2026-11-02','Owner Investment',40,'B')
  ];
  const out=parity(rows,{query:'never-matches'});
  assert.deepEqual(out.rows,[]);
  assert.equal(out.summary.outstandingLoan,240);
  assert.equal(out.summary.lenderCredit,70);
  assert.equal(out.summary.ownerCapital,40);
  assert.equal(out.summary.ownerAdvance,25);
});

test('backdated entries sort by business Date not Created At, preserving audit metadata',()=>{
  const rows=[
    tx('F2','2026-11-10','Owner Investment',100,'P1',{'Created At':'2026-11-01T00:00:00Z'}),
    tx('F1','2026-11-03','Owner Withdrawal',20,'P1',{
      'Created At':'2026-11-20T00:00:00Z','Is Backdated':true,
      'Backdated Days':17,'Backdated Reason':'Corrected invoice'
    })
  ];
  const out=parity(rows);
  assert.deepEqual(out.rows.map(x=>x.balance),[80,-20]);
  const backdated=out.rows[1];
  assert.equal(backdated.isBackdated,true);
  assert.equal(backdated.backdatedDays,17);
  assert.equal(backdated.backdatedReason,'Corrected invoice');
});

test('empty and reversed-date ranges have source behavior and do not invent activity',()=>{
  const rows=[tx('F1','2026-11-10','Owner Investment',50)];
  const empty=parity([]);
  assert.deepEqual(empty.rows,[]);
  assert.equal(empty.summary.ownerCapital,0);
  const reversed=parity(rows,{dateFrom:'2026-11-11',dateTo:'2026-11-09'});
  assert.deepEqual(reversed.rows,[]);
  assert.equal(reversed.summary.ownerCapital,50);
});

test('pure projection preserves frozen source arrays and rejects Promise, missing IDs, inactive/deleted or malformed dates',()=>{
  const frozen=Object.freeze([Object.freeze(tx('F1','2026-11-15','Loan Received',80))]);
  assert.equal(parity(frozen).rows[0].balance,80);
  assert.equal(Object.hasOwn(frozen[0],'balance'),false);
  assert.throws(()=>projectFinanceLedgerRows(Promise.resolve([])),TypeError);
  assert.throws(()=>projectFinanceLedgerRows(null),TypeError);
  assert.throws(()=>projectFinanceLedgerRows([tx('F1','2026-11-15','Loan Received',80,'')]),TypeError);
  assert.throws(()=>projectFinanceLedgerRows([tx('F1','2026-11-15','Loan Received',80,'P1',{'Is Deleted':true})]),TypeError);
  assert.throws(()=>projectFinanceLedgerRows([tx('F1','2026-11-15T00:00:00Z','Loan Received',80)]),TypeError);
  assert.throws(()=>projectFinanceLedgerRows([tx('','2026-11-15','Loan Received',80)]),TypeError);
  assert.throws(()=>projectFinanceLedgerRows([tx('F1','2026-11-15','UNKNOWN',80)]),TypeError);
  assert.throws(()=>projectFinanceLedgerRows([tx('F1','2026-11-15','Owner Withdrawal',-10)]),TypeError);
  assert.throws(()=>projectFinanceLedgerRows([tx('F1','2026-11-15','Owner Withdrawal',10)],{dateFrom:'yesterday'}),TypeError);
});
