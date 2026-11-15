import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const readCases = () => loadPinnedGASFunctions({
  'Utils.gs':['roundMoney_'],
  'CashBook.gs':['getCashBalance_'],
  'CashSession.gs':['getCashMismatch_','cashSessionExplanationIds_',
    'cashSessionLinkedReconciliationEntryIds_','cashSessionSummaryFromRows_']
});

const cash = (id,type,credit='',debit='',reference='',date='2026-11-15') => ({
  'Entry ID':id, 'Type':type, 'Credit':credit, 'Debit':debit,
  'Reference':reference,'Date':date
});

test('session starts at its marker, counts later backdated transactions, excludes historical baseline and linked explanations',()=>{
  const {cashSessionSummaryFromRows_}=readCases();
  const previous={'Session ID':'s1','Status':'Closed','Counted Cash':195};
  const current={'Session ID':'s2','Status':'Open','Opening Cash':200,
    'Opened At':'2026-11-15T09:00:00+06:00',
    'Opening Explanation Entry IDs':'["linked"]','Notes':'physical count'};
  const rows=[
    cash('old','Sale',20), cash('start','Session Open','','','s2'),
    cash('sale','Sale',125.5,'','','2026-11-13'),
    cash('history','Historical Opening',75),
    cash('refund','Refund','',40),
    cash('linked','Expense','',5)
  ];
  const actual=cashSessionSummaryFromRows_(current,[previous,current],rows);
  assert.equal(actual.cashIn,125.5);
  assert.equal(actual.cashOut,40);
  assert.equal(actual.expectedCash,285.5);
  assert.equal(actual.openingCash,200);
  assert.equal(actual.sessionId,'s2');
  assert.equal(actual.cashMismatch.direction,'more');
  assert.equal(actual.cashMismatch.amount,5);
});

test('closed/closing session reports stored expected and counted, ignoring its own synthetic adjustment',()=>{
  const {cashSessionSummaryFromRows_}=readCases();
  const session={'Session ID':'close-7','Status':'Closing','Opening Cash':50,
    'Expected Cash':61,'Counted Cash':62.5,'Opened At':'2026-11-15T09:00:00Z'};
  const rows=[
    cash('marker','Session Open','','','close-7'),
    cash('sale','Sale',15.25),
    cash('close-row','Day Close Adjustment',999,'','close-7')
  ];
  const result=cashSessionSummaryFromRows_(session,[session],rows);
  assert.equal(result.cashIn,15.25);
  assert.equal(result.cashOut,0);
  assert.equal(result.expectedCash,61);
  assert.equal(result.countedCash,62.5);
});

test('absent session marker does not import historic cash activity into the new drawer session',()=>{
  const {cashSessionSummaryFromRows_}=readCases();
  const session={'Session ID':'missing','Status':'Open','Opening Cash':90};
  const result=cashSessionSummaryFromRows_(session,[session],[cash('old','Sale',300)]);
  assert.equal(result.cashIn,0);
  assert.equal(result.cashOut,0);
  assert.equal(result.expectedCash,90);
});

test('public summary reads active Cash Book rows and requires POS view permission',()=>{
  const called=[],allRows=[cash('marker','Session Open','','','s3'),
    cash('live','Sale',30),cash('deleted','Sale',700)];
  const session={'Session ID':'s3','Status':'Open','Opening Cash':10};
  const fn=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],'CashBook.gs':['getCashBalance_'],
    'CashSession.gs':['getCashMismatch_','cashSessionExplanationIds_',
      'cashSessionLinkedReconciliationEntryIds_','cashSessionSummaryFromRows_',
      'getCashSessionSummary']
  },{
    requirePermission_:(token,mod,action)=>{called.push([token,mod,action]);},
    getAllRows_:group=>{
      assert.equal(group,'CASH_SESSIONS');
      return [session];
    },
    getActiveCashSession_:()=>({success:true,data:session}),
    activeRows_:group=>{
      assert.equal(group,'CASH_BOOK');
      return allRows.filter(r=>r['Entry ID']!=='deleted');
    },
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:()=>{throw new Error('Unexpected source error');}
  }).getCashSessionSummary;
  const result=fn('synthetic-token');
  assert.equal(result.success,true);
  assert.equal(result.data.cashIn,30);
  assert.equal(result.data.expectedCash,40);
  assert.deepEqual(called,[['synthetic-token','pos','view']]);
});

function bankTransferEnvironment({requireSession=true,authorize=true,accounts}={}) {
  const events={permission:[],sessions:0,headers:[],legs:[],release:0};
  const bankAccounts=accounts??[
    {'Bank Account ID':'bank-a','Account Name':'Account A','Status':'Active','Current Balance':500},
    {'Bank Account ID':'bank-b','Account Name':'Account B','Status':'Active','Current Balance':90}
  ];
  const {transferBetweenBankAccounts}=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'BankBook.gs':['transferBetweenBankAccounts']
  },{
    LockService:{getScriptLock:()=>({
      waitLock:()=>{}, releaseLock:()=>{events.release++;}
    })},
    CONFIG:{LOCK_TIMEOUT_MS:5},
    requirePermission_:(token,module,action)=>{
      events.permission.push([module,action]);
      if(!authorize)throw new Error('Permission denied');
      return {'Full Name':'Test Operator'};
    },
    requireActiveCashSession_:()=>{
      events.sessions++;
      if(!requireSession)throw new Error('No open session');
    },
    isValidNonNegativeNumber_:value=>typeof value==='number' && Number.isFinite(value) && value>=0,
    getAllRows_:group=>{
      assert.equal(group,'BANK_ACCOUNTS');
      return bankAccounts;
    },
    generateId_:group=>{assert.equal(group,'BANK_TRANSFERS');return 'transfer-1';},
    appendRow_:(group,row)=>{events.headers.push({group,row});},
    addBankBookEntry_:(id,fields,account)=>{events.legs.push({id,fields,account});},
    sanitizeInput_:s=>String(s??''),
    actorName_:u=>u['Full Name'],
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:()=>{}
  });
  return {transferBetweenBankAccounts,events};
}

test('original bank transfer emits one header, two opposing legs and no Cash Book mutation',()=>{
  const {transferBetweenBankAccounts,events}=bankTransferEnvironment();
  const outcome=transferBetweenBankAccounts('token',{fromAccountId:'bank-a',
    toAccountId:'bank-b',amount:125.25,notes:'business transfer'});
  assert.equal(outcome.success,true);
  assert.equal(outcome.data.id,'transfer-1');
  assert.deepEqual(events.permission,[['bank','add']]);
  assert.equal(events.sessions,1);
  assert.equal(events.headers.length,1);
  assert.equal(events.headers[0].group,'BANK_TRANSFERS');
  assert.equal(events.headers[0].row['Amount'],125.25);
  assert.equal(events.headers[0].row['Created By'],'Test Operator');
  assert.equal(events.legs.length,2);
  assert.deepEqual(events.legs.map(x=>[x.id,x.fields.Type,x.fields.Reference,
    x.fields.Debit,x.fields.Credit]),[
    ['bank-a','Transfer Out','transfer-1',125.25,''],
    ['bank-b','Transfer In','transfer-1','',125.25]
  ]);
  assert.equal(events.release,1);
});

test('bank transfer refuses invalid accounts and amounts before any header or leg',()=>{
  const scenarios=[
    {fromAccountId:'bank-a',toAccountId:'bank-a',amount:10},
    {fromAccountId:'missing',toAccountId:'bank-b',amount:10},
    {fromAccountId:'bank-a',toAccountId:'bank-b',amount:0},
    {fromAccountId:'bank-a',toAccountId:'bank-b',amount:-4}
  ];
  for(const payload of scenarios) {
    const {transferBetweenBankAccounts,events}=bankTransferEnvironment();
    const result=transferBetweenBankAccounts('token',payload);
    assert.equal(result.success,false);
    assert.equal(events.headers.length,0);
    assert.equal(events.legs.length,0);
    assert.equal(events.release,1);
  }
  const {transferBetweenBankAccounts,events}=bankTransferEnvironment({
    accounts:[{'Bank Account ID':'bank-a','Account Name':'A','Status':'Inactive'},
      {'Bank Account ID':'bank-b','Account Name':'B','Status':'Active'}]
  });
  assert.equal(transferBetweenBankAccounts('token',
    {fromAccountId:'bank-a',toAccountId:'bank-b',amount:10}).success,false);
  assert.equal(events.legs.length,0);
});

test('permission or open-session refusal prevents transfer mutations',()=>{
  for(const options of [{authorize:false},{requireSession:false}]) {
    const {transferBetweenBankAccounts,events}=bankTransferEnvironment(options);
    assert.equal(transferBetweenBankAccounts('token',
      {fromAccountId:'bank-a',toAccountId:'bank-b',amount:25}).success,false);
    assert.equal(events.headers.length,0);
    assert.equal(events.legs.length,0);
    assert.equal(events.release,1);
  }
});
