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
 // The shared parity fixture intentionally omits optional historical lot fields.
 // This suite supplies a verified synthetic Purchase origin for reference tests.
 const lot=groups.STOCK_LOTS;
 if(lot.rows.length){
  lot.rows[0].cells[lot.headers.indexOf('Purchase ID')]='PUR-001';
  lot.rows[0].cells[lot.headers.indexOf('Supplier ID')]='000-S1';
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

test('purchase items preserve two distinct original physical rows without automatic deduplication',()=>{
 const data=exportFixture();
 assert.equal(data.groups.PURCHASE_ITEMS.rows.length,2);
 assert.deepEqual(data.groups.PURCHASE_ITEMS.rows.map(x=>x.sheetRow),[2,3]);
 assert.equal(review(data).candidateReady,true,'two distinct historical item rows must not be deduplicated');
 assert.equal(review(data).totals.purchaseItems,2);
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


function appendRow(data,group,values,sheetRow){
 const table=data.groups[group];
 assert.ok(table,'source group missing');
 for(const column of Object.keys(values))assert.ok(table.headers.includes(column),column);
 table.rows.push({
  sheetRow,
  cells:table.headers.map(h=>Object.hasOwn(values,h)?values[h]:'')
 });
}

function withReturn(){
 const data=exportFixture();
 appendRow(data,'PURCHASE_RETURN',{
  'Return ID':'RET-001','Purchase ID':'PUR-001',
  'Supplier ID':'000-S1','Refund Method':'Supplier Credit',
  'Is Deleted':'TRUE'
 },2);
 appendRow(data,'PURCHASE_RETURN_ITEMS',{
  'Return ID':'RET-001','Purchase ID':'PUR-001',
  'Product ID':'000P-001','Return Quantity':'1.00'
 },2);
 return data;
}

test('valid historical Purchase Return header and line join by exact source IDs, even if deleted',()=>{
 const report=review(withReturn());
 assert.equal(report.candidateReady,true);
 assert.deepEqual(report.issues,[]);
 assert.equal(report.totals.purchaseReturns,1);
 assert.equal(report.totals.purchaseReturnItems,1);
 assert.equal(report.totals.stockLots,1);
});

test('a 49-group snapshot with no returns and no lots is a valid empty historical candidate',()=>{
 const data=exportFixture();
 data.groups.STOCK_LOTS.rows=[];
 data.groups.PURCHASE_RETURN.rows=[];
 data.groups.PURCHASE_RETURN_ITEMS.rows=[];
 const r=review(data);
 assert.equal(r.candidateReady,true);
 assert.deepEqual(r.issues,[]);
 assert.deepEqual({purchaseReturns:r.totals.purchaseReturns,stockLots:r.totals.stockLots},
  {purchaseReturns:0,stockLots:0});
});

test('missing or blank Return purchase link is blocked without inferring Supplier by name',()=>{
 const data=withReturn();
 setCell(data,'PURCHASE_RETURN','Purchase ID','PUR-UNKNOWN');
 assert.equal(count(review(data),'PURCHASE_RETURN_PARENT_NOT_FOUND'),1);
 setCell(data,'PURCHASE_RETURN','Purchase ID','');
 assert.equal(count(review(data),'PURCHASE_RETURN_PARENT_ID_BLANK'),1);
});

test('Return header Supplier must match the original Purchase Supplier ID',()=>{
 const data=withReturn();
 setCell(data,'PURCHASE_RETURN','Supplier ID','000-S1 ');
 assert.equal(count(review(data),'PURCHASE_RETURN_SUPPLIER_MISMATCH'),1);
 setCell(data,'PURCHASE_RETURN','Supplier ID','');
 assert.equal(count(review(data),'PURCHASE_RETURN_SUPPLIER_ID_BLANK'),1);
});

test('Return item requires an actual header and matching Purchase ID',()=>{
 const data=withReturn();
 setCell(data,'PURCHASE_RETURN_ITEMS','Return ID','RET-GHOST');
 assert.equal(count(review(data),'PURCHASE_RETURN_ITEM_PARENT_NOT_FOUND'),1);
 setCell(data,'PURCHASE_RETURN_ITEMS','Return ID','');
 assert.equal(count(review(data),'PURCHASE_RETURN_ITEM_PARENT_ID_BLANK'),1);
 setCell(data,'PURCHASE_RETURN_ITEMS','Return ID','RET-001');
 setCell(data,'PURCHASE_RETURN_ITEMS','Purchase ID','PUR-OTHER');
 assert.equal(count(review(data),'PURCHASE_RETURN_ITEM_PURCHASE_MISMATCH'),1);
 setCell(data,'PURCHASE_RETURN_ITEMS','Purchase ID','');
 assert.equal(count(review(data),'PURCHASE_RETURN_ITEM_PURCHASE_ID_BLANK'),1);
});

test('Return Product must be on the original Purchase even if it exists in catalog',()=>{
 const data=withReturn();
 appendRow(data,'PRODUCTS',{'Product ID':'000P-OTHER','Product Name':'other'},22);
 setCell(data,'PURCHASE_RETURN_ITEMS','Product ID','000P-OTHER');
 assert.equal(count(review(data),'PURCHASE_RETURN_ITEM_NOT_PURCHASED'),1);
 setCell(data,'PURCHASE_RETURN_ITEMS','Product ID','');
 assert.equal(count(review(data),'PURCHASE_RETURN_ITEM_PRODUCT_ID_BLANK'),1);
});

test('every Return header must have at least one source line; duplicate historical lines stay distinct',()=>{
 const data=withReturn();
 appendRow(data,'PURCHASE_RETURN_ITEMS',{
  'Return ID':'RET-001','Purchase ID':'PUR-001','Product ID':'000P-001'
 },3);
 assert.equal(review(data).candidateReady,true,'valid duplicate product lines must retain distinct rows');
 data.groups.PURCHASE_RETURN_ITEMS.rows=[];
 assert.equal(count(review(data),'PURCHASE_RETURN_WITHOUT_ITEMS'),1);
});

test('real Purchase-origin Stock Lot requires Product and exact Purchase line',()=>{
 const data=exportFixture();
 assert.equal(review(data).candidateReady,true);
 setCell(data,'STOCK_LOTS','Product ID','');
 assert.equal(count(review(data),'LOT_PRODUCT_ID_BLANK'),1);
 setCell(data,'STOCK_LOTS','Product ID','P-MISSING');
 assert.equal(count(review(data),'LOT_PRODUCT_NOT_FOUND'),1);
 appendRow(data,'PRODUCTS',{'Product ID':'P-MISSING'},19);
 assert.equal(count(review(data),'LOT_PURCHASE_PRODUCT_NOT_IN_ITEMS'),1);
});

test('Purchase-origin Stock Lot must retain Supplier authority and cannot join by name',()=>{
 const data=exportFixture();
 setCell(data,'STOCK_LOTS','Supplier ID','000-S1 ');
 assert.equal(count(review(data),'LOT_PURCHASE_SUPPLIER_MISMATCH'),1);
 setCell(data,'STOCK_LOTS','Supplier ID','');
 assert.equal(count(review(data),'LOT_PURCHASE_SUPPLIER_ID_BLANK'),1);
});

test('missing source Lot origin is review-only, never automatically attached to latest Purchase',()=>{
 const data=exportFixture();
 setCell(data,'STOCK_LOTS','Purchase ID','PUR-GHOST');
 assert.equal(count(review(data),'LOT_ORIGIN_UNREVIEWED'),1);
 setCell(data,'STOCK_LOTS','Purchase ID','');
 assert.equal(count(review(data),'LOT_ORIGIN_BLANK'),1);
});

test('Stock Lot valid non-Purchase origins from frozen source are not falsely treated as purchases',()=>{
 const data=exportFixture();
 for(const origin of ['OPENING','OPENING-MIGRATION','OPENING-2025',
  'ADJUSTMENT','ADJUSTMENT-2','LEGACY','OVERSOLD',
  'VENDOR-RETURN-RECEIVED','RETURN']){
  setCell(data,'STOCK_LOTS','Purchase ID',origin);
  assert.equal(review(data).candidateReady,true,origin);
 }
 // Original Sale Return fallback lot can carry its own Return ID.
 appendRow(data,'SALES_RETURN',{'Return ID':'SRET-001'},6);
 setCell(data,'STOCK_LOTS','Purchase ID','SRET-001');
 assert.equal(review(data).candidateReady,true);
});

test('orphaned Return or Lot errors remain invariant to transport order and do not mutate input',()=>{
 const data=withReturn(),before=structuredClone(data);
 setCell(data,'PURCHASE_RETURN_ITEMS','Product ID','NOT-PURCHASED');
 setCell(data,'STOCK_LOTS','Purchase ID','PUR-LOST');
 const expected=review(data);
 data.groups.PURCHASE_ITEMS.rows.reverse();
 data.groups.PURCHASE_RETURN_ITEMS.rows.reverse();
 assert.deepEqual(review(data),expected);
 assert.deepEqual(before.groups.PURCHASES,data.groups.PURCHASES);
});

test('new lineage report leaks no Supplier, Return, Product, ID, phone or source row values',()=>{
 const data=withReturn();
 setCell(data,'PURCHASE_RETURN','Supplier ID','PRIVATE-01711111111');
 setCell(data,'STOCK_LOTS','Purchase ID','SECRET-LOT-RETURN-777');
 const out=JSON.stringify(review(data));
 assert.doesNotMatch(out,/PRIVATE|01711111111|SECRET|RET-001|PUR-001|LOT-001|000-S1|000P-001|sheetRow|Is Deleted/);
});

test('lineage errors fail CLI with a generic redacted report and do not approve D1 migration',()=>{
 const data=withReturn();
 const dir=mkdtempSync(join(tmpdir(),'m02-return-lineage-'));
 try{
  const file=join(dir,'private-sensitive-source.json');
  setCell(data,'PURCHASE_RETURN','Supplier ID','PRIVATE-01722222222');
  writeFileSync(file,JSON.stringify(data));
  const result=run(file);
  assert.equal(result.status,2);
  assert.equal(count(JSON.parse(result.stdout),'PURCHASE_RETURN_SUPPLIER_MISMATCH'),1);
  assert.doesNotMatch(result.stdout+result.stderr,/PRIVATE|01722222222|private-sensitive-source/);
  for(const flag of ['d1ReadbackVerified','sourceToD1Reconciled','postingAuthorized','productionReady'])
   assert.equal(JSON.parse(result.stdout)[flag],false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
