import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {CANONICAL_PRODUCT_HEADERS,SUPPLEMENTARY_PRODUCT_HEADERS,SUPPLEMENTARY_CONVERSION_HEADERS} from '../src/db/product-source-contract.js';
import {prepareProductD1Snapshot,importProductD1Snapshot} from '../src/db/product-d1-snapshot-import.js';

const keyed=(headers,values={})=>headers.map(h=>Object.hasOwn(values,h)?values[h]:'');
const canonical=(id,over={})=>keyed(CANONICAL_PRODUCT_HEADERS,{
 'Product ID':id,'Product Name':'তার','Unit':'Gira','Barcode':'00123',
 'Purchase Price':'4.375','Selling Price':'25.000','Current Stock':'37.000',
 'Product Type':'Bundle','Bundle Revision':'002',...over
});
const supplementary=(id,over={})=>keyed(SUPPLEMENTARY_PRODUCT_HEADERS,{
 'Product ID':id,'Product Name':'তার','Unit':'Gira','Barcode':'00123',
 'Purchase Price':'4.375','Selling Price':'25.000',
 'Purchase Price Unit':'Gauge','Selling Price Unit':'Gira','Stock View Unit':'Gauge',...over
});
const conversion=(id,productId,over={})=>keyed(SUPPLEMENTARY_CONVERSION_HEADERS,{
 'Conversion ID':id,'Product ID':productId,'Unit Name':'Gauge',
 'Conversion Factor':'16.000','Relation Qty':'16','Relation Unit Name':'Gira',
 'Purchase Price':'70.000','Selling Price':'400.00','Sort Order':'1','Status':'Active',...over
});
const canonicalExport=()=>({headers:[...CANONICAL_PRODUCT_HEADERS],rows:[canonical('P-0001'),canonical('P-0002')]});
const supplementaryExport=()=>({headers:[...SUPPLEMENTARY_PRODUCT_HEADERS],rows:[supplementary('P-0001')]});
const conversionExport=()=>({headers:[...SUPPLEMENTARY_CONVERSION_HEADERS],rows:[conversion('CON-001','P-0001')]});

test('0012 source snapshots retain canonical product IDs, separate names, barcodes and financial text',()=>{
 const source=canonicalExport(),clone=structuredClone(source);
 const plan=prepareProductD1Snapshot({profile:'canonical',productExport:source});
 assert.equal(plan.profile,'canonical');
 assert.equal(plan.products.length,2);
 assert.deepEqual(plan.products.map(x=>[x.source_profile,x.legacy_sheet_row,x.product_id]),
  [['canonical',2,'P-0001'],['canonical',3,'P-0002']]);
 assert.equal(plan.products[0].barcode_text,'00123');
 assert.equal(plan.products[0].purchase_price_text,'4.375');
 assert.equal(plan.products[0].current_stock_text,'37.000');
 assert.equal(plan.products[0].product_type_text,'Bundle');
 assert.equal(plan.products[0].bundle_revision_text,'002');
 assert.deepEqual(plan.conversions,[]);
 assert.deepEqual(source,clone);
});
test('older source requires explicit review and preserves distinct conversion/price snapshot',()=>{
 assert.throws(()=>prepareProductD1Snapshot({profile:'supplementary',
   productExport:supplementaryExport(),conversionExport:conversionExport()}),/review/i);
 const plan=prepareProductD1Snapshot({profile:'supplementary',explicitSupplementaryReview:true,
   productExport:supplementaryExport(),conversionExport:conversionExport()});
 assert.equal(plan.products[0].source_profile,'supplementary');
 assert.equal(plan.products[0].product_type_text,'');
 assert.equal(plan.products[0].purchase_price_unit_text,'Gauge');
 assert.equal(plan.products[0].stock_view_unit_text,'Gauge');
 assert.deepEqual(plan.conversions.map(x=>[x.legacy_sheet_row,x.conversion_id,x.product_id,x.factor_text,x.purchase_price_text]),
   [[2,'CON-001','P-0001','16.000','70.000']]);
});
test('wrong source profile, misplaced conversion, unknown reference and bad source row fail before D1',()=>{
 assert.throws(()=>prepareProductD1Snapshot({profile:'canonical',productExport:supplementaryExport()}),/header|profile/i);
 assert.throws(()=>prepareProductD1Snapshot({profile:'canonical',productExport:canonicalExport(),
   conversionExport:conversionExport()}),/canonical|conversion/i);
 assert.throws(()=>prepareProductD1Snapshot({profile:'supplementary',explicitSupplementaryReview:true,
   productExport:supplementaryExport(),conversionExport:{headers:SUPPLEMENTARY_CONVERSION_HEADERS,
     rows:[conversion('CON-1','P-UNREVIEWED')]}}),/approved|Product ID/i);
 assert.throws(()=>prepareProductD1Snapshot({profile:'supplementary',explicitSupplementaryReview:true,
   productExport:supplementaryExport(),conversionExport:{headers:SUPPLEMENTARY_CONVERSION_HEADERS,
     rows:[conversion('CON-1','P-0001'),conversion('CON-1','P-0001')]}}),/duplicate/i);
 const tooMany=canonicalExport();tooMany.rows=Array.from({length:1001},(_,i)=>canonical('P'+i));
 assert.throws(()=>prepareProductD1Snapshot({profile:'canonical',productExport:tooMany}),/1000|bound/i);
});
test('0012 schema applies with original-ID uniqueness, separate source profiles, strict text and immutable guards',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(readFileSync(new URL('../migrations/0012_legacy_product_snapshots.sql',import.meta.url),'utf8'));
  for(const table of ['legacy_product_snapshots','legacy_product_unit_conversion_snapshots'])
   assert.equal(db.prepare("PRAGMA table_list('"+table+"')").get().strict,1);
  const insert=db.prepare("INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id) VALUES (?,?,?)");
  insert.run('canonical',2,'P-1');
  insert.run('supplementary',2,'P-1');
  assert.throws(()=>insert.run('canonical',3,'P-1'),/unique/i);
  assert.throws(()=>insert.run('canonical',2,'P-2'),/unique/i);
  assert.throws(()=>insert.run('bad',4,'P-3'),/check/i);
  assert.throws(()=>insert.run('canonical',1,'P-3'),/check/i);
  const conv=db.prepare("INSERT INTO legacy_product_unit_conversion_snapshots(source_profile,legacy_sheet_row,conversion_id,product_id,unit_name) VALUES (?,?,?,?,?)");
  conv.run('supplementary',2,'CON-1','P-1','Gauge');
  assert.throws(()=>conv.run('supplementary',3,'CON-2','NO-PRODUCT','Gauge'),/foreign key/i);
  assert.throws(()=>conv.run('canonical',3,'CON-2','P-1','Gauge'),/check/i);
  assert.throws(()=>conv.run('supplementary',3,'CON-2','P-1','gauge'),/unique/i);
  assert.throws(()=>db.prepare("UPDATE legacy_product_snapshots SET barcode_text='forged'").run(),/immutable/i);
  assert.throws(()=>db.prepare('DELETE FROM legacy_product_snapshots').run(),/immutable/i);
  assert.throws(()=>db.prepare('DELETE FROM legacy_product_unit_conversion_snapshots').run(),/immutable/i);
 }finally{db.close();}
});
test('postcommit incomplete readback fails with NEEDS_REVIEW not false rollback',async()=>{
 const source=canonicalExport();
 const fake={
  prepare(sql){return {bind(){return {all:async()=>({success:true,results:[]})}}}},
  batch:async x=>x.map(()=>({success:true}))
 };
 await assert.rejects(()=>importProductD1Snapshot({DB:fake,profile:'canonical',
   productExport:source}),/NEEDS_REVIEW/);
});
