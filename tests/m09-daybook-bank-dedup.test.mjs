import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDayBookWindow} from '../src/modules/daybook-window-totals.js';

const source=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const mapsStart=source.indexOf('const DAY_BOOK_DELETE_MAP = {');
const mapsEnd=source.indexOf('function getDayBookBootstrap(',mapsStart);
const rowStart=source.indexOf('function dayBookRow_(o)');
const rowEnd=source.indexOf('\n/**',rowStart);
const ownedStart=source.indexOf('function ownedReferences_(');
const ownedEnd=source.indexOf('\n/**',ownedStart);
const bankStart=source.indexOf("const bankTransfers = getAllRows_('BANK_TRANSFERS');");
const bankEnd=source.indexOf('    // ---------------- Bank transfers ----------------',bankStart);
assert.ok(mapsStart>=0 && mapsEnd>mapsStart && rowStart>=0 && rowEnd>rowStart &&
  ownedStart>=0 && ownedEnd>ownedStart && bankStart>=0 && bankEnd>bankStart,
  'Frozen Mohim DayBook.gs ownedReferences_/dayBookRow_/Bank activity source must exist');
const frozenSource=[source.slice(mapsStart,mapsEnd),
  source.slice(rowStart,rowEnd),source.slice(ownedStart,ownedEnd)].join('\n');
const bankCode=source.slice(bankStart,bankEnd);
const original=runInNewContext('(function (snapshot, includeDeleted) {\n'+frozenSource+
  '\nconst sales=snapshot.sales,purchases=snapshot.purchases,expenses=snapshot.expenses,'+
  'custPayments=snapshot.customerPayments,'+
  'custAdvanceRefunds=snapshot.customerAdvanceRefunds,'+
  'supPayments=snapshot.supplierPayments,financeTxns=snapshot.financeTransactions;'+
  'const rows=[];'+
  "function getAllRows_(key) { if (key==='BANK_TRANSFERS') return snapshot.bankTransfers;"+
  "if (key==='BANK_BOOK') return snapshot.bankEntries; throw Error('unexpected '+key); }"+
  'function safeDateOnly_(value) { return value; }\n'+bankCode+
  '\nreturn rows;\n})');
const pure=await import('../src/modules/daybook-bank-dedup.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
const json=x=>JSON.parse(JSON.stringify(x));
const stub=()=>({sales:[],purchases:[],expenses:[],customerPayments:[],
  customerAdvanceRefunds:[],supplierPayments:[],financeTransactions:[],
  bankTransfers:[],bankEntries:[]});
function bank(id,ref='',extra={}){
  return {
    'Entry ID':id,'Reference':ref,'Date':'2026-11-16',
    'Created At':'2026-11-16T11:00:00','Type':'Deposit',
    'Bank Account Name':'Bank A','Description':'Standalone bank posting',
    'Credit':'100.25','Debit':'','Status':'Active',
    'Created By':'ADMIN','Notes':'',...extra
  };
}
function project(snapshot,isAdmin=false,includeDeleted=false){
  assert.equal(typeof pure?.projectDayBookBankRows,'function',
    'M09 Day Book Bank reference deduplication not implemented');
  return pure.projectDayBookBankRows(snapshot,isAdmin,includeDeleted);
}
function parity(snapshot,isAdmin=false,includeDeleted=false){
  const actual=json(project(snapshot,isAdmin,includeDeleted));
  const expected=json(original(json(snapshot),isAdmin && includeDeleted));
  assert.deepEqual(actual,expected,'Full Day Book Bank rows must match frozen GAS source');
  return actual;
}

test('Bank Book document references are suppressed for all source owner types and aliases',()=>{
  const snapshot=stub();
  snapshot.sales=[{'Invoice ID':'S-1'}];
  snapshot.purchases=[{'Purchase ID':'P-1'}];
  snapshot.expenses=[{'Expense ID':'E-1'}];
  snapshot.customerPayments=[{'Ledger ID':'C-1','Customer ID':'CID-1'}];
  snapshot.customerAdvanceRefunds=[{'Ledger ID':'CA-1','Customer ID':'CID-2'}];
  snapshot.supplierPayments=[{'Ledger ID':'SP-1','Supplier ID':'SID-1'}];
  snapshot.financeTransactions=[{'Finance ID':'F-1'}];
  snapshot.bankTransfers=[{'Transfer ID':'T-1'}];
  const hidden=['S-1','P-1','E-1','C-1','CID-1','CA-1','CID-2',
    'SP-1','SID-1','F-1','T-1'];
  snapshot.bankEntries=[
    ...hidden.map((ref,i)=>bank('D-'+i,ref)),
    bank('B-standalone','MISSING'),
    bank('B-blank','')
  ];
  const result=parity(snapshot);
  assert.deepEqual(result.map(r=>r.referenceNo),['B-standalone','B-blank']);
  assert.equal(result.reduce((n,row)=>n+row.bankIn,0),200.5);
  assert.equal(result.every(row=>row.module==='Bank'),true);
});

test('source Bank row preserves original navigation, metadata, time, amount sign and exact field order',()=>{
  const snapshot=stub();
  snapshot.bankEntries=[bank('BB-17','',{'Type':'Withdrawal','Credit':'',
    'Debit':'31.27','Notes':'Cheque','Is Backdated':'Yes',
    'Backdated Days':'2','Backdated Reason':'Previous business date',
    'Bank Account Name':'bKash merchant','Created By':'MGR'})];
  const [row]=parity(snapshot);
  assert.deepEqual(Object.keys(row),Object.keys(json(original(json(snapshot),false)[0])));
  assert.equal(row.referenceNo,'BB-17');
  assert.equal(row.module,'Bank');
  assert.equal(row.transactionType,'Withdrawal');
  assert.equal(row.party,'bKash merchant');
  assert.equal(row.paymentMethod,'Bank');
  assert.equal(row.bankIn,0);
  assert.equal(row.bankOut,31.27);
  assert.equal(row.cashIn,0);
  assert.equal(row.cashOut,0);
  assert.equal(row.amount,-31.27);
  assert.equal(row.openPage,'bank');
  assert.equal(row.openId,'BB-17');
  assert.equal(row.deleteModule,'bank');
  assert.equal(row.deleteId,'BB-17');
  assert.equal(row.sourceModule,'Bank');
  assert.equal(row.sourceId,'BB-17');
  assert.equal(row.isBackdated,true);
  assert.equal(row.backdatedDays,2);
  assert.equal(row.status,'Active');
  assert.equal(row.isDeleted,false);
});

test('mirrored bank reversal retains both legs and nets to zero; unmatched reversed is hidden',()=>{
  const snapshot=stub();
  snapshot.bankEntries=[
    bank('ORIGINAL','',{'Credit':'90','Status':'Reversed'}),
    bank('MIRROR','',{'Credit':'','Debit':'90','Reversal Of':'ORIGINAL'}),
    bank('DELETE-VOID','',{'Credit':'750','Status':'Reversed','Notes':'Correction'}),
    bank('INTEREST','',{'Credit':'5'})
  ];
  const result=parity(snapshot);
  assert.deepEqual(result.map(r=>r.referenceNo),['ORIGINAL','MIRROR','INTEREST']);
  assert.equal(result[0].status,'Reversed');
  assert.equal(result[0].bankIn,90);
  assert.equal(result[1].bankOut,90);
  const totals=projectDayBookWindow(result).totals;
  assert.equal(totals.netBank,5);
  assert.equal(totals.bankIn,95);
  assert.equal(totals.bankOut,90);
});

test('delete-voided reversed row shown only for authenticated Administrator includeDeleted and carries zero money',()=>{
  const snapshot=stub();
  snapshot.bankEntries=[bank('VOID','',{'Credit':'999','Debit':'10',
    'Status':'Reversed','Notes':'Delete reason'})];
  assert.equal(parity(snapshot).length,0);
  assert.equal(parity(snapshot,false,true).length,0);
  assert.equal(parity(snapshot,true,false).length,0);
  const [row]=parity(snapshot,true,true);
  assert.equal(row.status,'Deleted');
  assert.equal(row.isDeleted,true);
  assert.equal(row.deleteReason,'Delete reason');
  assert.equal(row.bankIn,0);
  assert.equal(row.bankOut,0);
  assert.equal(row.amount,0);
  const report=projectDayBookWindow([row],{includeDeleted:true},true);
  assert.equal(report.count,1);
  assert.equal(report.totals.netBank,0);
});

test('blank reference is never suppressed even if source owner IDs are blank; unknown refs remain',()=>{
  const snapshot=stub();
  snapshot.sales=[{'Invoice ID':''}];
  snapshot.bankEntries=[bank('EMPTY',''),bank('NEW','NEW-INDEPENDENT')];
  const result=parity(snapshot);
  assert.deepEqual(result.map(r=>r.referenceNo),['EMPTY','NEW']);
});

test('no owner or reversal match can result from another, incomplete supplied ledger snapshot',()=>{
  const incomplete=stub();
  delete incomplete.bankTransfers;
  assert.throws(()=>project(incomplete),/invalid|missing|array|snapshot|trusted/i);
  const bad=stub();
  bad.bankEntries=[bank('NORMAL')];
  bad.bankTransfers=undefined;
  assert.throws(()=>project(bad),/invalid|missing|array|snapshot|trusted/i);
});

test('reject malformed monetary values, prototype collisions, unsafe dates and user-forged actor switches',()=>{
  const rows=[bank('A')];
  for(const [key,value] of [
    ['Credit',Infinity],['Debit',Number.NaN],['Credit','not-money'],
    ['Date','2026-02-30'],['Reference','__proto__']
  ]){
    const snapshot=stub();
    snapshot.bankEntries=[bank('A','',{[key]:value})];
    assert.throws(()=>project(snapshot),/invalid|unsafe|amount|money|date|reference|finite|trusted/i);
  }
  for(const invalid of [null,[],Object.create({bankEntries:rows}),{
    ...stub(),bankEntries:[Object.defineProperty(bank('A'),'Credit',{
      get(){throw Error('UNSAFE GETTER');},enumerable:true
    })]
  },{...stub(),sales:[{'Invoice ID':{value:'S-1'}}]}]){
    assert.throws(()=>project(invalid),/invalid|unsafe|trusted|accessor|snapshot/i);
  }
  assert.throws(()=>project(stub(),'Administrator',true),/invalid|trusted|boolean|actor|admin/i);
  assert.throws(()=>project(stub(),true,'true'),/invalid|trusted|boolean|actor|admin/i);
});

test('return fresh Bank source rows and do not mutate trusted input arrays or records',()=>{
  const record=Object.freeze(bank('ONE'));
  const snapshot=stub();
  snapshot.bankEntries=Object.freeze([record]);
  const before=json(snapshot);
  const first=parity(snapshot),second=project(snapshot);
  assert.deepEqual(json(snapshot),before);
  assert.notStrictEqual(second[0],record);
  first[0].party='tampered';
  assert.equal(second[0].party,'Bank A');
  assert.equal(snapshot.bankEntries[0]['Bank Account Name'],'Bank A');
});

test('original GAS/UI, frozen public RPC allowlist and DB-free preview remain unchanged',()=>{
  const ui=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.match(ui,/serverCall\('getDayBookTransactions', authToken, filters\)/);
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(preview.d1_databases,undefined);
  assert.equal(typeof pure?.projectDayBookBankRows,'function',
    'M09 Day Book Bank reference deduplication not implemented');
  const code=readFileSync(new URL('../src/modules/daybook-bank-dedup.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:prepare|batch|exec|fetch)\s*\(/);
  assert.doesNotMatch(code,/getDayBookTransactions\s*\(/);
  assert.doesNotMatch(code,/globalThis|CacheService|new Date\(/);
});
