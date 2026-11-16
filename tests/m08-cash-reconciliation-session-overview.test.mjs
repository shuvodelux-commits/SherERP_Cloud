import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCashReconciliationSessions} from '../src/modules/m08-cash-reconciliation-session-overview.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const timeZone='Asia/Dhaka';
const oracle=loadPinnedGASFunctions({
  'Utils.gs':['roundMoney_','formatDate_','safeDateOnly_'],
  'CashReconciliation.gs':[
    'cashReconciliationSigned_','cashReconciliationIsDeleted_',
    'cashReconciliationIsSynthetic_','cashReconciliationParseIds_',
    'cashReconciliationRequiredDirection_','cashReconciliationRowById_',
    'cashReconciliationEvaluate_','cashReconciliationSortKey_',
    'cashReconciliationBuildRows_'
  ]
},{
  Session:{getScriptTimeZone:()=>timeZone},
  Utilities:{formatDate:(value,tz,pattern)=>{
    assert.equal(pattern,'yyyy-MM-dd');
    const parts=new Intl.DateTimeFormat('en-GB',{
      timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(value);
    const part=type=>parts.find(x=>x.type===type).value;
    return [part('year'),part('month'),part('day')].join('-');
  }}
});
const plain=v=>JSON.parse(JSON.stringify(v));
const session=(id,status,openedAt,fields={})=>({
  'Session ID':id,'Status':status,'Opened At':openedAt,'Opening Cash':100,
  'Expected Cash':'','Counted Cash':'','Variance':'',
  'Opening Explanation Entry IDs':'','Closing Explanation Entry IDs':'',
  'Notes':'',...fields
});
const entry=(id,credit='',debit='',fields={})=>({
  'Entry ID':id,'Credit':credit,'Debit':debit,'Type':'Sale',
  'Is Deleted':'',...fields
});
function parity(sessions,cash){
  const actual=projectCashReconciliationSessions(sessions,cash,{timeZone});
  const expected=plain(oracle.cashReconciliationBuildRows_(sessions,cash));
  assert.deepEqual(actual,expected);
  return actual;
}

test('sorts sessions before comparing openings to preceding Closed counted cash',()=>{
  const first=session('first','Closed','2026-11-14T09:00:00+06:00',{
    'Opening Cash':100,'Expected Cash':150,'Counted Cash':140,
    'Closing Explanation Entry IDs':'out-10','Notes':'prior till'
  });
  const second=session('second','Closed','2026-11-15T10:00:00+06:00',{
    'Opening Cash':160,'Opening Explanation Entry IDs':'in-20',
    'Expected Cash':135,'Counted Cash':130,'Variance':-5,
    'Closing Explanation Entry IDs':'out-5'
  });
  const rows=parity([second,first],[
    entry('in-20',20),entry('out-10','',10),
    entry('out-5','',5)
  ]);
  assert.deepEqual(rows.map(r=>r.sessionId),['first','second']);
  assert.equal(rows[0].openingState,'Baseline');
  assert.equal(rows[0].closingState,'Explained');
  assert.equal(rows[0].reconciliationState,'Explained');
  assert.equal(rows[1].openingExpected,140);
  assert.equal(rows[1].openingDifference,20);
  assert.equal(rows[1].openingState,'Explained');
  assert.equal(rows[1].closingDifference,-5);
  assert.equal(rows[1].closingState,'Explained');
  assert.equal(rows[1].needsReview,false);
});

test('open, closing and incomplete closed sessions do not advance the prior closed counted cash',()=>{
  const rows=parity([
    session('closing','Closing','2026-11-16T10:00:00+06:00',{
      'Opening Cash':150,'Expected Cash':155
    }),
    session('late','Open','2026-11-18T10:00:00+06:00',{
      'Opening Cash':170
    }),
    session('prior','Closed','2026-11-14T10:00:00+06:00',{
      'Expected Cash':120,'Counted Cash':120
    }),
    session('incomplete','Closed','2026-11-17T10:00:00+06:00',{
      'Opening Cash':160,'Expected Cash':155
    })
  ],[]);
  assert.deepEqual(rows.map(r=>r.sessionId),['prior','closing','incomplete','late']);
  assert.equal(rows[1].openingExpected,120);
  assert.equal(rows[1].openingDifference,30);
  assert.equal(rows[1].closingState,'Closing');
  assert.equal(rows[1].reconciliationState,'Needs Review');
  assert.equal(rows[2].openingExpected,120);
  assert.equal(rows[2].closingState,'Needs Review');
  assert.equal(rows[3].openingExpected,120);
  assert.equal(rows[3].reconciliationState,'Needs Review');
});

test('an explicit zero variance takes precedence over counted minus expected',()=>{
  const rows=parity([session('zero','Closed','2026-11-15T10:00:00+06:00',{
    'Expected Cash':100,'Counted Cash':105,'Variance':0
  })],[]);
  assert.equal(rows[0].closingDifference,0);
  assert.equal(rows[0].closingState,'Balanced');
  assert.equal(rows[0].reconciliationState,'Balanced');

  const inferred=parity([session('inferred','Closed','2026-11-15T10:00:00+06:00',{
    'Expected Cash':100,'Counted Cash':105,'Variance':''
  })],[]);
  assert.equal(inferred[0].closingDifference,5);
  assert.equal(inferred[0].closingState,'Unexplained');
  assert.equal(inferred[0].reconciliationState,'Needs Review');
});

test('deleted and synthetic explanation links are never treated as real movements',()=>{
  const rows=parity([session('problem','Closed','2026-11-15T10:00:00+06:00',{
    'Expected Cash':100,'Counted Cash':120,
    'Closing Explanation Entry IDs':'["deleted","synthetic"]'
  })],[
    entry('deleted',20,'',{ 'Is Deleted':'TRUE'}),
    entry('synthetic',20,'',{Type:'Session Open'})
  ]);
  assert.equal(rows[0].closingState,'Needs Review');
  assert.equal(rows[0].closingLinkedAmount,0);
  assert.equal(rows[0].closingRemainingAmount,20);
  assert.equal(rows[0].needsReview,true);
  assert.deepEqual(rows[0].closingExplanationEntryIds,['deleted','synthetic']);
});

test('source date is normalized using explicit Dhaka timezone and has invalid text fallback',()=>{
  const rows=parity([
    session('midnight','Open','2026-11-16T23:30:00Z',{
      'Date':'2026-11-16T23:30:00Z'
    }),
    session('invalid','Open','not-a-date',{Date:'not-a-date'})
  ],[]);
  const midnight=rows.find(x=>x.sessionId==='midnight');
  const invalid=rows.find(x=>x.sessionId==='invalid');
  assert.equal(midnight.date,'2026-11-17');
  assert.equal(invalid.date,'not-a-date');
});

test('empty arrays, frozen inputs and fail-closed Promise/invalid row inputs',()=>{
  assert.deepEqual(parity([],[]),[]);
  const closed=Object.freeze(session('frozen','Closed','2026-11-15T08:00:00+06:00',{
    'Expected Cash':100,'Counted Cash':100
  }));
  const sessions=Object.freeze([closed]);
  const cash=Object.freeze([Object.freeze(entry('no-mutation',2))]);
  assert.equal(parity(sessions,cash)[0].closingState,'Balanced');
  assert.equal(sessions[0]['Session ID'],'frozen');
  assert.throws(()=>projectCashReconciliationSessions(Promise.resolve([]),[],{timeZone}),TypeError);
  assert.throws(()=>projectCashReconciliationSessions([],Promise.resolve([]),{timeZone}),TypeError);
  assert.throws(()=>projectCashReconciliationSessions(null,[],{timeZone}),TypeError);
  assert.throws(()=>projectCashReconciliationSessions([],[],{}),TypeError);
  assert.throws(()=>projectCashReconciliationSessions([null],[],{timeZone}),TypeError);
  assert.throws(()=>projectCashReconciliationSessions([],['bad-row'],{timeZone}),TypeError);
});
