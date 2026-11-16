import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCashExplanation} from '../src/modules/m08-cash-reconciliation-explanation.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const original=loadPinnedGASFunctions({
  'Utils.gs':['roundMoney_'],
  'CashReconciliation.gs':[
    'cashReconciliationSigned_',
    'cashReconciliationIsDeleted_',
    'cashReconciliationIsSynthetic_',
    'cashReconciliationParseIds_',
    'cashReconciliationRequiredDirection_',
    'cashReconciliationRowById_',
    'cashReconciliationEvaluate_'
  ]
});
const plain=value=>JSON.parse(JSON.stringify(value));
const entry=(id,credit='',debit='',type='Sale',deleted='')=>({
  'Entry ID':id,'Credit':credit,'Debit':debit,'Type':type,'Is Deleted':deleted
});
function parity(difference,ids,rows,isBaseline=false) {
  const actual=evaluateCashExplanation(difference,ids,rows,{isBaseline});
  const expected=plain(original.cashReconciliationEvaluate_(difference,ids,rows,isBaseline));
  assert.deepEqual(actual,expected);
  return actual;
}

test('first session is a historical baseline; missing difference stays open',()=>{
  const rows=[entry('sale',30)];
  const baseline=parity(-30,'sale',rows,true);
  assert.equal(baseline.state,'Baseline');
  assert.equal(baseline.requiredAmount,0);
  assert.deepEqual(baseline.entryIds,['sale']);
  const waiting=parity('',[],rows);
  assert.equal(waiting.state,'Open');
  assert.equal(waiting.remainingAmount,0);
});

test('zero difference is balanced only with no linked IDs',()=>{
  assert.equal(parity(0,'',[]).state,'Balanced');
  const stale=parity(0,'["old"]',[]);
  assert.equal(stale.state,'Needs Review');
  assert.equal(stale.linkedAmount,0);
});

test('positive difference needs exact real cash credits',()=>{
  const rows=[entry('credit-a',50),entry('credit-b',75.25)];
  const result=parity(125.25,'["credit-a","credit-b"]',rows);
  assert.equal(result.state,'Explained');
  assert.equal(result.requiredDirection,'Cash In');
  assert.equal(result.linkedAmount,125.25);
  assert.equal(result.remainingAmount,0);
});

test('negative difference needs exact real cash debits',()=>{
  const result=parity(-40.75,'expense',[entry('expense','',40.75,'Expense')]);
  assert.equal(result.state,'Explained');
  assert.equal(result.requiredDirection,'Cash Out');
  assert.equal(result.requiredAmount,40.75);
});

test('unlinked, underlinked and overlinked amounts are never explained',()=>{
  const cash=[entry('part',20),entry('extra',50)];
  const unlinked=parity(50,[],cash);
  assert.equal(unlinked.state,'Unexplained');
  assert.equal(unlinked.remainingAmount,50);
  const under=parity(50,['part'],cash);
  assert.equal(under.state,'Needs Review');
  assert.equal(under.remainingAmount,30);
  const over=parity(50,['part','extra'],cash);
  assert.equal(over.state,'Needs Review');
  assert.equal(over.linkedAmount,70);
  assert.equal(over.remainingAmount,0);
});

test('deleted, missing, synthetic, wrong-direction and zero-value entries need review',()=>{
  const scenarios=[
    [entry('gone',30,'','Sale',true)],
    [entry('gone',30,'','Sale','TRUE')],
    [entry('gone',30,'','Session Open')],
    [entry('gone',30,'','Day Close Adjustment')],
    [entry('gone','',30,'Expense')],
    [entry('gone',0,0)],
    []
  ];
  for(const rows of scenarios) {
    const result=parity(30,'gone',rows);
    assert.equal(result.state,'Needs Review');
  }
});

test('CSV, newline, JSON and array links de-duplicate while preserving original order',()=>{
  const rows=[entry('a',15),entry('b',25)];
  for(const ids of ['a,a\nb','["a","a","b"]',['a','a','b']]) {
    const result=parity(40,ids,rows);
    assert.equal(result.state,'Explained');
    assert.deepEqual(result.entryIds,['a','b']);
  }
});

test('does not mutate input and refuses unloaded/async row sets',()=>{
  const cash=Object.freeze([Object.freeze(entry('safe',10))]);
  const result=parity(10,'safe',cash);
  assert.equal(result.state,'Explained');
  assert.throws(()=>evaluateCashExplanation(10,'safe',Promise.resolve(cash)),TypeError);
  assert.throws(()=>evaluateCashExplanation(10,'safe',null),TypeError);
  assert.throws(()=>evaluateCashExplanation(10,'safe',{}),TypeError);
});
