import test from 'node:test';
import assert from 'node:assert/strict';
import {recalculateClosedSessionCash} from '../src/modules/m08-closed-session-cash-recalculation.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const original=loadPinnedGASFunctions({
  'Utils.gs':['roundMoney_'],
  'CashReconciliation.gs':[
    'cashReconciliationSigned_','cashReconciliationIsDeleted_',
    'cashReconciliationIsSynthetic_','cashReconciliationParseIds_',
    'cashReconciliationExplanationField_','cashReconciliationRowById_',
    'cashReconciliationLinkedUsage_','cashReconciliationRecalculateClosedSession_'
  ]
});
const plain=value=>JSON.parse(JSON.stringify(value));
const session=(id,fields={})=>({
  'Session ID':id,'Status':'Closed','Opening Cash':100,'Counted Cash':100,
  'Opening Explanation Entry IDs':'','Closing Explanation Entry IDs':'',
  ...fields
});
const cash=(id,credit='',debit='',type='Sale',fields={})=>({
  'Entry ID':id,'Type':type,'Credit':credit,'Debit':debit,
  'Reference':'','Is Deleted':'','Date':'2026-11-16',...fields
});
const marker=(id,fields={})=>cash('marker-'+id,'','', 'Session Open',{
  Reference:id,...fields
});
function parity(target,sessions,rows) {
  const expected=plain(original.cashReconciliationRecalculateClosedSession_(target,sessions,rows));
  const actual=recalculateClosedSessionCash(target,sessions,rows);
  assert.deepEqual(actual,expected);
  return actual;
}

test('returns null for a nonclosing session or when no matching Session Open marker exists',()=>{
  const s=session('s1',{'Status':'Open'});
  assert.equal(parity(s,[s],[marker('s1'),cash('sale',20)]),null);
  const closing=session('s1',{'Status':'Closing'});
  assert.equal(parity(closing,[closing],[marker('different'),cash('sale',20)]),null);
  assert.equal(parity(closing,[closing],[]),null);
  assert.equal(parity(null,[closing],[marker('s1')]),null);
});

test('native window follows positional Session Open markers, not the transaction dates',()=>{
  const s=session('s1',{'Counted Cash':112});
  const rows=[
    marker('s1'),
    cash('sale',20,'','Sale',{Date:'2026-11-30'}),
    cash('expense','',7,'Expense',{Date:'2026-10-01'}),
    cash('deleted',500,'','Sale',{'Is Deleted':'TRUE'}),
    cash('adjust',900,'','Day Close Adjustment'),
    marker('s2',{Date:'2026-01-01'}),
    cash('after',1000,'','Sale',{Date:'2026-02-02'})
  ];
  assert.deepEqual(parity(s,[s],rows),{expected:113,variance:-1});
});

test('opening links and rows used by another session are excluded from native movements',()=>{
  const target=session('s1',{'Opening Explanation Entry IDs':'opening'});
  const other=session('s2',{'Closing Explanation Entry IDs':'shared'});
  const rows=[
    marker('s1'),
    cash('opening',40),
    cash('shared',70),
    cash('normal',5),
    marker('s2')
  ];
  assert.deepEqual(parity(target,[target,other],rows),{expected:105,variance:-5});
});

test('real closing explanation inside the session window is counted only once',()=>{
  const s=session('s1',{'Closing Explanation Entry IDs':'["inside","inside"]',
    'Counted Cash':120});
  const rows=[marker('s1'),cash('inside',20),marker('s2')];
  assert.deepEqual(parity(s,[s],rows),{expected:120,variance:0});
});

test('late closing explanation after the NEXT Session Open belongs to original session once',()=>{
  const s=session('s1',{'Closing Explanation Entry IDs':'["late","late"]',
    'Counted Cash':139});
  const rows=[
    marker('s1'),cash('in-window',15),
    marker('s2'),cash('late',25),
    marker('s3'),cash('unlinked-future',900)
  ];
  assert.deepEqual(parity(s,[s],rows),{expected:140,variance:-1});
});

test('deleted, synthetic or missing late closing links never add money',()=>{
  const s=session('s1',{'Closing Explanation Entry IDs':
    'missing,deleted,synthetic,real'});
  const rows=[
    marker('s1'),marker('s2'),
    cash('deleted',60,'','Sale',{'Is Deleted':true}),
    cash('synthetic',50,'','Day Close Adjustment'),
    cash('real',5)
  ];
  assert.deepEqual(parity(s,[s],rows),{expected:105,variance:-5});
});

test('movement rows without an Entry ID remain part of native window as in the source',()=>{
  const s=session('s1',{'Counted Cash':120});
  const rows=[marker('s1'),cash('',20)];
  assert.deepEqual(parity(s,[s],rows),{expected:120,variance:0});
});

test('explicit counted zero computes a variance; absent closing count keeps it blank',()=>{
  const zero=session('s1',{'Counted Cash':0});
  const rows=[marker('s1'),cash('p',10)];
  assert.deepEqual(parity(zero,[zero],rows),{expected:110,variance:-110});
  for(const value of ['',null,undefined]) {
    const missing=session('s1',{'Counted Cash':value,'Status':'Closing'});
    assert.deepEqual(parity(missing,[missing],rows),{expected:110,variance:''});
  }
});

test('cent rounding occurs for each real signed cash movement and final expected/variance',()=>{
  const s=session('s1',{'Opening Cash':100,'Counted Cash':100});
  const rows=[
    marker('s1'),
    cash('a',0.1),cash('b',0.2),cash('c','',0.3),
    cash('d',5.235),cash('e','',5.235)
  ];
  assert.deepEqual(parity(s,[s],rows),{expected:100.01,variance:-0.01});
});

test('a later session can be Closing, and its own movement still gets source recalculation',()=>{
  const s=session('s1',{'Status':'Closing','Opening Cash':250,
    'Counted Cash':251.25});
  const rows=[marker('s1'),cash('up',3.5),cash('down','',2.25)];
  assert.deepEqual(parity(s,[s],rows),{expected:251.25,variance:0});
});

test('input snapshots are not mutated; invalid/unawaited or duplicated imported IDs fail closed',()=>{
  const s=Object.freeze(session('s1'));
  const sessions=Object.freeze([s]);
  const rows=Object.freeze([Object.freeze(marker('s1')),
    Object.freeze(cash('a',2))]);
  assert.deepEqual(parity(s,sessions,rows),{expected:102,variance:-2});
  assert.equal(s['Counted Cash'],100);
  assert.throws(()=>recalculateClosedSessionCash(s,Promise.resolve(sessions),rows),TypeError);
  assert.throws(()=>recalculateClosedSessionCash(s,sessions,Promise.resolve(rows)),TypeError);
  assert.throws(()=>recalculateClosedSessionCash(s,null,rows),TypeError);
  assert.throws(()=>recalculateClosedSessionCash(s,sessions,[null]),TypeError);
  assert.throws(()=>recalculateClosedSessionCash([],sessions,rows),TypeError);
  assert.throws(()=>recalculateClosedSessionCash(s,[session('s1'),session('s1')],rows),
    /Duplicate Cash Session ID/);
  assert.throws(()=>recalculateClosedSessionCash(s,sessions,[
    marker('s1'),cash('duplicate',1),cash('duplicate',2)
  ]),/Duplicate Cash Book Entry ID/);
  assert.throws(()=>recalculateClosedSessionCash(s,sessions,[
    marker('s1'),cash('a',2),marker('s1',{'Entry ID':'marker-duplicate'})
  ]),/Duplicate Session Open marker/);
});

test('prototype-shaped IDs do not inherit fake usage or allocation from Object.prototype',()=>{
  const s=session('s1',{
    'Opening Explanation Entry IDs':'__proto__',
    'Closing Explanation Entry IDs':'constructor'
  });
  const rows=[
    marker('s1'),cash('__proto__',40),cash('normal',5),
    marker('s2'),cash('constructor',20)
  ];
  assert.deepEqual(recalculateClosedSessionCash(s,[s],rows),
    {expected:125,variance:-25});
});
