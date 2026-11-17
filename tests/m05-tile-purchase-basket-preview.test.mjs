import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {previewTilePurchaseBasketD1} from '../src/modules/m05-tile-purchase-basket-preview.js';
import {insertSql,row,values} from './fixtures/m02-tile-measurement-rows.mjs';

function sqlite() {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const dir=new URL('../migrations/',import.meta.url);
  for(const file of readdirSync(dir).filter(x=>/^\d{4}_.+\.sql$/u.test(x)).sort())
    db.exec(readFileSync(new URL(file,dir),'utf8'));
  return db;
}
function readOnly(db) {
  const audit={reads:0,writes:0};
  const DB={prepare(sql) {
    if(!/^\s*SELECT\s/iu.test(sql)) {
      audit.writes++;
      throw new Error('test DB permits read-only SELECT only');
    }
    audit.reads++;
    return {bind(...args) {return {
      async first(){return db.prepare(sql).get(...args)??null;},
      async all(){return {success:true,results:db.prepare(sql).all(...args)};}
    };}};
  }};
  return {DB,audit};
}
function seed(db,id,{price='',anchor='',stockOverride='',packOverride='',
  pricingUnit='Sqft',sqftPrice='38.00',policy='nominal'}={}) {
  db.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name,purchase_price_text) VALUES(?,'new','Synthetic tile','Pcs',?)").run(id,price);
  db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name,stock_purchase_override_text) VALUES(?,1,'Pcs',?,?)").run(id,anchor,stockOverride);
  db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,purchase_price_override_text) VALUES(?,1,'CTN','Carton','25.000',?)").run(id,packOverride);
  db.prepare(insertSql).run(...values(row(id,{
    purchase_pricing_unit:pricingUnit,purchase_sqft_price_override_text:sqftPrice,
    ...(policy==='manufacturer'?{
      coverage_policy:'manufacturer',manufacturer_sqft_per_box_text:'16.668',
      manufacturer_evidence_ref:'synthetic-verified-manufacturer-label'
    }:{})
  })));
  db.prepare('UPDATE products SET current_unit_revision=1 WHERE product_id=?').run(id);
}
const pack=(boxes='2',extraPieces='3')=>({mode:'pack',boxes,extraPieces});
const area=(requestedSqft='35.50',fulfillment='loose')=>
  ({mode:'area',requestedSqft,fulfillment});
const lines=(a='T-A',b='T-B')=>[
  {productId:a,request:pack()},
  {productId:b,request:area()}
];

test('two distinct D1-priced Tiles lines preserve 53+54 Pcs, exact Sqft and integer-paisa purchase totals',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');seed(db,'T-B');
    const {DB,audit}=readOnly(db);
    const result=await previewTilePurchaseBasketD1({
      DB,lines:lines(),discountMinorText:'1067',paidMinorText:'120000'
    });
    assert.equal(result.mode,'read-only-tile-basket-preview');
    assert.equal(result.currency,'BDT');
    assert.equal(result.lines.length,2);
    assert.deepEqual(result.lines.map(x=>x.receivedPcs),['53','54']);
    assert.deepEqual(result.lines.map(x=>x.lineAmountMinor),['134267','136800']);
    assert.deepEqual(result.lines.map(x=>x.productId),['T-A','T-B']);
    assert.deepEqual(result.lines[0].actualSqft,{numerator:'106',denominator:'3'});
    assert.deepEqual(result.lines[1].actualSqft,{numerator:'36',denominator:'1'});
    assert.deepEqual(result.lines[1].requestSnapshot,area());
    assert.deepEqual(result.totals,{
      subtotalMinor:'271067',requestedDiscountMinor:'1067',
      appliedDiscountMinor:'1067',grandTotalMinor:'270000',
      paidMinor:'120000',dueMinor:'150000',paymentStatus:'Partial'
    });
    assert.equal(result.supplierReviewRequired,true);
    assert.equal(result.stockAuthority,'not-loaded');
    assert.equal(result.postingAllowed,false);
    assert.ok(result.lines.every(x=>x.postingAllowed===false));
    assert.ok(audit.reads>=8);
    assert.equal(audit.writes,0);
  }finally{db.close();}
});

test('manufacturer-verified coverage uses 300.024 actual Sqft not 300 nominal',async()=>{
  const db=sqlite();try{
    seed(db,'T-MFR',{policy:'manufacturer'});
    const {DB}=readOnly(db);
    const r=await previewTilePurchaseBasketD1({DB,lines:[
      {productId:'T-MFR',request:pack('18','0')}
    ]});
    assert.equal(r.lines[0].receivedPcs,'450');
    assert.equal(r.lines[0].lineAmountMinor,'1140091');
    assert.deepEqual(r.lines[0].actualSqft,{numerator:'37503',denominator:'125'});
    assert.deepEqual(r.lines[0].nominalSqft,{numerator:'300',denominator:'1'});
    assert.equal(r.lines[0].measurementSnapshot.manufacturerEvidence,
      'synthetic-verified-manufacturer-label');
    assert.equal(r.totals.grandTotalMinor,'1140091');
  }finally{db.close();}
});

test('current Box and Pcs anchor prices are independently loaded from D1',async()=>{
  const db=sqlite();try{
    seed(db,'T-BOX',{price:'600.0000',anchor:'Carton',
      packOverride:'600.00',pricingUnit:'Box',sqftPrice:null});
    seed(db,'T-PCS',{price:'5.25',anchor:'Pcs',
      pricingUnit:'Pcs',sqftPrice:null});
    const {DB}=readOnly(db);
    const r=await previewTilePurchaseBasketD1({DB,lines:[
      {productId:'T-BOX',request:pack()},
      {productId:'T-PCS',request:pack()}
    ]});
    assert.deepEqual(r.lines.map(x=>x.pricingUnit),['Box','Pcs']);
    assert.deepEqual(r.lines.map(x=>x.unitPriceText),['600.0000','5.25']);
    assert.deepEqual(r.lines.map(x=>x.lineAmountMinor),['127200','27825']);
    assert.equal(r.totals.subtotalMinor,'155025');
    assert.equal(r.totals.paymentStatus,'Due');
  }finally{db.close();}
});

test('discount above subtotal clamps applied discount to subtotal and paid to zero',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');const {DB}=readOnly(db);
    const r=await previewTilePurchaseBasketD1({
      DB,lines:[{productId:'T-A',request:pack()}],
      discountMinorText:'999999',paidMinorText:'999999'
    });
    assert.equal(r.totals.subtotalMinor,'134267');
    assert.equal(r.totals.requestedDiscountMinor,'999999');
    assert.equal(r.totals.appliedDiscountMinor,'134267');
    assert.equal(r.totals.grandTotalMinor,'0');
    assert.equal(r.totals.paidMinor,'0');
    assert.equal(r.totals.dueMinor,'0');
    assert.equal(r.totals.paymentStatus,'Paid');
  }finally{db.close();}
});

test('paid amount above discounted grand is clamped without refund or new ledger',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');const {DB}=readOnly(db);
    const r=await previewTilePurchaseBasketD1({
      DB,lines:[{productId:'T-A',request:pack()}],
      paidMinorText:'999999'
    });
    assert.equal(r.totals.paidMinor,'134267');
    assert.equal(r.totals.dueMinor,'0');
    assert.equal(r.totals.paymentStatus,'Paid');
    assert.equal('ledger' in r,false);
    assert.equal('operationId' in r,false);
  }finally{db.close();}
});

test('different source products are never silently collapsed into one SKU or averaged price',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');seed(db,'T-B',{price:'600',anchor:'Carton',
      packOverride:'600',pricingUnit:'Box',sqftPrice:null});
    const {DB}=readOnly(db);
    const r=await previewTilePurchaseBasketD1({DB,lines:lines()});
    assert.deepEqual(r.lines.map(x=>x.productId),['T-A','T-B']);
    assert.deepEqual(r.lines.map(x=>x.lineAmountMinor),['134267','129600']);
    assert.equal(r.totals.subtotalMinor,'263867');
  }finally{db.close();}
});

test('missing or inactive product rejects entire basket; no partial return',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');seed(db,'T-B');
    const {DB,audit}=readOnly(db);
    await assert.rejects(()=>previewTilePurchaseBasketD1({DB,lines:lines('T-A','MISSING')}),/NEEDS_REVIEW/i);
    db.prepare("UPDATE products SET status='Inactive' WHERE product_id='T-B'").run();
    await assert.rejects(()=>previewTilePurchaseBasketD1({DB,lines:lines()}),/NEEDS_REVIEW/i);
    assert.equal(audit.writes,0);
  }finally{db.close();}
});

test('stale current catalog revision cannot fall back to historical measurements',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');
    db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('T-A',2,'Pcs')").run();
    db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('T-A',2,'CTN','Box','24')").run();
    db.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='T-A'").run();
    const {DB}=readOnly(db);
    await assert.rejects(()=>previewTilePurchaseBasketD1({DB,lines:[
      {productId:'T-A',request:pack()}
    ]}),/NEEDS_REVIEW/i);
  }finally{db.close();}
});

test('duplicate Product IDs reject before reading any D1 records, regardless of quantity mode',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');const {DB,audit}=readOnly(db);
    await assert.rejects(()=>previewTilePurchaseBasketD1({DB,lines:[
      {productId:'T-A',request:pack()},
      {productId:'T-A',request:area()}
    ]}),/duplicate.*product/i);
    assert.equal(audit.reads,0);
  }finally{db.close();}
});

test('forged unit price, dimensions, supplier, revision and authorization inputs all fail closed',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');const {DB,audit}=readOnly(db);
    for(const [field,value] of [
      ['unitPriceText','0.01'],['piecesPerBox','1'],['supplierId','SUP-A'],
      ['revision',1],['postingAllowed',true],['actorId','USER-A']
    ]){
      await assert.rejects(()=>previewTilePurchaseBasketD1({
        DB,lines:[{productId:'T-A',request:pack(),[field]:value}]
      }),/unsupported|invalid|unexpected/i);
    }
    await assert.rejects(()=>previewTilePurchaseBasketD1({
      DB,lines:[{productId:'T-A',request:pack()}],supplierId:'SUP-A'
    }),/unsupported|invalid|unexpected/i);
    assert.equal(audit.reads,0);
  }finally{db.close();}
});

test('malformed array, sparse rows and accessor properties fail without executing getters',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');const {DB,audit}=readOnly(db);
    for(const bad of [null,[],{},[null],new Array(1)]){
      await assert.rejects(()=>previewTilePurchaseBasketD1({DB,lines:bad}),/line|array|basket|record|empty/i);
    }
    const getter=Object.defineProperty({},'productId',{get(){throw Error('should not read getter');}});
    await assert.rejects(()=>previewTilePurchaseBasketD1({DB,lines:[getter]}),/accessor|record|line/i);
    const row={productId:'T-A',request:pack()};
    Object.defineProperty(row.request,'boxes',{get(){throw Error('request getter');}});
    await assert.rejects(()=>previewTilePurchaseBasketD1({DB,lines:[row]}),/accessor|record|request/i);
    assert.equal(audit.reads,0);
  }finally{db.close();}
});

test('invalid or noncanonical paid/discount types reject before D1 reads',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');const {DB,audit}=readOnly(db);
    for(const invalid of [-1,0,NaN,null,'','01','+1','-1','1.00',' 1','1e3',
      '9007199254740992']){
      await assert.rejects(()=>previewTilePurchaseBasketD1({
        DB,lines:[{productId:'T-A',request:pack()}],discountMinorText:invalid
      }),/paisa|minor|canonical|safe|integer/i);
      await assert.rejects(()=>previewTilePurchaseBasketD1({
        DB,lines:[{productId:'T-A',request:pack()}],paidMinorText:invalid
      }),/paisa|minor|canonical|safe|integer/i);
    }
    assert.equal(audit.reads,0);
  }finally{db.close();}
});

test('large catalog amount outside safe integer paisa range rejects without overflow or posting',async()=>{
  const db=sqlite();try{
    seed(db,'T-LARGE',{sqftPrice:'999999999999999999999999.00'});
    const {DB,audit}=readOnly(db);
    await assert.rejects(()=>previewTilePurchaseBasketD1({
      DB,lines:[{productId:'T-LARGE',request:pack()}]
    }),/safe|overflow|minor|paisa/i);
    assert.equal(audit.writes,0);
  }finally{db.close();}
});

test('inputs remain immutable and no M05 quote function is registered in public RPC',async()=>{
  const db=sqlite();try{
    seed(db,'T-A');
    const {DB,audit}=readOnly(db);
    const request=[{productId:'T-A',request:pack()}];
    const before=structuredClone(request);
    const r=await previewTilePurchaseBasketD1({DB,lines:request});
    assert.deepEqual(request,before);
    assert.equal(r.lines[0].postingAllowed,false);
    assert.equal(r.postingAllowed,false);
    assert.equal(audit.writes,0);
    const module=readFileSync(new URL('../src/modules/m05-tile-purchase-basket-preview.js',import.meta.url),'utf8');
    const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
      readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
    assert.doesNotMatch(runtime,/previewTilePurchaseBasketD1|m05-tile-purchase-basket-preview/);
    assert.doesNotMatch(module,/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.batch\s*\(|\.run\s*\()\b/iu);
  }finally{db.close();}
});
