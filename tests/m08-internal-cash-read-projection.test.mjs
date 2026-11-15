import test from 'node:test';
import assert from 'node:assert/strict';
import {cashBalance,cashSessionSnapshot} from '../src/modules/m08-cash-read-model.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

function original(){
  return loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'CashBook.gs':['getCashBalance_'],
    'CashSession.gs':[
      'getCashMismatch_','cashSessionExplanationIds_',
      'cashSessionLinkedReconciliationEntryIds_','cashSessionSummaryFromRows_'
    ]
  });
}
const plain=x=>JSON.parse(JSON.stringify(x));
const cash=(id,type,credit='',debit='',reference='',date='2026-11-15')=>({
  'Entry ID':id,'Type':type,'Credit':credit,'Debit':debit,
  'Reference':reference,'Date':date,'Balance':9999
});
const session=(id='s2',status='Open',opening=200)=>({
  'Session ID':id,'Status':status,'Opening Cash':opening,
  'Opened At':'2026-11-15T09:00:00+06:00','Notes':'counted drawer'
});

test('book balance uses active credits minus debits, including historical opening, not stale Balance',()=>{
  const rows=[cash('sale','Sale',100.25),cash('expense','Expense','',35.10),
    cash('opening','Historical Opening',75)];
  assert.equal(cashBalance(rows),140.15);
  assert.equal(cashBalance(rows),original().getCashBalance_(rows));
  assert.equal(cashBalance([]),0);
});

test('session starts after marker, counts backdated posting and excludes historical and explained rows',()=>{
  const current={...session(),'Opening Explanation Entry IDs':'["explained"]'};
  const prior={...session('s1','Closed',195),'Counted Cash':195};
  const rows=[cash('before','Sale',20),
    cash('boundary','Session Open','','','s2'),
    cash('backdated','Sale',125.5,'','','2026-11-12'),
    cash('history','Historical Opening',75),
    cash('refund','Refund','',40),
    cash('explained','Expense','',5)];
  const actual=cashSessionSnapshot(current,[prior,current],rows);
  assert.equal(actual.cashIn,125.5);
  assert.equal(actual.cashOut,40);
  assert.equal(actual.expectedCash,285.5);
  assert.deepEqual(actual.cashMismatch,{direction:'more',amount:5});
  assert.deepEqual(actual,plain(original().cashSessionSummaryFromRows_(current,[prior,current],rows)));
});

test('closing reuses expected cash, counts physical cash, skips same-session close adjustment and linked CSV explanation',()=>{
  const current={...session('close-1','Closing',50),
    'Expected Cash':61,'Counted Cash':62.5,
    'Closing Explanation Entry IDs':'repair,extra\n'};
  const rows=[cash('marker','Session Open','','','close-1'),
    cash('sale','Sale',15.25),
    cash('repair','Cash Reconciliation','',6),
    cash('extra','Cash Reconciliation',300),
    cash('adjust','Day Close Adjustment',999,'','close-1')];
  const actual=cashSessionSnapshot(current,[current],rows);
  assert.equal(actual.cashIn,15.25);
  assert.equal(actual.cashOut,0);
  assert.equal(actual.expectedCash,61);
  assert.equal(actual.countedCash,62.5);
  assert.equal(actual.cashMismatch,null);
  assert.deepEqual(actual,plain(original().cashSessionSummaryFromRows_(current,[current],rows)));
});

test('when marker is missing old transactions remain in book balance but not session turnover',()=>{
  const current=session('missing','Open',90);
  const rows=[cash('old','Sale',300),cash('opening','Historical Opening',70)];
  const result=cashSessionSnapshot(current,[current],rows);
  assert.equal(cashBalance(rows),370);
  assert.equal(result.cashIn,0);
  assert.equal(result.cashOut,0);
  assert.equal(result.expectedCash,90);
  assert.deepEqual(result,plain(original().cashSessionSummaryFromRows_(current,[current],rows)));
});

test('matching current book cash suppresses prior-session cash mismatch',()=>{
  const prior={...session('s1','Closed',80),'Counted Cash':80};
  const current=session('s2','Open',100);
  const rows=[cash('marker','Session Open','','','s2'),cash('cash','Sale',100)];
  const result=cashSessionSnapshot(current,[prior,current],rows);
  assert.equal(result.cashMismatch,null);
  assert.deepEqual(result,plain(original().cashSessionSummaryFromRows_(current,[prior,current],rows)));
});

test('no active session is null; invalid row arrays or leaked async results are refused',()=>{
  assert.equal(cashSessionSnapshot(null,[],[]),null);
  assert.throws(()=>cashBalance(Promise.resolve([])),TypeError);
  assert.throws(()=>cashBalance(null),TypeError);
  assert.throws(()=>cashSessionSnapshot(session(),Promise.resolve([]),[]),TypeError);
  assert.throws(()=>cashSessionSnapshot(session(),[],Promise.resolve([])),TypeError);
  assert.throws(()=>cashSessionSnapshot(undefined,[],[]),TypeError);
});

test('read calculations do not mutate frozen source input rows or session objects',()=>{
  const current=Object.freeze(session());
  const rows=Object.freeze([
    Object.freeze(cash('marker','Session Open','','','s2')),
    Object.freeze(cash('sale','Sale',10))
  ]);
  const sessions=Object.freeze([current]);
  assert.equal(cashBalance(rows),10);
  assert.equal(cashSessionSnapshot(current,sessions,rows).expectedCash,210);
});
