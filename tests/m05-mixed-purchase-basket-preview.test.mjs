import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {previewMixedPurchaseBasketD1} from '../src/modules/m05-mixed-purchase-basket-preview.js';
import {insertSql,row,values} from './fixtures/m02-tile-measurement-rows.mjs';

const products=[
  {'Product ID':'P-CABLE','Product Name':'Cable','Product Type':'Standard',
   Unit:'Pcs','Purchase Price':6,'Selling Price':10,'Current Stock':5,_rowIndex:8},
  {'Product ID':'P-PIPE','Product Name':'Pipe','Product Type':'Standard',
   Unit:'Feet','Purchase Price':7,'Selling Price':12,'Current Stock':-3,_rowIndex:9}
];
const suppliers=[{'Supplier ID':'SUP-A','Supplier Name':'Supplier A',Status:'Active'},
  {'Supplier ID':'SUP-OFF','Supplier Name':'Supplier Off',Status:'Inactive'}];
const conversionRows=[
  {'Conversion ID':'C-BAG','Product ID':'P-CABLE','Unit Name':'Bag',
   'Conversion Factor':100,'Purchase Price':500,Status:'Active','Sort Order':1},
  {'Conversion ID':'C-BOX','Product ID':'P-CABLE','Unit Name':'Box',
   'Conversion Factor':20,'Purchase Price':100,Status:'Active','Sort Order':2}
];
const cable=(patch={})=>({productId:'P-CABLE',name:'Client changed label',
 qty:145,unitPrice:0.01,sellingPrice:10,
 unitBreakdown:[{conversionId:'C-BAG',qty:1},{conversionId:'C-BOX',qty:2},
 {conversionId:'BASE',qty:5}],...patch});
const pipe=(patch={})=>({productId:'P-PIPE',name:'Pipe',qty:2,
 unitPrice:9,sellingPrice:12,...patch});
const source=(patch={})=>({payload:{supplierId:'SUP-A',items:[cable(),pipe()]},
 products,suppliers,conversionRows,...patch});
const pack=(boxes='2',extraPieces='3')=>({mode:'pack',boxes,extraPieces});
const area=(requestedSqft='35.50',fulfillment='loose')=>
  ({mode:'area',requestedSqft,fulfillment});
const tiles=()=>[
 {productId:'T-8X12-A',request:pack()},
 {productId:'T-8X12-B',request:area()}
];
function sqlite(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 const dir=new URL('../migrations/',import.meta.url);
 for(const file of readdirSync(dir).filter(f=>/^\d{4}_.+\.sql$/u.test(f)).sort())
  db.exec(readFileSync(new URL(file,dir),'utf8'));
 return db;
}
function d1(db){
 const audit={reads:0,writes:0};
 return {audit,DB:{prepare(sql){
  if(!/^\s*SELECT\s/iu.test(sql)){audit.writes++;throw Error('Read-only D1 fixture');}
  audit.reads++;
  return {bind(...args){return {
   async first(){return db.prepare(sql).get(...args)??null;},
   async all(){return {success:true,results:db.prepare(sql).all(...args)};}
  };}};
 }}};
}
function seed(db,id,{price='',anchor='',override='',packOverride='',
  pricingUnit='Sqft',sqftPrice='38.00',manufacturer=false}={}){
 db.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name,purchase_price_text) VALUES(?,'new','Synthetic tile','Pcs',?)").run(id,price);
 db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name,stock_purchase_override_text) VALUES(?,1,'Pcs',?,?)").run(id,anchor,override);
 db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,purchase_price_override_text) VALUES(?,1,'CTN','Carton','25.000',?)").run(id,packOverride);
 db.prepare(insertSql).run(...values(row(id,{
   purchase_pricing_unit:pricingUnit,purchase_sqft_price_override_text:sqftPrice,
   ...(manufacturer?{
     coverage_policy:'manufacturer',
     manufacturer_sqft_per_box_text:'16.668',
     manufacturer_evidence_ref:'synthetic-verified-label'
   }:{})
 })));
 db.prepare('UPDATE products SET current_unit_revision=1 WHERE product_id=?').run(id);
}
const quote=(DB,patch={})=>previewMixedPurchaseBasketD1({
 DB,standard:source(),tileLines:tiles(),...patch
});

test('one source purchase with Cable, Pipe and two Tiles products conserves all four physical quantities and exact paisa totals',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');seed(db,'T-8X12-B');const {DB,audit}=d1(db);
  const snapshot=structuredClone({ordinary:source(),tiles:tiles()});
  const result=await quote(DB,{discountMinorText:'1067',paidMinorText:'120000'});
  assert.equal(result.mode,'read-only-mixed-purchase-basket-preview');
  assert.equal(result.currency,'BDT');
  assert.equal(result.sourceSupplierId,'SUP-A');
  assert.equal(result.sourceSupplierName,'Supplier A');
  assert.deepEqual(result.standardLines.map(x=>x.productId),['P-CABLE','P-PIPE']);
  assert.deepEqual(result.standardLines.map(x=>x.baseQty),[145,2]);
  assert.deepEqual(result.standardLines.map(x=>x.lineAmountMinor),['73000','1800']);
  assert.equal(result.standardLines[0].unitSnapshot[0].factor,100);
  assert.equal(result.standardLines[0].pricingSnapshot[0].unitPrice,500);
  assert.equal(result.standardLines[0].editableLegacyPrice,false);
  assert.equal(result.standardLines[1].editableLegacyPrice,true);
  assert.equal(Object.hasOwn(result.standardLines[1],'unitSnapshot'),false);
  assert.deepEqual(result.tileLines.map(x=>x.productId),['T-8X12-A','T-8X12-B']);
  assert.deepEqual(result.tileLines.map(x=>x.receivedPcs),['53','54']);
  assert.deepEqual(result.tileLines.map(x=>x.lineAmountMinor),['134267','136800']);
  assert.deepEqual(result.tileLines[0].actualSqft,{numerator:'106',denominator:'3'});
  assert.deepEqual(result.tileLines[1].actualSqft,{numerator:'36',denominator:'1'});
  assert.deepEqual(result.totals,{
    subtotalMinor:'345867',requestedDiscountMinor:'1067',appliedDiscountMinor:'1067',
    grandTotalMinor:'344800',paidMinor:'120000',dueMinor:'224800',
    paymentStatus:'Partial'
  });
  assert.equal(result.supplierReviewRequired,true);
  assert.equal(result.paymentReviewRequired,true);
  assert.equal(result.postingAllowed,false);
  assert.equal(result.sourceCatalogAuthority,'snapshot-only');
  assert.equal(result.tileStockAuthority,'not-loaded');
  assert.ok(result.standardLines.every(x=>x.postingAllowed===false));
  assert.ok(result.tileLines.every(x=>x.postingAllowed===false));
  assert.equal(audit.writes,0);assert.ok(audit.reads>=8);
  assert.deepEqual({ordinary:source(),tiles:tiles()},snapshot);
 }finally{db.close();}
});

test('manufacturer area keeps evidenced 300.024 Sqft distinct from physical nominal 300, not re-priced using display',async()=>{
 const db=sqlite();try{
  seed(db,'T-MFR',{manufacturer:true});const {DB}=d1(db);
  const r=await quote(DB,{tileLines:[{productId:'T-MFR',request:pack('18','0')}]});
  assert.equal(r.tileLines[0].receivedPcs,'450');
  assert.deepEqual(r.tileLines[0].actualSqft,{numerator:'37503',denominator:'125'});
  assert.deepEqual(r.tileLines[0].nominalSqft,{numerator:'300',denominator:'1'});
  assert.equal(r.tileLines[0].measurementSnapshot.manufacturerEvidence,'synthetic-verified-label');
  assert.equal(r.tileLines[0].lineAmountMinor,'1140091');
  assert.equal(r.totals.subtotalMinor,'1214891');
 }finally{db.close();}
});

test('trusted source conversions beat spoofed browser price/factor/label; accepted original legacy editable price stays explicit',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB}=d1(db);
  const spoof=cable({name:'Fake cable',unitPrice:0.01,unitBreakdown:[
   {conversionId:'C-BAG',qty:1,factor:1,unitPrice:1,unitName:'Fake'}]});
  const s=source({payload:{supplierId:'SUP-A',items:[spoof,pipe({unitPrice:9.75})]}});
  const r=await quote(DB,{standard:s,tileLines:[tiles()[0]]});
  assert.equal(r.standardLines[0].baseQty,100);
  assert.equal(r.standardLines[0].lineAmountMinor,'50000');
  assert.equal(r.standardLines[0].name,'Cable');
  assert.equal(r.standardLines[0].pricingSnapshot[0].unitPrice,500);
  assert.equal(r.standardLines[1].lineAmountMinor,'1950');
  assert.equal(r.standardLines[1].editableLegacyPrice,true);
  assert.equal(r.totals.subtotalMinor,'186217');
 }finally{db.close();}
});

test('two source families never merge a duplicate Product ID, and reject it before reading D1',async()=>{
 const db=sqlite();try{
  seed(db,'P-CABLE');const {DB,audit}=d1(db);
  await assert.rejects(()=>quote(DB,{tileLines:[
   {productId:'P-CABLE',request:pack()}
  ]}),/duplicate.*product/i);
  assert.equal(audit.reads,0);
 }finally{db.close();}
});

test('duplicated original supplier identity and inactive or missing supplier fail before D1',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB,audit}=d1(db);
  await assert.rejects(()=>quote(DB,{standard:source({
    suppliers:[...suppliers,{...suppliers[0]}]})}),/duplicate.*supplier/i);
  await assert.rejects(()=>quote(DB,{standard:source({
    payload:{supplierId:'SUP-OFF',items:[cable(),pipe()]}})}),/supplier.*inactive/i);
  await assert.rejects(()=>quote(DB,{standard:source({
    payload:{supplierId:'MISSING',items:[cable(),pipe()]}})}),/supplier/i);
  assert.equal(audit.reads,0);
 }finally{db.close();}
});

test('invalid or duplicate source unit conversion fails before any current Tiles pricing',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB,audit}=d1(db);
  await assert.rejects(()=>quote(DB,{standard:source({
    conversionRows:[...conversionRows,{...conversionRows[0]}]})}),/duplicate.*conversion/i);
  await assert.rejects(()=>quote(DB,{standard:source({
    conversionRows:conversionRows.map(v=>({...v,Status:'Inactive'}))})}),/not available/i);
  assert.equal(audit.reads,0);
 }finally{db.close();}
});

test('stale or missing Tiles revision stops whole preview without issuing supplier receipt',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB,audit}=d1(db);
  await assert.rejects(()=>quote(DB,{tileLines:[
   {productId:'MISSING',request:pack()}
  ]}),/NEEDS_REVIEW/i);
  db.prepare("UPDATE products SET status='Inactive' WHERE product_id='T-8X12-A'").run();
  await assert.rejects(()=>quote(DB,{tileLines:[
   {productId:'T-8X12-A',request:pack()}
  ]}),/NEEDS_REVIEW/i);
  assert.equal(audit.writes,0);
 }finally{db.close();}
});

test('large requested discount and paid are clamped to zero grand and due for combined quote',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB}=d1(db);
  const r=await quote(DB,{tileLines:[tiles()[0]],
    discountMinorText:'999999',paidMinorText:'999999'});
  assert.equal(r.totals.subtotalMinor,'209067');
  assert.equal(r.totals.requestedDiscountMinor,'999999');
  assert.equal(r.totals.appliedDiscountMinor,'209067');
  assert.equal(r.totals.grandTotalMinor,'0');
  assert.equal(r.totals.paidMinor,'0');
  assert.equal(r.totals.dueMinor,'0');
  assert.equal(r.totals.paymentStatus,'Paid');
 }finally{db.close();}
});

test('legacy single-unit 0.335 taka price is not silently rounded into an agreed integer-paisa source invoice',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB,audit}=d1(db);
  const s=source({payload:{supplierId:'SUP-A',items:[
   pipe({qty:1,unitPrice:0.335})
  ]}});
  await assert.rejects(()=>quote(DB,{standard:s,tileLines:[tiles()[0]]}),/NEEDS_REVIEW|cent|paisa/i);
  assert.equal(audit.reads,0);
 }finally{db.close();}
});

test('source purchase payload cannot smuggle discount, paid, bank, cash, auth or explicit posting permission',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB,audit}=d1(db);
  for(const [key,value] of [
   ['discount',8],['paidAmount',100],['paymentMethod','Cash'],
   ['bankAccountId','BANK-1'],['actorId','OWNER'],['cashSessionId','CS-1'],
   ['operationId','PUR-1'],['postingAllowed',true]
  ]){
   const s=source({payload:{supplierId:'SUP-A',items:[cable(),pipe()],[key]:value}});
   await assert.rejects(()=>quote(DB,{standard:s,tileLines:[tiles()[0]]}),/unsupported|invalid|forbidden/i);
  }
  assert.equal(audit.reads,0);
 }finally{db.close();}
});

test('cross-source top-level forged price, caller tenant and mismatched line metadata refuse before reads',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB,audit}=d1(db);
  for(const [key,value] of [['tenantId','t-a'],['supplierId','SUP-A'],['unitPriceText','0.01']]){
   await assert.rejects(()=>quote(DB,{[key]:value,tileLines:[tiles()[0]]}),/unsupported|invalid/i);
  }
  await assert.rejects(()=>quote(DB,{tileLines:[
   {productId:'T-8X12-A',request:pack(),unitPriceText:'0.01'}
  ]}),/unsupported|invalid/i);
  assert.equal(audit.reads,0);
 }finally{db.close();}
});

test('malformed nested arrays, sparse rows and accessor input never execute getters',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB,audit}=d1(db);
  for(const bad of [[],null,new Array(1),[null]]){
   await assert.rejects(()=>quote(DB,{tileLines:bad}),/tile|line|array|record|empty/i);
  }
  const getter=Object.defineProperty({},'productId',{get(){throw Error('getter ran');}});
  await assert.rejects(()=>quote(DB,{tileLines:[getter]}),/accessor|record|line/i);
  const badPayload=Object.defineProperty({},'supplierId',{get(){throw Error('get supplier');}});
  await assert.rejects(()=>quote(DB,{standard:source({payload:badPayload}),
   tileLines:[tiles()[0]]}),/accessor|record|payload/i);
  const broken=source({payload:{supplierId:'SUP-A',items:new Array(1)}});
  await assert.rejects(()=>quote(DB,{standard:broken,tileLines:[tiles()[0]]}),/array|item|sparse/i);
  assert.equal(audit.reads,0);
 }finally{db.close();}
});

test('invalid noncanonical paisa and overflow fail before any D1 read',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB,audit}=d1(db);
  for(const bad of [0,-1,null,'','01','+1','-1','1.00',' 1','1e3','9007199254740992']){
   await assert.rejects(()=>quote(DB,{discountMinorText:bad,tileLines:[tiles()[0]]}),/paisa|minor|canonical|safe|integer/i);
   await assert.rejects(()=>quote(DB,{paidMinorText:bad,tileLines:[tiles()[0]]}),/paisa|minor|canonical|safe|integer/i);
  }
  assert.equal(audit.reads,0);
 }finally{db.close();}
});

test('overall exact-paisa sum rejects unsafe huge Tile amount rather than inventing finance results',async()=>{
 const db=sqlite();try{
  seed(db,'T-HUGE',{sqftPrice:'999999999999999999999999.00'});const {DB,audit}=d1(db);
  await assert.rejects(()=>quote(DB,{tileLines:[
   {productId:'T-HUGE',request:pack()}
  ]}),/paisa|minor|safe|overflow/i);
  assert.equal(audit.writes,0);
 }finally{db.close();}
});

test('read-only mixed quote never registers M03 public Worker RPC or executes a financial/stock writer',async()=>{
 const db=sqlite();try{
  seed(db,'T-8X12-A');const {DB,audit}=d1(db);
  const r=await quote(DB,{tileLines:[tiles()[0]]});
  assert.equal(r.postingAllowed,false);
  assert.equal('purchaseId' in r,false);
  assert.equal('receiptId' in r,false);
  assert.equal('ledger' in r,false);
  assert.equal('bankAccountId' in r,false);
  assert.equal(audit.writes,0);
  const runtime=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/previewMixedPurchaseBasketD1|m05-mixed-purchase-basket-preview/);
  const module=readFileSync(new URL('../src/modules/m05-mixed-purchase-basket-preview.js',import.meta.url),'utf8');
  assert.doesNotMatch(module,/\b(?:INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM|\.batch\s*\(|\.run\s*\()\b/iu);
 }finally{db.close();}
});
