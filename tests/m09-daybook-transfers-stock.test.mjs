import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDayBookWindow} from '../src/modules/daybook-window-totals.js';

const source=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
function chunk(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Frozen original DayBook.gs source section missing: '+start);
  return source.slice(a,b);
}
const maps=chunk('const DAY_BOOK_DELETE_MAP = {','function getDayBookBootstrap(');
const row=chunk('function dayBookRow_(o) {','\n/**');
const transferBlock=chunk('    // ---------------- Bank transfers ----------------',
  '    // ---------------- Stock adjustments ----------------');
const stockBlock=chunk('    // ---------------- Stock adjustments ----------------',
  '    // ---- Running drawer balance:');
const oracle=runInNewContext('(function(snapshot){\n'+maps+'\n'+row+'\n'+
  "function safeDateOnly_(value){return String(value||'').slice(0,10);}\n"+
  'const rows=[];\nconst bankTransfers=snapshot.bankTransfers;\n'+
  "function getAllRows_(key){if(key==='STOCK_MOVEMENT')return snapshot.stockMovements;"+
    "throw Error('Unexpected pinned source '+key);}\n"+
  transferBlock+'\n'+stockBlock+'\nreturn rows;\n})');

const json=value=>JSON.parse(JSON.stringify(value));
const impl=await import('../src/modules/daybook-transfers-stock.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(snapshot){
  assert.equal(typeof impl?.projectDayBookTransferStockRows,'function',
    'M09 Day Book Bank Transfer / Stock Adjustment projector not implemented');
  return impl.projectDayBookTransferStockRows(snapshot);
}
function parity(snapshot){
  const actual=json(project(snapshot)),expected=json(oracle(json(snapshot)));
  assert.deepEqual(actual,expected,'Transfer/Stock rows must match unmodified frozen DayBook.gs source');
  return actual;
}
const snap=(bankTransfers=[],stockMovements=[])=>({bankTransfers,stockMovements});
function transfer(id,more={}){
  return {
    'Transfer ID':id,'Date':'2026-11-16','Created At':'2026-11-16T12:30:05',
    'From Account Name':'Bank A','To Account Name':'Bank B',
    'Notes':'Move float','Created By':'OWNER',
    ...more
  };
}
function stock(id,type='Adjust In',more={}){
  return {
    'Movement ID':id,'Product ID':'SKU-10','Product Name':'Switch',
    'Type':type,'Date':'2026-11-16T12:40:06',
    'Quantity In':'8.5','Quantity Out':'0','Notes':'Physical recount',
    ...more
  };
}
test('pinned GAS source: one zero-money Transfer and one zero-money Stock Adjustment, original IDs/nav/key order',()=>{
  const rows=parity(snap([transfer('BT-1')],[stock('MOV-1')]));
  assert.deepEqual(rows.map(r=>r.module),['Bank Transfer','Stock Adjustment']);
  assert.deepEqual(rows.map(r=>r.referenceNo),['BT-1','MOV-1']);
  assert.deepEqual(rows.map(r=>r.sourceId),['BT-1','SKU-10']);
  assert.deepEqual(rows.map(r=>r.openPage),['bank','products']);
  assert.deepEqual(rows.map(r=>r.openId),['BT-1','SKU-10']);
  assert.deepEqual(rows.map(r=>r.deleteModule),['','']);
  assert.deepEqual(rows.map(r=>r.deleteId),['BT-1','SKU-10']);
  assert.deepEqual(rows.map(r=>r.amount),[0,0]);
  assert.deepEqual(rows.map(r=>r.date),['2026-11-16','2026-11-16']);
  assert.equal(rows[0].paymentMethod,'Bank');
  assert.equal(rows[1].paymentMethod,'');
  assert.equal(rows[0].party,'Bank A → Bank B');
  assert.equal(rows[1].description,'Physical recount (+8.5)');
  assert.equal(rows[1].ts,'2026-11-16T12:40:06');
});

test('Bank Transfer source row is a single net-zero header even with large account transfer amount fields',()=>{
  const rows=parity(snap([
    transfer('BT-200',{'Amount':'900000','Credit':'900000','Debit':'900000','Status':'Reversed',
      'Is Deleted':'TRUE','Is Backdated':'TRUE','Backdated Days':20}),
    transfer('BT-201',{'Date':'2026-11-15','Created At':'','From Account Name':'',
      'To Account Name':'','Notes':'','Created By':''})
  ]));
  assert.deepEqual(rows.map(r=>r.party),['Bank A → Bank B',' → ']);
  assert.deepEqual(rows.map(r=>r.description),['Move float','Transfer between accounts']);
  assert.deepEqual(rows.map(r=>r.ts),['2026-11-16T12:30:05','2026-11-15']);
  for(const r of rows){
    assert.equal(r.amount,0);
    assert.deepEqual([r.cashIn,r.cashOut,r.bankIn,r.bankOut],[0,0,0,0]);
    assert.equal(r.isDeleted,false);
    assert.equal(r.isBackdated,false);
    assert.equal(r.status,'Active');
    assert.equal(r.backdatedDays,0);
    assert.equal(r.deletedBy,'');
  }
});

test('source Stock Movement Type substring filter is case-sensitive and does not add other inventory events',()=>{
  const rows=parity(snap([],[
    stock('M1','Adjust In'),
    stock('M2','Adjust Out'),
    stock('M3','Adjustment'),
    stock('M4','Sale'),
    stock('M5','Purchase Return'),
    stock('M6','adjustment'),
    stock('M7','Manual Adjust Goods')
  ]));
  assert.deepEqual(rows.map(r=>r.referenceNo),['M1','M2','M3','M7']);
  assert.deepEqual(rows.map(r=>r.transactionType),
    ['Adjust In','Adjust Out','Adjustment','Manual Adjust Goods']);
});

test('source Stock adjustment quantity description matches plus, minus, blank, zero and precedence',()=>{
  const rows=parity(snap([],[
    stock('PLUS','Adjust In',{'Quantity In':'4.25','Quantity Out':'9','Notes':''}),
    stock('MINUS','Adjust Out',{'Quantity In':'0','Quantity Out':'6.75','Notes':''}),
    stock('ZERO','Adjustment',{'Quantity In':'','Quantity Out':'','Notes':''}),
    stock('NEGATIVE','Adjust In',{'Quantity In':'-3','Quantity Out':'1','Notes':'Correction'}),
    stock('DATE-ONLY','Adjust Out',{'Date':'2026-11-15','Quantity In':'','Quantity Out':'2'})
  ]));
  assert.deepEqual(rows.map(r=>r.description),[
    'Stock adjusted (+4.25)','Stock adjusted (-6.75)','Stock adjusted (-0)',
    'Correction (+-3)','Physical recount (-2)'
  ]);
  assert.equal(rows[4].ts,'2026-11-15');
  assert.equal(rows[4].date,'2026-11-15');
  assert.equal(rows.every(r=>r.amount===0),true);
});

test('no invented Stock creator, deletion or backdate audit; original defaults and Product ID navigation',()=>{
  const rows=parity(snap([],[stock('MV-6','Adjust Out',{
    'Product ID':'P-6','Product Name':'PVC Pipe',
    'Created By':'MANAGER','Is Deleted':'TRUE','Is Backdated':'TRUE',
    'Deleted By':'OWNER','Status':'Cancelled','Backdated Days':'9'
  })]));
  assert.equal(rows[0].referenceNo,'MV-6');
  assert.equal(rows[0].sourceId,'P-6');
  assert.equal(rows[0].openId,'P-6');
  assert.equal(rows[0].party,'PVC Pipe');
  assert.equal(rows[0].createdBy,'');
  assert.equal(rows[0].status,'Active');
  assert.equal(rows[0].isDeleted,false);
  assert.equal(rows[0].isBackdated,false);
  assert.equal(rows[0].deleteModule,'');
  assert.equal(rows[0].backdatedDays,0);
});

test('legacy blank Bank Transfer ID and blank Stock Product ID preserve explicit original source defaults',()=>{
  const rows=parity(snap([transfer('',{'Created At':null})],[stock('MV-7','Adjust In',{
    'Product ID':'','Product Name':'','Notes':'','Quantity In':'1'
  })]));
  assert.equal(rows[0].sourceId,'');
  assert.equal(rows[0].referenceNo,'');
  assert.equal(rows[0].openId,'');
  assert.equal(rows[0].deleteId,'');
  assert.equal(rows[1].sourceId,'');
  assert.equal(rows[1].openId,'');
  assert.equal(rows[1].deleteId,'');
  assert.equal(rows[1].party,'');
});

test('source row order is transfers first then adjusted movements, with no local sort or invented transaction posting',()=>{
  const rows=parity(snap([
    transfer('BT-LATER',{'Date':'2026-11-16'}),
    transfer('BT-EARLIER',{'Date':'2026-11-15'})
  ],[
    stock('MV-LATER','Adjustment',{'Date':'2026-11-16'}),
    stock('MV-UNRELATED','Sale'),
    stock('MV-EARLIER','Adjust Out',{'Date':'2026-11-14'})
  ]));
  assert.deepEqual(rows.map(r=>r.referenceNo),
    ['BT-LATER','BT-EARLIER','MV-LATER','MV-EARLIER']);
  const result=projectDayBookWindow(rows,{},false);
  assert.equal(result.totals.netCash,0);
  assert.equal(result.totals.netBank,0);
});

test('immutable input/output separation and complete groups including empty arrays',()=>{
  const b=Object.freeze(transfer('BT-1'));
  const m=Object.freeze(stock('MOV-1'));
  const s=Object.freeze({bankTransfers:Object.freeze([b]),stockMovements:Object.freeze([m])});
  const result=parity(s);
  result[0].party='tampered';
  assert.equal(project(s)[0].party,'Bank A → Bank B');
  assert.equal(b['From Account Name'],'Bank A');
  assert.equal(m['Quantity In'],'8.5');
  assert.deepEqual(parity(snap()),[]);
});

test('reject incomplete source, getter/accessor, unsafe IDs, duplicate IDs, bad quantities and date',()=>{
  const invalid=[
    null,{},[],{bankTransfers:[],stockMovements:undefined},
    {...snap(),untrusted:'extra'},
    snap([transfer('BT-1'),transfer('BT-1')]),
    snap([],[stock('M-1'),stock('M-1')]),
    snap([transfer('__proto__')]),
    snap([],[stock('constructor')]),
    snap([],[stock('M-1','Adjust Out',{'Product ID':'__proto__'})]),
    snap([],[stock('M-1','Adjust In',{'Quantity In':'bad'})]),
    snap([],[stock('M-1','Adjust Out',{'Quantity Out':'Infinity'})]),
    snap([],[stock('M-1','Adjust In',{'Quantity In':Infinity})]),
    snap([transfer('BT-1',{'Date':'2026-02-30'})]),
    snap([],[stock('M-1','Adjust In',{'Date':'2026-11-16T25:00:00'})]),
    snap([Object.defineProperty(transfer('BT-1'),'Date',{
      enumerable:true,get(){throw Error('accessor executed');}
    })]),
    snap([],[Object.defineProperty(stock('M-1'),'Type',{
      enumerable:true,get(){throw Error('accessor executed');}
    })])
  ];
  for(const s of invalid)
    assert.throws(()=>project(s),
      /invalid|trusted|duplicate|unsafe|date|timestamp|amount|quantity|array|accessor|reference|finite|snapshot/i);
});

test('original UI, allowlist and DB-free public Worker preview unchanged; helper cannot post or query D1',()=>{
  const ui=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.match(ui,/serverCall\('getDayBookTransactions', authToken, filters\)/);
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(preview.d1_databases,undefined);
  assert.equal(typeof impl?.projectDayBookTransferStockRows,'function',
    'M09 Day Book Bank Transfer / Stock Adjustment projector not implemented');
  const moduleCode=readFileSync(new URL('../src/modules/daybook-transfers-stock.js',import.meta.url),'utf8');
  assert.doesNotMatch(moduleCode,/\b(?:prepare|batch|exec|fetch)\s*\(/);
  assert.doesNotMatch(moduleCode,/CacheService|globalThis|new Date\(/);
});
