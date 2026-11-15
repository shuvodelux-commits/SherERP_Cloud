import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bankCurrentBalance,totalActiveBankBalance,bankStatement
} from '../src/modules/m08-bank-read-model.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const account=(id,opening,current,status='Active',extra={})=>({
  'Bank Account ID':id,'Account Name':id+' display','Bank Name':'Demo Bank',
  'Account Number':'9999','Opening Balance':opening,'Current Balance':current,
  'Status':status,...extra
});
const entry=(id,accountId,date,credit='',debit='',extra={})=>({
  'Entry ID':id,'Bank Account ID':accountId,'Date':date,
  'Credit':credit,'Debit':debit,'Type':'Deposit','Status':'Active',
  // Bank Book's stored running balance is not authoritative for a dated statement.
  'Balance':999999,...extra
});

function sourceBalances(accounts) {
  const fn=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'BankBook.gs':['getBankBalance_','getTotalBankBalance_']
  },{getAllRows_:table=>{
    assert.equal(table,'BANK_ACCOUNTS');
    return accounts;
  }});
  return fn;
}

function sourceStatement(accounts,entries,{accountId,from,to,today='2026-11-15'}) {
  const {getBankLedger}=loadPinnedGASFunctions({
    'BankLedger.gs':['getBankLedger']
  },{
    requirePermission_:(token,module,action)=>{
      assert.deepEqual([token,module,action],['synthetic','bank','view']);
    },
    sanitizeInput_:value=>value==null?'':String(value).trim(),
    formatDate_:()=>today,
    safeDateOnly_:value=>value,
    getAllRows_:group=>{
      if(group==='BANK_ACCOUNTS')return accounts;
      if(group==='BANK_BOOK')return entries;
      throw new Error('Unexpected legacy group '+group);
    },
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:(label,error)=>{throw new Error(label+': '+error.message);}
  });
  const result=getBankLedger('synthetic',{bankAccountId:accountId,from,to});
  assert.equal(result.success,true);
  return plain(result.data);
}

test('bank account and active-bank total use stored Current Balance, not ledger totals or inactive accounts',()=>{
  const accounts=[
    account('A',100,140.125),account('B',200,-20.555),
    account('C',0,900,'Inactive'),account('D',0,2.5,'Active',{'Account Type':'Mobile Banking'})
  ];
  const original=sourceBalances(accounts);
  assert.equal(bankCurrentBalance('A',accounts),140.13);
  assert.equal(bankCurrentBalance('C',accounts),900);
  assert.equal(bankCurrentBalance('missing',accounts),0);
  assert.equal(totalActiveBankBalance(accounts),122.07);
  for(const id of ['A','B','C','missing']) {
    assert.equal(bankCurrentBalance(id,accounts),original.getBankBalance_(id));
  }
  assert.equal(totalActiveBankBalance(accounts),original.getTotalBankBalance_());
});

test('a source opening-balance row replaces account opening; reversed with mirror stays; deletion without mirror disappears',()=>{
  const a=account('A',100,140);
  const b=account('B',50,60);
  const accounts=[a,b];
  const entries=[
    entry('BB-000001','A','2026-11-01',100,'',{'Type':'Opening Balance'}),
    entry('BB-000002','A','2026-11-13',80,'',{'Type':'Transfer In'}),
    entry('BB-000003','A','2026-11-13','',20,{'Type':'Purchase Payment'}),
    entry('BB-000004','A','2026-11-13','',10,{'Status':'Reversed'}),
    entry('BB-000005','A','2026-11-14',30,'',{'Status':'Reversed'}),
    entry('BB-000006','A','2026-11-14','',30,{'Reversal Of':'BB-000005'}),
    entry('BB-000007','A','2026-11-15','',20),
    entry('BB-000008','B','2026-11-14',10)
  ];
  const options={from:'2026-11-13',to:'2026-11-15',today:'2026-11-15'};
  const actual=bankStatement(a,entries,options);
  assert.deepEqual(actual,sourceStatement(accounts,entries,{accountId:'A',...options}));
  assert.deepEqual(actual.range,{from:'2026-11-13',to:'2026-11-15'});
  assert.equal(actual.openingBalance,100);
  assert.equal(actual.closingBalance,140);
  assert.equal(actual.totalDebit,70);
  assert.equal(actual.totalCredit,110);
  assert.equal(actual.entryCount,5);
  assert.deepEqual(actual.entries.map(x=>x.entryId),[
    'BB-000007','BB-000006','BB-000005','BB-000003','BB-000002'
  ]);
  assert.equal(actual.entries.find(x=>x.entryId==='BB-000005').status,'Reversed');
  assert.equal(actual.entries.find(x=>x.entryId==='BB-000005').balance,190);
  assert.deepEqual(actual.integrity,{
    computedBalance:140,storedBalance:140,drift:0,balanced:true,hasOpeningRow:true
  });
});

test('without a Bank Book opening row, account Opening Balance is the single baseline',()=>{
  const a=account('A',200,255);
  const rows=[
    entry('BB-000002','A','2026-11-10',75),
    entry('BB-000003','A','2026-11-15','',20)
  ];
  const options={from:'2026-11-15',to:'2026-11-15',today:'2026-11-15'};
  const actual=bankStatement(a,rows,options);
  assert.deepEqual(actual,sourceStatement([a],rows,{accountId:'A',...options}));
  assert.equal(actual.openingBalance,275);
  assert.equal(actual.closingBalance,255);
  assert.equal(actual.integrity.hasOpeningRow,false);
  assert.equal(actual.integrity.balanced,true);
  assert.equal(actual.entryCount,1);
  assert.equal(actual.entries[0].balance,255);
});

test('cross-account reversals never resurrect a voided bank entry',()=>{
  const a=account('A',100,105);
  const b=account('B',200,150);
  const rows=[
    entry('BB-000001','A','2026-11-14',50,'',{'Status':'Reversed'}),
    entry('BB-000002','B','2026-11-14','',50,{'Reversal Of':'BB-000001'}),
    entry('BB-000003','A','2026-11-15',5)
  ];
  const actual=bankStatement(a,rows,{from:'2026-11-01',to:'2026-11-15',today:'2026-11-15'});
  assert.deepEqual(actual,sourceStatement([a,b],rows,{accountId:'A',from:'2026-11-01',to:'2026-11-15'}));
  assert.deepEqual(actual.entries.map(x=>x.entryId),['BB-000003']);
  assert.equal(actual.closingBalance,105);
  assert.equal(actual.integrity.balanced,true);
});

test('same-day statements calculate by Entry ID then display newest first with correct running balances',()=>{
  const a=account('A',0,0);
  const rows=[
    entry('BB-000010','A','2026-11-12',50),
    entry('BB-000002','A','2026-11-12','',50)
  ];
  const options={from:'2026-11-12',to:'2026-11-12',today:'2026-11-15'};
  const actual=bankStatement(a,rows,options);
  assert.deepEqual(actual,sourceStatement([a],rows,{accountId:'A',...options}));
  assert.deepEqual(actual.entries.map(x=>[x.entryId,x.balance]),[
    ['BB-000010',0],['BB-000002',-50]
  ]);
});

test('reversed and missing range filters use explicit today; integrity still covers later excluded dates',()=>{
  const a=account('A',100,150);
  const rows=[
    entry('BB-000001','A','2026-11-14',30),
    entry('BB-000002','A','2026-11-15',10),
    entry('BB-000003','A','2026-11-16',10)
  ];
  const reversed=bankStatement(a,rows,{
    from:'2026-11-15',to:'2026-11-14',today:'2026-11-15'
  });
  assert.deepEqual(reversed,sourceStatement([a],rows,{
    accountId:'A',from:'2026-11-15',to:'2026-11-14'
  }));
  assert.deepEqual(reversed.range,{from:'2026-11-14',to:'2026-11-15'});
  assert.equal(reversed.closingBalance,140);
  assert.equal(reversed.integrity.computedBalance,150);
  assert.equal(reversed.integrity.balanced,true);
  const fallback=bankStatement(a,rows,{from:'bad',to:'',today:'2026-11-15'});
  assert.deepEqual(fallback,sourceStatement([a],rows,{accountId:'A',from:'bad',to:''}));
  assert.deepEqual(fallback.range,{from:'2026-11-01',to:'2026-11-15'});
});

test('ledger reports stored-balance discrepancy without correcting it or mutating source',()=>{
  const a=Object.freeze(account('A',100,105));
  const entries=Object.freeze([Object.freeze(entry('BB-000001','A','2026-11-15',10))]);
  const actual=bankStatement(a,entries,{
    from:'2026-11-01',to:'2026-11-15',today:'2026-11-15'
  });
  assert.equal(actual.integrity.computedBalance,110);
  assert.equal(actual.integrity.storedBalance,105);
  assert.equal(actual.integrity.drift,5);
  assert.equal(actual.integrity.balanced,false);
  assert.deepEqual(actual,sourceStatement([a],entries,{
    accountId:'A',from:'2026-11-01',to:'2026-11-15'
  }));
});

test('zero-sized bank statement preserves original empty-ledger and current balance shape',()=>{
  const a=account('A',0,0);
  const actual=bankStatement(a,[],{from:'2026-11-01',to:'2026-11-15',today:'2026-11-15'});
  assert.deepEqual(actual,sourceStatement([a],[],{accountId:'A',from:'2026-11-01',to:'2026-11-15'}));
  assert.equal(actual.entryCount,0);
  assert.deepEqual(actual.entries,[]);
  assert.equal(actual.openingBalance,0);
  assert.equal(actual.closingBalance,0);
});

test('reject malformed or pending async rows and ambiguous source dates instead of misreporting',()=>{
  const a=account('A',0,0);
  assert.throws(()=>bankCurrentBalance('A',Promise.resolve([])),TypeError);
  assert.throws(()=>totalActiveBankBalance(null),TypeError);
  assert.throws(()=>bankStatement(null,[],{
    from:'2026-11-01',to:'2026-11-15',today:'2026-11-15'
  }),TypeError);
  assert.throws(()=>bankStatement(a,Promise.resolve([]),{
    from:'2026-11-01',to:'2026-11-15',today:'2026-11-15'
  }),TypeError);
  assert.throws(()=>bankStatement(a,[entry('BB-000001','A','2026-11-15T23:00:00Z',10)],{
    from:'2026-11-01',to:'2026-11-15',today:'2026-11-15'
  }),TypeError);
  assert.throws(()=>bankStatement(a,[],{
    from:'2026-11-01',to:'2026-11-15',today:'unresolved-clock'
  }),TypeError);
});
