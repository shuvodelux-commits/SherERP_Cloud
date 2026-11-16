import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCashReconciliationExplanation} from '../src/modules/m08-reconciliation-explanation-validation.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const timeZone='Asia/Dhaka';
const plain=value=>JSON.parse(JSON.stringify(value));
const session=(id,fields={})=>({
  'Session ID':id,
  'Status':'Closed',
  'Opened At':'2026-11-16T09:00:00+06:00',
  'Opening Cash':100,
  'Expected Cash':100,
  'Counted Cash':130,
  'Variance':'',
  'Opening Explanation Entry IDs':'',
  'Closing Explanation Entry IDs':'',
  ...fields
});
const entry=(id,credit='',debit='',fields={})=>({
  'Entry ID':id,'Date':'2026-11-16T10:00:00+06:00',
  'Type':'Sale','Credit':credit,'Debit':debit,'Is Deleted':'',
  ...fields
});

let sourceSessions=[];
let sourceCash=[];
let sourceWrites=[];
const original=loadPinnedGASFunctions({
  'Utils.gs':['roundMoney_','formatDate_','safeDateOnly_'],
  'CashReconciliation.gs':[
    'cashReconciliationSigned_','cashReconciliationIsDeleted_',
    'cashReconciliationIsSynthetic_','cashReconciliationParseIds_',
    'cashReconciliationExplanationField_','cashReconciliationRequiredDirection_',
    'cashReconciliationRowById_','cashReconciliationEvaluate_',
    'cashReconciliationSortKey_','cashReconciliationBuildRows_',
    'cashReconciliationLinkedUsage_','cashReconciliationFindSessionRow_',
    'cashReconciliationFindBuiltRow_','cashReconciliationPhaseMeta_',
    'saveCashReconciliationExplanation'
  ]
},{
  LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
  CONFIG:{LOCK_TIMEOUT_MS:1000},
  requirePermission_:(token,domain,action)=>{
    assert.equal(token,'test-only');
    assert.equal(domain,'cashReconciliation');
    assert.equal(action,'edit');
  },
  getAllRows_:name=>{
    if(name==='CASH_SESSIONS')return sourceSessions;
    if(name==='CASH_BOOK')return sourceCash;
    throw new Error('Unexpected source table');
  },
  cashReconciliationRetireLegacyAdjustment_:()=>{sourceWrites.push('legacy-retire');},
  cashReconciliationRecalculateClosedSession_:()=>null,
  updateRowFields_:(table,index,fields)=>{
    sourceWrites.push({table,index,fields:plain(fields)});
  },
  ok_:data=>({success:true,data}),
  fail_:message=>({success:false,error:message}),
  logError_:()=>{},
  Session:{getScriptTimeZone:()=>timeZone},
  Utilities:{formatDate:(value,zone,pattern)=>{
    assert.equal(pattern,'yyyy-MM-dd');
    const parts=new Intl.DateTimeFormat('en-GB',{
      timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(value);
    const part=type=>parts.find(item=>item.type===type).value;
    return [part('year'),part('month'),part('day')].join('-');
  }}
});

function parity(sessions,cashRows,opts={}) {
  const args={sessionId:'target',phase:'closing',entryIds:['real'],timeZone,...opts};
  sourceSessions=plain(sessions);
  sourceCash=plain(cashRows);
  sourceWrites=[];
  const expected=plain(original.saveCashReconciliationExplanation(
    'test-only',args.sessionId,args.phase,args.entryIds
  ));
  const beforeSessions=plain(sessions);
  const beforeCash=plain(cashRows);
  if(expected.success) {
    const result=validateCashReconciliationExplanation(sessions,cashRows,args);
    assert.deepEqual(result,expected.data);
    assert.equal(result.state,'Explained');
    assert.ok(sourceWrites.length>=2,'source would write; new validator must not');
  } else {
    assert.throws(
      ()=>validateCashReconciliationExplanation(sessions,cashRows,args),
      {message:expected.error}
    );
    assert.deepEqual(sourceWrites,[],'original failure must occur before writes');
  }
  assert.deepEqual(sessions,beforeSessions,'validator must not edit session rows');
  assert.deepEqual(cashRows,beforeCash,'validator must not edit Cash Book rows');
  return expected;
}

test('source-parity accepted single cash-in explanation; nothing is persisted',()=>{
  const source=parity([session('target')],[entry('real',30)]);
  assert.deepEqual(source.data.entryIds,['real']);
  assert.equal(source.data.requiredDirection,'Cash In');
  assert.equal(source.data.requiredAmount,30);
});

test('multiple matching entries and duplicate/CSV/JSON input IDs are normalized',()=>{
  const sessions=[session('target')];
  const rows=[entry('one',10),entry('two',20)];
  for(const entryIds of [
    ['one','one','two'],
    'one, one\ntwo',
    '["one","one","two"]'
  ]) {
    const expected=parity(sessions,rows,{entryIds});
    assert.deepEqual(expected.data.entryIds,['one','two']);
  }
});

test('cash-out opening discrepancy succeeds after an earlier Closed session',()=>{
  const sessions=[
    session('prior',{'Opened At':'2026-11-14T09:00:00+06:00','Counted Cash':130}),
    session('target',{'Opened At':'2026-11-15T09:00:00+06:00','Opening Cash':90})
  ];
  const expected=parity(sessions,[
    entry('expense-a','',20,{Type:'Expense'}),
    entry('expense-b','',20,{Type:'Expense'})
  ],{phase:'OPENING',entryIds:'expense-a,expense-b'});
  assert.equal(expected.data.requiredDirection,'Cash Out');
  assert.equal(expected.data.requiredAmount,40);
});

test('same-phase retry is allowed; cross-session and cross-phase reuse is rejected',()=>{
  const same=[session('target',{'Closing Explanation Entry IDs':'real'})];
  parity(same,[entry('real',30)]);
  const otherSession=[
    session('prior',{'Opened At':'2026-11-14T09:00:00+06:00',
      'Closing Explanation Entry IDs':'real'}),
    session('target',{'Opened At':'2026-11-16T09:00:00+06:00'})
  ];
  const crossSession=parity(otherSession,[entry('real',30)]);
  assert.match(crossSession.error,/already linked to another reconciliation/);
  const crossPhase=[session('target',{'Opening Explanation Entry IDs':'real'})];
  const phase=parity(crossPhase,[entry('real',30)]);
  assert.match(phase.error,/already linked to another reconciliation/);
});

test('missing or soft-deleted Cash Book transaction fails before any cash changes',()=>{
  for(const entries of [
    [],
    [entry('real',30,'',{'Is Deleted':true})],
    [entry('real',30,'',{'Is Deleted':'TRUE'})]
  ]) {
    const expected=parity([session('target')],entries);
    assert.match(expected.error,/missing or deleted/);
  }
});

test('synthetic balancing adjustments are not acceptable explanations',()=>{
  for(const type of ['Session Open','Day Close Adjustment']) {
    const expected=parity([session('target')],[entry('real',30,'',{Type:type})]);
    assert.match(expected.error,/real ERP transaction/);
  }
});

test('zero and wrong-direction transactions are rejected in selection order',()=>{
  for(const rows of [
    [entry('real',0,0)],
    [entry('real','',30)],
    [entry('real',30),entry('reverse','',5)]
  ]) {
    const selected=rows.length===2?['real','reverse']:['real'];
    const expected=parity([session('target')],rows,{entryIds:selected});
    assert.match(expected.error,/required Cash In direction/);
  }
});

test('underpayment, overpayment and one-cent variance reject exactly',()=>{
  const rows=[entry('small',19.99),entry('exact',30),entry('large',30.01)];
  for(const id of ['small','large']) {
    const expected=parity([session('target')],rows,{entryIds:id});
    assert.match(expected.error,/total exactly Cash In 30/);
  }
  const accepted=parity([session('target',{'Expected Cash':100,'Counted Cash':100.3})],[
    entry('a',0.1),entry('b',0.2)
  ],{entryIds:'a,b'});
  assert.equal(accepted.data.requiredAmount,0.3);
});

test('invalid phase, empty selection, missing session, zero close and first-opening baseline fail source order',()=>{
  const sessions=[session('target')];
  const cash=[entry('real',30)];
  const invalid=parity(sessions,cash,{phase:'wrong',entryIds:[]});
  assert.match(invalid.error,/Choose opening or closing/);
  const missingSelection=parity(sessions,cash,{entryIds:'  '});
  assert.match(missingSelection.error,/Select the real ERP transaction/);
  const missingSession=parity(sessions,cash,{sessionId:'unknown'});
  assert.match(missingSession.error,/Cash session not found/);
  const zeroClose=parity([session('target',{'Counted Cash':100})],cash);
  assert.match(zeroClose.error,/no difference to explain/);
  const baseline=parity(sessions,cash,{phase:'opening'});
  assert.match(baseline.error,/no difference to explain/);
});

test('more than 250 Cash Book entries: full ledger validation not just visible candidates',()=>{
  const all=Array.from({length:260},(_,i)=>entry('other-'+i,1,'',{_rowIndex:i+2}));
  all.push(entry('real',30,'',{_rowIndex:1,Date:'2025-01-01'}));
  const result=parity([session('target')],all);
  assert.equal(result.data.entryIds[0],'real');
});

test('frozen input is safe; Promise, invalid row, ambiguous IDs and missing timezone fail closed',()=>{
  const sessions=Object.freeze([Object.freeze(session('target'))]);
  const cashRows=Object.freeze([Object.freeze(entry('real',30))]);
  assert.equal(parity(sessions,cashRows).success,true);
  const args={sessionId:'target',phase:'closing',entryIds:'real',timeZone};
  assert.throws(()=>validateCashReconciliationExplanation(Promise.resolve(sessions),cashRows,args),TypeError);
  assert.throws(()=>validateCashReconciliationExplanation(sessions,Promise.resolve(cashRows),args),TypeError);
  assert.throws(()=>validateCashReconciliationExplanation([null],cashRows,args),TypeError);
  assert.throws(()=>validateCashReconciliationExplanation(sessions,[null],args),TypeError);
  assert.throws(()=>validateCashReconciliationExplanation(sessions,cashRows,{...args,timeZone:undefined}),TypeError);
  assert.throws(()=>validateCashReconciliationExplanation([
    session('target'),session('target')
  ],cashRows,args),/Duplicate Cash Session ID/);
  assert.throws(()=>validateCashReconciliationExplanation(sessions,[
    entry('real',30),entry('real',30)
  ],args),/Duplicate Cash Book Entry ID/);
});

test('prototype-shaped Cash Book entry IDs do not inherit object prototype usage',()=>{
  const result=validateCashReconciliationExplanation(
    [session('target',{'Closing Explanation Entry IDs':'constructor'})],
    [entry('constructor',30)],
    {sessionId:'target',phase:'closing',entryIds:'constructor',timeZone}
  );
  assert.deepEqual(result.entryIds,['constructor']);
  assert.equal(result.state,'Explained');
});
