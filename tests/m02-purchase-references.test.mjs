import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {reviewM02PurchaseReferences} from '../scripts/dry-run-purchase-references.mjs';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/m02-source-parity.synthetic.json',import.meta.url),'utf8'));
const cli=new URL('../scripts/dry-run-purchase-references.mjs',import.meta.url).pathname;

function exportFixture(){
 const groups=Object.fromEntries(schema.tables.map(t=>[
  t.sheetKey,{headers:[...t.columns],rows:[]}
 ]));
 for(const entry of fixture.rows){
  const group=groups[entry.group];
  assert.ok(group,'synthetic fixture group absent');
  group.rows.push({
   sheetRow:entry.sheetRow,
   cells:group.headers.map(h=>Object.hasOwn(entry.values,h)?entry.values[h]:'')
  });
 }
 return {formatVersion:1,sourceCommit:pin,groups};
}
function setCell(data,group,column,value,row=0){
 const table=data.groups[group];
 const col=table.headers.indexOf(column);
 assert.ok(col>=0,'frozen column missing');
 table.rows[row].cells[col]=value;
}
function review(data=exportFixture()){
 return reviewM02PurchaseReferences({schema,pinnedSourceCommit:pin,sourceExport:data});
}
function codes(out){return out.issues.map(x=>x.code);}
function count(out,code){
 const issue=out.issues.find(x=>x.code===code);
 return issue?.count??0;
}
function run(...paths){return spawnSync(process.execPath,[cli,...paths],{encoding:'utf8'});}

test('pinned 49-group synthetic purchase chain passes as an offline candidate, not a D1 approval',()=>{
 const r=review();
 assert.equal(r.formatVersion,1);
 assert.equal(r.sourceCommit,pin);
 assert.equal(r.sourceGroups,49);
 assert.deepEqual(r.totals,{purchases:1,purchaseItems:2,suppliers:1,products:1});
 assert.equal(r.candidateReady,true);
 assert.deepEqual(r.issues,[]);
 for(const flag of ['independentSourceExportVerified','d1ReadbackVerified',
  'sourceToD1Reconciled','supplierRoleReviewed','postingAuthorized','productionReady'])
  assert.equal(r[flag],false,flag);
 // Historical amounts in this source-shaped fixture do not add up.
 // This identity-only gate must never silently certify their money.
 assert.equal(Object.hasOwn(r,'moneyReconciled'),false);
});

test('purchase header refers to exact Supplier ID, not matching name or phone',()=>{
 const data=exportFixture();
 setCell(data,'PURCHASES','Supplier ID','000-S1 ');
 assert.equal(count(review(data),'PURCHASE_SUPPLIER_NOT_FOUND'),1);
 setCell(data,'PURCHASES','Supplier ID','');
 assert.equal(count(review(data),'PURCHASE_SUPPLIER_ID_BLANK'),1);
});

test('purchase items preserve distinct original rows and require real purchase and product IDs',()=>{
 const data=exportFixture();
 assert.equal(data.groups.PURCHASE_ITEMS.rows.length,2);
 assert.equal(review(data).candidateReady,true,'two distinct historical item rows must not be deduplicated');
 setCell(data,'PURCHASE_ITEMS','Purchase ID','PUR-NOT-FOUND');
 setCell(data,'PURCHASE_ITEMS','Product ID','PRODUCT-NOT-FOUND','1');
});

test('orphan item references are counted, not repaired by row order',()=>{
 const data=exportFixture();
 setCell(data,'PURCHASE_ITEMS','Purchase ID','PUR-NOT-FOUND',0);
 setCell(data,'PURCHASE_ITEMS','Product ID','PRODUCT-NOT-FOUND',1);
 const r=review(data);
 assert.equal(r.candidateReady,false);
 assert.equal(count(r,'PURCHASE_ITEM_PARENT_NOT_FOUND'),1);
 assert.equal(count(r,'PURCHASE_ITEM_PRODUCT_NOT_FOUND'),1);
 assert.equal(r.issues.every(i=>Number.isSafeInteger(i.count)&&i.count>0),true);
});

test('blank item keys cannot accidentally bind by position',()=>{
 const data=exportFixture();
 setCell(data,'PURCHASE_ITEMS','Purchase ID','',0);
 setCell(data,'PURCHASE_ITEMS','Product ID','',1);
 const r=review(data);
 assert.equal(count(r,'PURCHASE_ITEM_PARENT_ID_BLANK'),1);
 assert.equal(count(r,'PURCHASE_ITEM_PRODUCT_ID_BLANK'),1);
});

test('each purchase must retain at least one source item for review',()=>{
 const data=exportFixture();
 data.groups.PURCHASE_ITEMS.rows=[];
 const r=review(data);
 assert.equal(count(r,'PURCHASE_WITHOUT_ITEMS'),1);
 assert.equal(r.candidateReady,false);
});

test('a missing master Product creates two explicit child-reference discrepancies',()=>{
 const data=exportFixture();
 data.groups.PRODUCTS.rows=[];
 assert.equal(count(review(data),'PURCHASE_ITEM_PRODUCT_NOT_FOUND'),2);
});

test('historically deleted master records retain identity and are never silently dropped',()=>{
 const data=exportFixture();
 setCell(data,'SUPPLIERS','Is Deleted','TRUE');
 setCell(data,'PRODUCTS','Is Deleted','TRUE');
 assert.equal(review(data).candidateReady,true);
});

test('transport row order does not change source identity or reported issues',()=>{
 const data=exportFixture();
 const before=review(data);
 data.groups.PURCHASE_ITEMS.rows.reverse();
 data.groups.PURCHASES.rows.reverse();
 assert.deepEqual(review(data),before);
});

test('source schema/pin, exact text cells, and physical row provenance fail closed',()=>{
 const missing=exportFixture();
 delete missing.groups.SUPPLIERS;
 assert.throws(()=>review(missing),/offline parity rejected/i);
 const wrongPin=exportFixture();
 wrongPin.sourceCommit='f'.repeat(40);
 assert.throws(()=>review(wrongPin),/offline parity rejected/i);
 const invalidRow=exportFixture();
 invalidRow.groups.PURCHASE_ITEMS.rows[0].sheetRow=1;
 assert.throws(()=>review(invalidRow),/offline parity rejected/i);
 const badCell=exportFixture();
 setCell(badCell,'PURCHASE_ITEMS','Product ID',12);
 assert.throws(()=>review(badCell),/offline parity rejected/i);
});

test('private source values, IDs, amounts and row indexes never appear in result',()=>{
 const data=exportFixture();
 setCell(data,'PURCHASE_ITEMS','Product ID','PRIVATE-01700000000',0);
 setCell(data,'PURCHASES','Supplier ID','SENSITIVE-SUPPLIER-ID',0);
 const out=JSON.stringify(review(data));
 assert.doesNotMatch(out,/PRIVATE|01700000000|SENSITIVE|000P-001|000-S1|PUR-001|0120\.500|sheetRow/i);
});

test('read-only checks do not modify the supplied export',()=>{
 const data=exportFixture();
 const before=structuredClone(data);
 review(data);
 assert.deepEqual(data,before);
});

test('CLI accepts one bounded local JSON input, emits redacted errors, fails on orphan or unsafe path',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-purchase-references-'));
 try{
  const file=join(dir,'private-source.json');
  writeFileSync(file,JSON.stringify(exportFixture()));
  const ok=run(file);
  assert.equal(ok.status,0,ok.stderr);
  assert.equal(JSON.parse(ok.stdout).candidateReady,true);
  const orphan=exportFixture();
  setCell(orphan,'PURCHASES','Supplier ID','SENSITIVE-MISSING-01700000000');
  writeFileSync(file,JSON.stringify(orphan));
  const bad=run(file);
  assert.equal(bad.status,2);
  assert.equal(count(JSON.parse(bad.stdout),'PURCHASE_SUPPLIER_NOT_FOUND'),1);
  assert.doesNotMatch(bad.stdout+bad.stderr,/SENSITIVE|01700000000|private-source\.json/);
  const remote=run('https://example.invalid/secret.json');
  assert.equal(remote.status,2);
  assert.doesNotMatch(remote.stdout+remote.stderr,/example\.invalid|secret\.json/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
