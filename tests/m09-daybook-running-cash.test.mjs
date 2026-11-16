import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDayBookWindow} from '../src/modules/daybook-window-totals.js';

const source=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const start=source.indexOf("rows.forEach(function (row) { row.ts = String(row.ts || ''); });");
const end=source.indexOf('const filtered = rows.filter(function (row)',start);
const timeStart=source.indexOf('function dayBookTimeFromTs_(ts) {');
const timeEnd=source.indexOf('\n}',timeStart);
const roundStart=utils.indexOf('function roundMoney_(value) {');
const roundEnd=utils.indexOf('\n}',roundStart);
assert.ok(start>=0 && end>start && timeStart>=0 && timeEnd>timeStart &&
  roundStart>=0 && roundEnd>roundStart,'Frozen Cash Book chronology oracle missing');
const frozen=utils.slice(roundStart,roundEnd+2)+'\n'+
  source.slice(timeStart,timeEnd+2)+'\n'+source.slice(start,end);
const oracle=runInNewContext('(function(rows,cashBookRows) {\n'+frozen+
  '\nreturn rows;\n})');
const plain=x=>JSON.parse(JSON.stringify(x));
const impl=await import('../src/modules/daybook-running-cash.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(rows,books){
  assert.equal(typeof impl?.projectDayBookRunningCash,'function',
    'M09 Day Book running Cash Book projector not implemented');
  return impl.projectDayBookRunningCash(rows,books);
}
function parity(rows,books){
  const actual=plain(project(rows,books));
  assert.deepEqual(actual,plain(oracle(plain(rows),plain(books))),
    'Cash Book chronology must match frozen source implementation');
  return actual;
}
function row(referenceNo,ts,changes={}){
  return {
    ts,date:ts.slice(0,10),time:'',referenceNo,module:'Sales',
    transactionType:'Cash Sale',party:'Cash customer',description:'',
    paymentMethod:'Cash',cashIn:0,cashOut:0,bankIn:0,bankOut:0,
    amount:0,createdBy:'ADMIN',status:'Active',isDeleted:false,
    isBackdated:false,runningCashBalance:null,...changes
  };
}
function book(id,reference,date,credit='',debit='',createdAt='',other={}){
  return {
    'Entry ID':id,'Reference':reference,'Date':date,'Created At':createdAt,
    'Credit':credit,'Debit':debit,...other
  };
}

test('cash drawer starts null and does not fabricate balance from Day Book display amounts',()=>{
  const rows=[
    row('S-1','2026-11-16T10:00:00',{cashIn:500}),
    row('BANK','2026-11-16T10:01:00',{bankIn:100,paymentMethod:'Bank'})
  ];
  const output=parity(rows,[]);
  assert.equal(output.length,2);
  assert.deepEqual(output.map(r=>r.runningCashBalance),[null,null]);
  assert.deepEqual(output.map(r=>r.time),['10:00:00','10:01:00']);
  assert.equal(output[0].cashIn,500,'display metadata must not itself alter drawer');
});

test('equal-second owning documents apply Cash Book movement to the correct sorted source index',()=>{
  const docs=[
    row('A','2026-11-16T10:00:00',{cashIn:10}),
    row('B','2026-11-16T10:00:00',{cashIn:20}),
    row('BANK','2026-11-16T10:00:01',{bankIn:80,paymentMethod:'Bank'})
  ];
  const cash=[
    book('CB-A','A','2026-11-16','10','','2026-11-16T10:00:00'),
    book('CB-B','B','2026-11-16','20','','2026-11-16T10:00:00')
  ];
  const result=parity(docs,cash);
  assert.deepEqual(result.map(r=>r.runningCashBalance),[10,30,30]);
  assert.deepEqual(result.map(r=>r.referenceNo),['A','B','BANK']);
});

test('unowned same-second movement applies before first document while named movements stay attached',()=>{
  const rows=[row('S-1','2026-11-16T10:00:00',{cashIn:10}),
    row('S-2','2026-11-16T10:00:00',{cashIn:5})];
  const cash=[
    book('CB-1','UNMATCHED','2026-11-16','3','','2026-11-16T10:00:00'),
    book('CB-2','S-1','2026-11-16','10','','2026-11-16T10:00:00'),
    book('CB-3','S-2','2026-11-16','5','','2026-11-16T10:00:00')
  ];
  assert.deepEqual(parity(rows,cash).map(r=>r.runningCashBalance),[13,18]);
});

test('business Date-only and midnight Cash Book rows attach to source posting, not midnight',()=>{
  const rows=[
    row('EARLY','2026-11-16T08:00:00'),
    row('S-1','2026-11-16T13:00:00',{cashIn:75}),
    row('S-2','2026-11-16T13:02:00',{cashOut:25})
  ];
  const books=[
    book('CB-1','S-1','2026-11-16','75'),
    book('CB-2','S-2','2026-11-16T00:00:00','','25')
  ];
  const result=parity(rows,books);
  assert.deepEqual(result.map(r=>r.runningCashBalance),[null,75,50]);
});

test('near-source 30-second boundary attaches; later correction retains own Created At',()=>{
  const rows=[
    row('S-1','2026-11-16T10:00:00',{cashIn:100}),
    row('S-2','2026-11-16T10:00:10',{cashIn:10}),
    row('S-3','2026-11-16T10:01:00',{cashIn:15})
  ];
  const books=[
    book('CB-1','S-1','2026-11-16','100','','2026-11-16T10:00:30'),
    book('CB-2','S-2','2026-11-16','10','','2026-11-16T10:00:41'),
    book('CB-3','S-3','2026-11-16','15','','2026-11-16T10:01:00')
  ];
  const result=parity(rows,books);
  assert.deepEqual(result.map(r=>r.runningCashBalance),[100,100,125]);
  // CB-2's late posting at 10:00:41 is retained and applied before S-3.
});

test('negative drawers, cash credits/debits, separate bank movement and cents rounding match source',()=>{
  const rows=[
    row('D-1','2026-11-16T09:00:00',{cashOut:50}),
    row('C-1','2026-11-16T09:10:00',{cashIn:0.015}),
    row('C-2','2026-11-16T09:15:00',{cashIn:0.015}),
    row('B-1','2026-11-16T09:20:00',{bankIn:500,paymentMethod:'Bank'})
  ];
  const books=[
    book('CB-1','D-1','2026-11-16','','50','2026-11-16T09:00:01'),
    book('CB-2','C-1','2026-11-16','0.015','','2026-11-16T09:10:00'),
    book('CB-3','C-2','2026-11-16','0.015','','2026-11-16T09:15:00')
  ];
  const result=parity(rows,books);
  assert.deepEqual(result.map(r=>r.runningCashBalance),[-50,-49.98,-49.96,-49.96]);
});

test('deleted cash-bearing row cannot anchor a Cash Book movement on its timestamp',()=>{
  const rows=[
    row('VOID','2026-11-16T10:00:00',{cashIn:100,isDeleted:true}),
    row('LIVE','2026-11-16T10:00:15',{cashIn:5}),
    row('LATER','2026-11-16T10:02:00',{bankIn:1})
  ];
  const books=[
    book('CB-VOID','VOID','2026-11-16','100','','2026-11-16T10:01:00'),
    book('CB-LIVE','LIVE','2026-11-16','5','','2026-11-16T10:00:15')
  ];
  const result=parity(rows,books);
  assert.deepEqual(result.map(r=>r.runningCashBalance),[null,5,105]);
  // Source includes all real Cash Book movements until a reversal exists;
  // hiding the Day Book row is not an invented Cash Book reversal.
});

test('sorted chronological rows survive final original filter, with prior Cash Book balance',()=>{
  const rows=[row('BEFORE','2026-11-15T23:59:59',{cashIn:10}),
    row('TODAY','2026-11-16T09:00:00',{cashOut:4})];
  const cash=[book('CB-A','BEFORE','2026-11-15','10','','2026-11-15T23:59:59'),
    book('CB-B','TODAY','2026-11-16','','4','2026-11-16T09:00:00')];
  const result=parity(rows,cash);
  const window=projectDayBookWindow(result,{dateFrom:'2026-11-16',dateTo:'2026-11-16'},false);
  assert.equal(window.count,1);
  assert.equal(window.rows[0].referenceNo,'TODAY');
  assert.equal(window.rows[0].runningCashBalance,6);
  assert.equal(window.totals.cashOut,4);
});

test('full immutable source records stay unchanged and each returned row is an isolated copy',()=>{
  const record=Object.freeze(row('S','2026-11-16T10:00:00',{cashIn:5}));
  const movement=Object.freeze(book('CB','S','2026-11-16','5','','2026-11-16T10:00:00'));
  const rows=Object.freeze([record]),cash=Object.freeze([movement]);
  const first=parity(rows,cash);
  const second=project(rows,cash);
  assert.equal(record.runningCashBalance,null);
  assert.notStrictEqual(first[0],record);
  first[0].party='tampered';
  assert.equal(second[0].party,'Cash customer');
  assert.equal(movement['Credit'],'5');
});

test('incomplete or unsafe snapshots, nonfinite money and ambiguous dates fail closed',()=>{
  for(const args of [
    [null,[]],[[],null],[[],undefined],[{},[]],
    [[row('A','bad')],[]],
    [[row('A','2026-11-16T10:00:00',{cashIn:Infinity})],[]],
    [[row('A','2026-11-16T10:00:00',{cashOut:'500'})],[]],
    [[row('__proto__','2026-11-16T10:00:00',{cashIn:1})],[]],
    [[],[book('X','REF','2026-02-30','1')]],
    [[],[book('X','REF','2026-11-16','nonsense')]],
    [[],[book('X','__proto__','2026-11-16','1')]],
    [[],[Object.defineProperty(book('X','','2026-11-16','1'),'Credit',
      {enumerable:true,get(){throw Error('getter executed');}})]],
    [[Object.defineProperty(row('A','2026-11-16T10:00:00'),'ts',
      {enumerable:true,get(){throw Error('getter executed');}})],[]]
  ]){
    assert.throws(()=>project(...args),/invalid|trusted|cash|date|money|timestamp|reference|finite|accessor|array|unsafe/i);
  }
});

test('source UI and public registry stay unchanged; projector performs no D1, RPC or cash write',()=>{
  const ui=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.match(ui,/serverCall\('getDayBookTransactions', authToken, filters\)/);
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(preview.d1_databases,undefined);
  assert.equal(typeof impl?.projectDayBookRunningCash,'function',
    'M09 Day Book running Cash Book projector not implemented');
  const code=readFileSync(new URL('../src/modules/daybook-running-cash.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:prepare|batch|exec|fetch)\s*\(/);
  assert.doesNotMatch(code,/CacheService|globalThis/);
});
