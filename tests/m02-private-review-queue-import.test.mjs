import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,statSync,existsSync,symlinkSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {buildM02PrivateReviewQueue} from '../scripts/dry-run-private-review-queue.mjs';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const cli=new URL('../scripts/dry-run-private-review-queue.mjs',import.meta.url).pathname;
const fixture=()=>({formatVersion:1,sourceCommit:pin,groups:Object.fromEntries(
 schema.tables.map(t=>[t.sheetKey,{headers:[...t.columns],rows:[]}])
)});
function add(src,group,sheetRow,columns){
 const t=src.groups[group];
 t.rows.push({sheetRow,cells:t.headers.map(h=>columns[h]??'')});
 return src;
}
function sample(){
 const x=fixture();
 add(x,'PRODUCT_CATEGORIES',19,{'Category ID':'CAT-000002','Category Name':'Electrical'});
 add(x,'PRODUCT_CATEGORIES',2,{'Category ID':'CAT-000001','Category Name':'Electrical'});
 add(x,'PRODUCT_UNITS',12,{'Unit ID':'UNT-000003','Unit Name':'Box'});
 add(x,'PRODUCT_UNITS',2,{'Unit ID':'UNT-000001','Unit Name':'Box'});
 add(x,'PRODUCT_UNITS',9,{'Unit ID':'UNT-000002','Unit Name':'Box'});
 add(x,'CUSTOMERS',8,{'Customer ID':'CUS-000002','Customer Name':'Synthetic Person','Phone':'01700-000000','Opening Balance':'999.99'});
 add(x,'CUSTOMERS',2,{'Customer ID':'CUS-000001','Customer Name':'Synthetic Person','Phone':'01700-000000'});
 add(x,'SUPPLIERS',9,{'Supplier ID':'SUP-000001','Supplier Name':'Synthetic Person','Phone':'01700-000000'});
 add(x,'EXPENSE_PAYEES',2,{'Payee ID':'PAY-000001','Payee Name':'Synthetic Person','Phone':'01700-000000'});
 add(x,'VENDORS',3,{'Vendor ID':'VEN-000001','Vendor Name':'Person B','Phone':'01700-000000','Current Due':'222.22'});
 return x;
}
const build=x=>buildM02PrivateReviewQueue({schema,pinnedSourceCommit:pin,sourceExport:x});
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});

test('one private artifact shows all original master duplicate row locators, including three-unit cluster',()=>{
 const q=build(sample());
 assert.equal(q.sourceGroups,49);
 assert.equal(q.masterClusters.length,2);
 assert.deepEqual(q.masterClusters,[{sourceGroup:'PRODUCT_CATEGORIES',sheetRows:[2,19],candidateCount:1},
  {sourceGroup:'PRODUCT_UNITS',sheetRows:[2,9,12],candidateCount:2}]);
 for(const k of ['sourceToD1Reconciled','identityConsolidationAuthorized','productionReady'])
  assert.equal(q[k],false,k);
 assert.equal(q.reviewOnly,true);
});

test('one cross-role private cluster contains all physical row locators, without joining legal Parties',()=>{
 const q=build(sample());
 assert.deepEqual(q.partyClusters,[{
  sourceGroups:['CUSTOMERS','EXPENSE_PAYEES','SUPPLIERS'],
  rows:[
   {sourceGroup:'CUSTOMERS',sheetRow:2},
   {sourceGroup:'CUSTOMERS',sheetRow:8},
   {sourceGroup:'EXPENSE_PAYEES',sheetRow:2},
   {sourceGroup:'SUPPLIERS',sheetRow:9}
  ],
  candidatePairCount:5
 }]);
});

test('private artifact includes neither matched names/phones nor unrelated financial/Settings values',()=>{
 const x=sample();
 add(x,'SETTINGS',2,{'Key':'fake-password','Value':'SYNTHETIC_PRIVATE_SETTINGS_96571'});
 const serialized=JSON.stringify(build(x));
 for(const secret of ['Synthetic Person','Electrical','Box','01700-000000','999.99','222.22','SYNTHETIC_PRIVATE_SETTINGS_96571','CUS-000001','SUP-000001'])
  assert.ok(!serialized.includes(secret),'leak '+secret);
});

test('output is stable against source JSON row-array ordering and source group key permutations',()=>{
 const x=sample(),a=build(x),y=structuredClone(x);
 for(const group of Object.values(y.groups))group.rows.reverse();
 y.groups=Object.fromEntries(Object.entries(y.groups).reverse());
 assert.deepEqual(build(y),a);
});

test('exactly one matching Party field does not create review cluster; empty labels excluded',()=>{
 const x=fixture();
 add(x,'CUSTOMERS',2,{'Customer ID':'CUS-000001','Customer Name':'A','Phone':'111'});
 add(x,'SUPPLIERS',2,{'Supplier ID':'SUP-000001','Supplier Name':'A','Phone':'222'});
 add(x,'VENDORS',2,{'Vendor ID':'VEN-000001','Vendor Name':'B','Phone':'111'});
 add(x,'FINANCE_PERSONS',2,{'Person ID':'PER-000001','Person Name':'','Phone':'111'});
 assert.deepEqual(build(x).partyClusters,[]);
});

test('separate clusters per distinct display name or Party pair, without merging them',()=>{
 const x=sample();
 add(x,'PRODUCT_CATEGORIES',21,{'Category ID':'CAT-000003','Category Name':'Plumbing'});
 add(x,'PRODUCT_CATEGORIES',22,{'Category ID':'CAT-000004','Category Name':'Plumbing'});
 add(x,'FINANCE_PERSONS',2,{'Person ID':'PER-000001','Person Name':'Another Person','Phone':'01755-000000'});
 add(x,'VENDORS',12,{'Vendor ID':'VEN-000002','Vendor Name':'Another Person','Phone':'01755-000000'});
 const q=build(x);
 assert.equal(q.masterClusters.length,3);
 assert.equal(q.partyClusters.length,2);
 assert.deepEqual(q.partyClusters[0].sourceGroups,['FINANCE_PERSONS','VENDORS']);
 assert.deepEqual(q.partyClusters[1].sourceGroups,['CUSTOMERS','EXPENSE_PAYEES','SUPPLIERS']);
});

test('frozen source drift, duplicate IDs and malformed physical rows fail before any private result',()=>{
 const x=fixture();delete x.groups.CUSTOMERS;
 assert.throws(()=>build(x),/M02 offline parity rejected/);
 const y=sample();y.groups.PRODUCT_CATEGORIES.rows[1].cells[0]='CAT-000002';
 assert.throws(()=>build(y),/M02 offline parity rejected/);
 const z=sample();z.groups.CUSTOMERS.rows[0].sheetRow=1;
 assert.throws(()=>build(z),/M02 offline parity rejected/);
});

test('successfully writes a 0600 exclusive private queue while stdout stays public-safe',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-private-queue-'));
 try{
  const input=join(dir,'source.json'),output=join(dir,'review.json');
  const x=sample();
  writeFileSync(input,JSON.stringify(x));
  const p=run(input,'--private-output',output);
  assert.equal(p.status,2,p.stderr);
  assert.equal(statSync(output).mode&0o777,0o600);
  const q=JSON.parse(readFileSync(output,'utf8'));
  assert.deepEqual(q.partyClusters,build(x).partyClusters);
  const publicReport=JSON.parse(p.stdout);
  assert.equal(publicReport.humanReviewRequired,true);
  assert.ok(!Object.hasOwn(publicReport,'partyClusters'));
  assert.ok(!Object.hasOwn(publicReport,'masterClusters'));
  for(const hidden of ['Synthetic Person','01700-000000','999.99',output,input,'CUS-000001','sheetRow'])
   assert.ok(!(p.stdout+p.stderr).includes(hidden),'stdout/stderr leaked '+hidden);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('existing destination is never overwritten even if it is a symlink',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-private-queue-'));
 try{
  const input=join(dir,'source.json'),dest=join(dir,'review.json'),target=join(dir,'protected.json');
  writeFileSync(input,JSON.stringify(sample()));writeFileSync(dest,'SENTINEL');
  const existing=run(input,'--private-output',dest);
  assert.equal(existing.status,2);
  assert.equal(readFileSync(dest,'utf8'),'SENTINEL');
  rmSync(dest);writeFileSync(target,'PROTECTED');symlinkSync(target,dest);
  const symlink=run(input,'--private-output',dest);
  assert.equal(symlink.status,2);assert.equal(readFileSync(target,'utf8'),'PROTECTED');
  assert.equal(existsSync(dest),true);
  assert.ok(!(symlink.stdout+symlink.stderr).includes(dest));
  assert.equal(requireTmpLeaks(dir),0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('invalid private source or missing output directory creates no final/partial artifacts and redacts paths',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-private-queue-'));
 try{
  const input=join(dir,'source.json'),dest=join(dir,'review.json');
  const invalid=fixture();delete invalid.groups.PRODUCTS;
  writeFileSync(input,JSON.stringify(invalid));
  const v=run(input,'--private-output',dest);
  assert.equal(v.status,2);assert.equal(existsSync(dest),false);
  assert.equal(requireTmpLeaks(dir),0);
  writeFileSync(input,JSON.stringify(sample()));
  const bad=join(dir,'missing','review.json'),w=run(input,'--private-output',bad);
  assert.equal(w.status,2);
  assert.equal(existsSync(bad),false);
  for(const secret of ['Synthetic Person',bad,input])
   assert.ok(!(v.stdout+v.stderr+w.stdout+w.stderr).includes(secret));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('input symlink, URL and wrong argument count are rejected without private output',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-private-queue-'));
 try{
  const input=join(dir,'source.json'),slink=join(dir,'link.json'),dest=join(dir,'review.json');
  writeFileSync(input,JSON.stringify(sample()));symlinkSync(input,slink);
  assert.equal(run(slink,'--private-output',dest).status,2);
  assert.equal(run('https://invalid.example/source.json','--private-output',dest).status,2);
  assert.equal(run(input,'--private-output').status,2);
  assert.equal(existsSync(dest),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('explicit private destination inside GitHub repo is rejected, not logged',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-private-queue-'));
 try{
  const input=join(dir,'source.json');
  writeFileSync(input,JSON.stringify(sample()));
  const attempted=new URL('../.git/m02-private-candidate-export.json',import.meta.url).pathname;
  const p=run(input,'--private-output',attempted);
  assert.equal(p.status,2);
  assert.ok(!(p.stdout+p.stderr).includes(attempted));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

function requireTmpLeaks(dir){
 const {readdirSync}=requireFs();
 return readdirSync(dir).filter(s=>s.includes('.m02-private-')).length;
}
function requireFs(){return {readdirSync:fsReaddirSync};}
import {readdirSync as fsReaddirSync} from 'node:fs';
