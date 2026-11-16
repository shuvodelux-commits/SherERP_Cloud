import test from 'node:test';
import assert from 'node:assert/strict';
import {previewLegacyCashAdjustmentRetirement} from '../src/modules/m08-legacy-cash-adjustment-retirement-preview.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const sourceWrites=[];
const source=loadPinnedGASFunctions({
  'Utils.gs':['roundMoney_'],
  'CashReconciliation.gs':[
    'cashReconciliationSigned_','cashReconciliationIsDeleted_',
    'cashReconciliationRetireLegacyAdjustment_'
  ]
},{
  updateRowFields_:(table,rowIndex,fields)=>{
    sourceWrites.push({table,rowIndex,fields:plain(fields)});
  }
});
const entry=(id,type,reference,credit='',debit='',extra={})=>({
  'Entry ID':id,'Type':type,'Reference':reference,
  'Credit':credit,'Debit':debit,'Description':'',
  'Is Deleted':'',...extra
});
const opening=(id,reference,credit='',debit='',extra={})=>
  entry(id,'Session Open',reference,credit,debit,extra);
const closing=(id,reference,credit='',debit='',extra={})=>
  entry(id,'Day Close Adjustment',reference,credit,debit,extra);
const opts={sessionId:'s1',phase:'closing'};

function parity(rows,options=opts){
  sourceWrites.length=0;
  const before=plain(rows);
  source.cashReconciliationRetireLegacyAdjustment_(rows,options.sessionId,options.phase);
  const expected=plain(sourceWrites);
  const actual=previewLegacyCashAdjustmentRetirement(rows,options);
  assert.deepEqual(actual,expected);
  assert.deepEqual(rows,before,'preview must not mutate source-shaped Cash Book rows');
  return actual;
}

test('closing targets only nonzero Day Close Adjustment for the exact session reference',()=>{
  const updates=parity([
    opening('open','s1',25),
    closing('good','s1',20),
    closing('wrong-ref','s2',100),
    entry('real','Sale','s1',1000),
    closing('zero','s1',10,10),
    closing('empty','s1',0,0),
    closing('deleted','s1',15,'',{'Is Deleted':'TRUE'}),
    closing('boolean-deleted','s1',5,'',{'Is Deleted':true})
  ]);
  assert.equal(updates.length,1);
  assert.deepEqual(updates[0],{
    table:'CASH_BOOK',rowIndex:3,
    fields:{Debit:'',Credit:'',
      Description:'legacy automatic adjustment retired by Cash Reconciliation'}
  });
});

test('opening retires only matching nonzero Session Open markers, including cash-out',()=>{
  const updates=parity([
    opening('own','s1',40,'',{_rowIndex:17,Description:'  original marker  '}),
    opening('negative','s1','',4,{_rowIndex:19}),
    closing('adjust','s1',40),
    opening('another-session','s2',1)
  ],{sessionId:'s1',phase:'opening'});
  assert.equal(updates.length,2);
  assert.equal(updates[0].rowIndex,17);
  assert.equal(updates[1].rowIndex,19);
  assert.equal(updates[0].fields.Description,
    'original marker — legacy automatic adjustment retired by Cash Reconciliation');
  assert.equal(updates[1].fields.Description,
    'legacy automatic adjustment retired by Cash Reconciliation');
});

test('source row index falls back to array index+2 for blank or zero but accepts numeric strings',()=>{
  const updates=parity([
    closing('first','s1',3,'',{_rowIndex:''}),
    closing('second','s1',4,'',{_rowIndex:0}),
    closing('third','s1',5,'',{_rowIndex:'14'}),
    closing('fourth','s1',6,'')
  ]);
  assert.deepEqual(updates.map(u=>u.rowIndex),[2,3,14,5]);
});

test('preserves original array order and description exactly including unicode/audit suffix',()=>{
  const updates=parity([
    closing('a','s1','',12,{Description:'  চুক্তি সংশোধন  '}),
    closing('b','s1',7,'',{Description:'legacy tag'}),
    closing('c','s1',2,'',{Description:'  '})
  ]);
  assert.deepEqual(updates.map(u=>u.fields.Description),[
    'চুক্তি সংশোধন — legacy automatic adjustment retired by Cash Reconciliation',
    'legacy tag — legacy automatic adjustment retired by Cash Reconciliation',
    'legacy automatic adjustment retired by Cash Reconciliation'
  ]);
  assert.deepEqual(updates.map(u=>u.rowIndex),[2,3,4]);
  assert.ok(updates.every(u=>u.fields.Credit==='' && u.fields.Debit===''));
});

test('cent-rounded signed movement: balanced debit/credit and subcent zero do not retire',()=>{
  const updates=parity([
    closing('balanced','s1',20,20),
    closing('tiny','s1',0.004,''),
    closing('one-cent','s1',0.005,''),
    closing('out','s1','',0.03)
  ]);
  assert.deepEqual(updates.map(u=>u.rowIndex),[4,5]);
});

test('after posting zeroed debit/credit a repeated retirement preview is empty',()=>{
  const rows=[closing('old','s1','','',{
    Description:'old — legacy automatic adjustment retired by Cash Reconciliation'
  })];
  assert.deepEqual(parity(rows),[]);
  assert.deepEqual(parity([]),[]);
});

test('frozen imported rows and arrays are never modified by preview',()=>{
  const rows=Object.freeze([
    Object.freeze(opening('one','s1',50,'',{Description:'  opening  '}),
    ),
    Object.freeze(closing('two','s1',30))
  ]);
  const sourceWritesBefore=sourceWrites.length;
  const updates=parity(rows,{sessionId:'s1',phase:'opening'});
  assert.equal(updates[0].fields.Description,
    'opening — legacy automatic adjustment retired by Cash Reconciliation');
  assert.equal(sourceWritesBefore>=0,true);
  assert.equal(rows[0]['Credit'],50);
});

test('prototype-shaped IDs and references are treated as ordinary source text',()=>{
  const rows=[
    closing('__proto__','constructor',30),
    closing('constructor','constructor',20),
    closing('normal','s1',5)
  ];
  const result=parity(rows,{sessionId:'constructor',phase:'closing'});
  assert.equal(result.length,2);
  assert.deepEqual(result.map(x=>x.rowIndex),[2,3]);
});

test('rejects unawaited or malformed source input, invalid phase and blank session',()=>{
  assert.throws(()=>previewLegacyCashAdjustmentRetirement(Promise.resolve([]),opts),TypeError);
  assert.throws(()=>previewLegacyCashAdjustmentRetirement(null,opts),TypeError);
  assert.throws(()=>previewLegacyCashAdjustmentRetirement([null],opts),TypeError);
  assert.throws(()=>previewLegacyCashAdjustmentRetirement(['bad'],opts),TypeError);
  assert.throws(()=>previewLegacyCashAdjustmentRetirement([],{}),/Session reference/);
  assert.throws(()=>previewLegacyCashAdjustmentRetirement([],{sessionId:'s1',phase:'wrong'}),
    /Choose opening or closing/);
});

test('fail-closed: duplicate source Cash Book Entry IDs even across different phases',()=>{
  const rows=[
    opening('duplicate','s1',10),
    closing('duplicate','s1',5)
  ];
  assert.throws(()=>previewLegacyCashAdjustmentRetirement(rows,opts),
    /Duplicate Cash Book Entry ID/);
});

test('fail-closed: duplicate effective target row index or invalid physical source index',()=>{
  const duplicate=[
    closing('a','s1',10,'',{_rowIndex:25}),
    closing('b','s1',20,'',{_rowIndex:25})
  ];
  assert.throws(()=>previewLegacyCashAdjustmentRetirement(duplicate,opts),
    /Duplicate Cash Book row index/);
  for(const invalid of [-1,2.5,'no-row',Infinity]) {
    const rows=[closing('a','s1',10,'',{_rowIndex:invalid})];
    assert.throws(()=>previewLegacyCashAdjustmentRetirement(rows,opts),
      /Invalid Cash Book row index/);
  }
});
