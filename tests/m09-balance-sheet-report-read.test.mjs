import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectFinanceRoleBalances} from '../src/modules/m08-finance-role-balances.js';

const reports=readFileSync(new URL('../legacy/source/Reports.gs',import.meta.url),'utf8');
const cashBook=readFileSync(new URL('../legacy/source/CashBook.gs',import.meta.url),'utf8');
const bankAccounts=readFileSync(new URL('../legacy/source/BankAccounts.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../legacy/source/reports.html',import.meta.url),'utf8');
function native(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Frozen source missing '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Could not extract frozen helper '+name);
  return source.slice(start,end+2);
}
const oracleCode=[
  "const BANK_LIKE_PAYMENT_METHODS = ['Bank', 'Mobile Banking'];",
  native(utils,'roundMoney_'),
  native(cashBook,'getCashBalance_'),
  native(bankAccounts,'sanitizeAccountType_'),
  native(reports,'getInventoryValueAtCost_'),
  native(reports,'getBalanceSheetReport')
].join('\n');
const clone=value=>JSON.parse(JSON.stringify(value));
const empty=()=>({
  activeCashRows:[],bankAccounts:[],stockLots:[],
  financeSummary:{outstandingLoan:0,ownerCapital:0}
});
const fixture=()=>({
  activeCashRows:[
    {'Entry ID':'C-1','Credit':100.105,'Debit':0,'Type':'Historical Opening'},
    {'Entry ID':'C-2','Credit':0.105,'Debit':0,'Type':'Sale'},
    {'Entry ID':'C-3','Credit':0,'Debit':19.995,'Type':'Payment'}
  ],
  bankAccounts:[
    {'Bank Account ID':'BA','Status':'Active','Account Type':'Bank',
      'Current Balance':320.125},
    {'Bank Account ID':'MB','Status':'Active','Account Type':'Mobile Banking',
      'Current Balance':75.15},
    {'Bank Account ID':'OLD','Status':'Inactive','Account Type':'Bank',
      'Current Balance':10000}
  ],
  stockLots:[
    {'Lot ID':'L1','Remaining Quantity':5,'Purchase Price':10.125},
    {'Lot ID':'L2','Remaining Quantity':-2,'Purchase Price':8},
    {'Lot ID':'L3','Remaining Quantity':0,'Purchase Price':9999},
    {'Lot ID':'L4','Remaining Quantity':1.5,'Purchase Price':4}
  ],
  financeSummary:{outstandingLoan:180,ownerCapital:230}
});
function oracle(snapshot,asOf='2026-11-15'){
  const ctx={
    requirePermission_:(token,section,action)=>{
      assert.equal(token,'authorized-fixture');
      assert.equal(section,'reports');
      assert.equal(action,'view');
    },
    activeRows_:table=>{
      assert.equal(table,'CASH_BOOK');
      return snapshot.activeCashRows;
    },
    getAllRows_:table=>{
      if(table==='BANK_ACCOUNTS')return snapshot.bankAccounts;
      if(table==='STOCK_LOTS')return snapshot.stockLots;
      throw new Error('Unexpected frozen GAS table '+table);
    },
    getOutstandingLoan_:()=>snapshot.financeSummary.outstandingLoan,
    getOwnerCapital_:()=>snapshot.financeSummary.ownerCapital,
    formatDate_:()=>asOf,
    CacheService:{getScriptCache:()=>({get:()=>null,put:()=>{}})},
    ok_:value=>value,
    fail_:message=>{throw new Error('Frozen Balance Sheet failed: '+message);},
    logError_:()=>{}
  };
  return clone(runInNewContext(
    oracleCode+'\ngetBalanceSheetReport("authorized-fixture")',ctx));
}
const impl=await import('../src/modules/balance-sheet-report-read.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(snapshot,asOf){
  assert.equal(typeof impl?.projectBalanceSheetReport,'function',
    'M09 Balance Sheet Report read projection not implemented');
  return impl.projectBalanceSheetReport(snapshot,
    arguments.length<2?'2026-11-15':asOf);
}
function parity(snapshot,asOf='2026-11-15'){
  const expected=oracle(snapshot,asOf);
  const actual=clone(project(snapshot,asOf));
  assert.deepEqual(actual,expected);
  assert.deepEqual(Object.keys(actual),Object.keys(expected));
  return actual;
}

test('full original Balance Sheet report matches Cash, Bank, Mobile, Inventory and distinct finance accounts',()=>{
  const r=parity(fixture());
  assert.equal(r.asOf,'2026-11-15');
  assert.equal(r.assets.cash,80.22);
  assert.equal(r.assets.bank,320.125);
  assert.equal(r.assets.mobileBanking,75.15);
  assert.equal(r.assets.inventory,40.625);
  assert.equal(r.assets.total,r.assets.cash+r.assets.bank+r.assets.mobileBanking+r.assets.inventory);
  assert.deepEqual(r.liabilities,{outstandingLoan:180,total:180});
  assert.deepEqual(r.equity,{ownerCapital:230,total:230});
  assert.notEqual(r.assets.total,r.liabilities.total+r.equity.total);
});

test('Balance Sheet cost sums negative and zero remaining quantities unlike Stock Report',()=>{
  const s=fixture();
  assert.equal(parity(s).assets.inventory,40.625);
  s.stockLots.push({'Lot ID':'NEG-OVER','Remaining Quantity':-6,
    'Purchase Price':100});
  assert.equal(parity(s).assets.inventory,-559.375);
  s.stockLots.push({'Lot ID':'UNLINKED','Product ID':'NOT-ACTIVE',
    'Remaining Quantity':2,'Purchase Price':3.5,'Is Deleted':true});
  // getInventoryValueAtCost_ reads raw STOCK_LOTS, not activeRows_ or Products.
  assert.equal(parity(s).assets.inventory,-552.375);
});

test('Bank Account Type Mobile Banking is a distinct asset; unknown/case values use Bank',()=>{
  const s=fixture();
  s.bankAccounts.push({'Bank Account ID':'B-LOWER','Status':'Active',
    'Account Type':'mobile banking','Current Balance':-11});
  s.bankAccounts.push({'Bank Account ID':'B-OTHER','Status':'Active',
    'Account Type':'Cash','Current Balance':3});
  const r=parity(s);
  assert.equal(r.assets.mobileBanking,75.15);
  assert.equal(r.assets.bank,312.125);
  assert.equal(r.assets.total,
    r.assets.cash+r.assets.bank+r.assets.mobileBanking+r.assets.inventory);
});

test('only exact Inactive status excludes a Bank Account; finance and inventory are not filtered by period',()=>{
  const s=fixture();
  s.bankAccounts.push({'Bank Account ID':'LOWER','Status':'inactive',
    'Account Type':'Mobile Banking','Current Balance':10});
  s.bankAccounts.push({'Bank Account ID':'BLANK','Status':'',
    'Account Type':'','Current Balance':5});
  let r=parity(s,'2027-02-01');
  assert.equal(r.assets.mobileBanking,85.15);
  assert.equal(r.assets.bank,325.125);
  s.activeCashRows.push({'Date':'2020-01-01','Credit':5,'Debit':0});
  r=parity(s,'2020-01-01');
  assert.equal(r.assets.cash,85.22);
  assert.equal(r.asOf,'2020-01-01');
});

test('cash is rounded only after summing all active rows, not per-book-row',()=>{
  const s=empty();
  s.activeCashRows=[
    {'Entry ID':'A','Credit':0.105,'Debit':0},
    {'Entry ID':'B','Credit':0.105,'Debit':0}
  ];
  assert.equal(parity(s).assets.cash,0.21);
  s.activeCashRows.push({'Entry ID':'C','Credit':0,'Debit':0.03});
  assert.equal(parity(s).assets.cash,0.18);
  s.activeCashRows=[{'Credit':0,'Debit':12.34}];
  assert.equal(parity(s).assets.cash,-12.34);
});

test('finance inputs come from the existing M08 separated Owner/Lender source account projection',()=>{
  const s=fixture();
  const finance=[
    {'Person ID':'FIN-1','Person':'Anil','Transaction Type':'Opening Owner Capital','Amount':100},
    {'Person ID':'FIN-1','Person':'Anil','Transaction Type':'Owner Investment','Amount':20},
    {'Person ID':'FIN-1','Person':'Anil','Transaction Type':'Owner Withdrawal','Amount':50},
    {'Person ID':'FIN-2','Person':'Bela','Transaction Type':'Opening Loan','Amount':200},
    {'Person ID':'FIN-2','Person':'Bela','Transaction Type':'Loan Repayment','Amount':20},
    {'Person ID':'FIN-3','Person':'Chen','Transaction Type':'Borrower Loan','Amount':500}
  ];
  const sourceSummary=projectFinanceRoleBalances(finance).summary;
  s.financeSummary=sourceSummary;
  const result=parity(s);
  assert.equal(result.equity.ownerCapital,70);
  assert.equal(result.liabilities.outstandingLoan,180);
  assert.equal(sourceSummary.borrowerReceivable,500);
  assert.notEqual(result.assets.total,result.liabilities.total+result.equity.total);
});

test('empty source records and negative stored asset balances retain the original unbalanced snapshot',()=>{
  assert.deepEqual(parity(empty()),{
    asOf:'2026-11-15',
    assets:{cash:0,bank:0,mobileBanking:0,inventory:0,total:0},
    liabilities:{outstandingLoan:0,total:0},
    equity:{ownerCapital:0,total:0}
  });
  const s=empty();
  s.bankAccounts=[{'Bank Account ID':'B','Current Balance':-50,
    'Status':'Active','Account Type':'Bank'}];
  s.financeSummary={ownerCapital:500,outstandingLoan:40};
  const r=parity(s);
  assert.equal(r.assets.total,-50);
  assert.equal(r.liabilities.outstandingLoan,40);
  assert.equal(r.equity.ownerCapital,500);
});

test('duplicate active Bank Account IDs fail closed instead of double-counting the same money',()=>{
  const s=fixture();
  s.bankAccounts.push({...s.bankAccounts[0]});
  // Corruption-only intentional divergence: frozen source would count twice.
  assert.throws(()=>project(s),/duplicate bank account id/i);
  s.bankAccounts.pop();
  s.bankAccounts.push({...s.bankAccounts[2]}); // inactive duplicates ignored
  parity(s);
});

test('reject malformed trust boundaries, getters, Promise inputs and nonfinite money',()=>{
  const s=fixture();
  for(const invalid of [
    undefined,null,{},[],{...s,activeCashRows:Promise.resolve([])},
    {...s,bankAccounts:[null]},
    {...s,stockLots:['not-a-row']},
    {...s,financeSummary:null},
    {...s,financeSummary:{outstandingLoan:180}},
    {...s,financeSummary:{ownerCapital:20,outstandingLoan:Infinity}},
    {...s,activeCashRows:[{'Credit':Infinity,'Debit':0}]},
    {...s,bankAccounts:[{'Bank Account ID':'B','Current Balance':'Infinity'}]},
    {...s,stockLots:[{'Remaining Quantity':{},'Purchase Price':2}]},
    {...s,activeCashRows:[Object.create({'Credit':500})]}
  ])assert.throws(()=>project(invalid),/trusted|snapshot|array|row|account|finance|finite|number|amount|invalid/i);
  const badGetter={...s,get stockLots(){throw new Error('getter executed');}};
  assert.throws(()=>project(badGetter),/accessor|trusted|snapshot/i);
  const badRow={get 'Credit'(){throw new Error('getter executed');},'Debit':0};
  assert.throws(()=>project({...s,activeCashRows:[badRow]}),/accessor|trusted|row/i);
  for(const today of [undefined,'2026-02-30','2026-11-15T05:00:00Z'])
    assert.throws(()=>project(s,today),/today|date|trusted/i);
});

test('the original DOM, formatting, and balance sheet report RPC remain untouched; result is pure',()=>{
  const s=fixture(),before=clone(s);
  parity(s);
  assert.deepEqual(s,before);
  assert.match(ui,/id="rptBalanceSheet"/);
  assert.match(ui,/id="rbInventory"/);
  assert.match(ui,/id="rbCapital"/);
  assert.match(reports,/function getBalanceSheetReport\(token\)/);
  const path=new URL('../src/modules/balance-sheet-report-read.js',import.meta.url);
  const source=readFileSync(path,'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(source,/function\s+getBalanceSheetReport\s*\(/);
});
