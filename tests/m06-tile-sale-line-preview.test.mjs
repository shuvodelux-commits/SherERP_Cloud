import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {insertSql,row,values} from './fixtures/m02-tile-measurement-rows.mjs';

// RED: intentionally absent module until all source-backed tests are committed.
const preview=await import('../src/modules/m06-tile-sale-line-preview.js')
  .then(m=>m.previewTileSaleLineCandidateD1)
  .catch(e=>{if(e?.code==='ERR_MODULE_NOT_FOUND')return undefined;throw e;});
const quote=async options=>{
  assert.equal(typeof preview,'function','M06 current-revision Tiles sale quote is missing');
  return preview(options);
};
function sqlite(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const path=new URL('../migrations/',import.meta.url);
  for(const name of readdirSync(path).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort())
    db.exec(readFileSync(new URL(name,path),'utf8'));
  return db;
}
function d1(db){
  return {prepare(sql){return {bind(...args){return {
    async first(){return db.prepare(sql).get(...args)??null;},
    async all(){return {success:true,results:db.prepare(sql).all(...args)};}
  };}};}};
}
function seed(db,id,{price='',anchor='',stockOverride='',packOverride='',
  pricingUnit='Sqft',sqftPrice='38.00',policy='nominal'}={}){
  db.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name,selling_price_text) VALUES(?,'new','Synthetic tile','Pcs',?)")
    .run(id,price);
  db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,selling_anchor_unit_name,stock_selling_override_text) VALUES(?,1,'Pcs',?,?)")
    .run(id,anchor,stockOverride);
  db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,selling_price_override_text) VALUES(?,1,'CTN','Carton','25.000',?)")
    .run(id,packOverride);
  db.prepare(insertSql).run(...values(row(id,{
    selling_pricing_unit:pricingUnit,selling_sqft_price_override_text:sqftPrice,
    ...(policy==='manufacturer'?{
      coverage_policy:'manufacturer',
      manufacturer_sqft_per_box_text:'16.668',
      manufacturer_evidence_ref:'synthetic-label-verified'
    }: {})
  })));
  db.prepare('UPDATE products SET current_unit_revision=1 WHERE product_id=?').run(id);
}
const pack={mode:'pack',boxes:'2',extraPieces:'3'};
const area={mode:'area',requestedSqft:'35.50',fulfillment:'loose'};
const local=(db,productId,request=pack,extra={})=>quote({DB:d1(db),productId,request,...extra});

test('Tiles POS 2 Cartons+3 Pcs: 53 Pcs, exact 106/3 Sqft and source D1 sell price 38/sqft',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-TILE-SQFT');
    const count=db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n;
    const x=await local(db,'SALE-TILE-SQFT');
    assert.equal(x.productId,'SALE-TILE-SQFT');
    assert.equal(x.productName,'Synthetic tile');
    assert.equal(x.revision,'1');
    assert.equal(x.stockUnit,'Pcs');
    assert.equal(x.quantity.pieces,'53');
    assert.equal(x.quantity.boxes,'2');
    assert.equal(x.quantity.extraPieces,'3');
    assert.deepEqual(x.quantity.actualSqft,{numerator:'106',denominator:'3'});
    assert.equal(x.quantity.displaySqft,'35.33');
    assert.equal(x.salePreview.pricingUnit,'Sqft');
    assert.equal(x.salePreview.unitPriceText,'38.00');
    assert.equal(x.salePreview.lineAmountMinor,'134267');
    assert.equal(x.salePreview.roundingDeltaMinor,'13',
      'Do not bill from rounded 35.33 Sqft display; 106/3 sqft ×38=1342.67');
    assert.equal(x.salePreview.postingAllowed,false);
    assert.equal(x.stockAuthority,'not-loaded');
    assert.deepEqual(x.quantity.unitSnapshot.map(c=>c.unitName),['Carton','Pcs']);
    assert.equal(db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n,count);
  }finally{db.close();}
});

test('Tiles POS 35.50 sqft requests 54 whole Pcs (36 Sqft) and exact source-selected invoice line',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-TILE-AREA');
    const x=await local(db,'SALE-TILE-AREA',area);
    assert.equal(x.quantity.pieces,'54');
    assert.equal(x.quantity.boxes,'2');
    assert.equal(x.quantity.extraPieces,'4');
    assert.deepEqual(x.quantity.requestedSqft,{numerator:'71',denominator:'2'});
    assert.deepEqual(x.quantity.actualSqft,{numerator:'36',denominator:'1'});
    assert.equal(x.quantity.displaySqft,'36.00');
    assert.equal(x.salePreview.lineAmountMinor,'136800');
    const boxed=await local(db,'SALE-TILE-AREA',{...area,fulfillment:'box-only'});
    assert.equal(boxed.quantity.pieces,'75');
    assert.equal(boxed.quantity.boxes,'3');
    assert.equal(boxed.quantity.displaySqft,'50.00');
    assert.equal(boxed.salePreview.lineAmountMinor,'190000');
  }finally{db.close();}
});

test('manufacturer-verified coverage and revision stay historical, not silently changed to nominal area',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-MFR',{policy:'manufacturer'});
    const x=await local(db,'SALE-MFR',{mode:'pack',boxes:'18',extraPieces:'0'});
    assert.equal(x.quantity.pieces,'450');
    assert.equal(x.quantity.displaySqft,'300.02');
    assert.deepEqual(x.quantity.actualSqft,{numerator:'37503',denominator:'125'});
    assert.deepEqual(x.quantity.nominalSqft,{numerator:'300',denominator:'1'});
    assert.equal(x.salePreview.lineAmountMinor,'1140091');
    assert.equal(x.quantity.measurementSnapshot.manufacturerEvidence,'synthetic-label-verified');
    assert.equal(x.quantity.measurementSnapshot.coveragePolicy,'manufacturer');
  }finally{db.close();}
});

test('trusted Carton selling anchor agrees with optional exact 600.0000 Carton override',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-BOX-ANCHOR',{price:'600.0000',anchor:'Carton',packOverride:'600.00',
      pricingUnit:'Box',sqftPrice:null});
    const x=await local(db,'SALE-BOX-ANCHOR');
    assert.equal(x.quantity.pieces,'53');
    assert.equal(x.salePreview.pricingUnit,'Box');
    assert.equal(x.salePreview.unitPriceText,'600.0000');
    assert.deepEqual(x.salePreview.billingQuantity,{numerator:'53',denominator:'25'});
    assert.equal(x.salePreview.lineAmountMinor,'127200');
  }finally{db.close();}
});

test('nonanchor Carton selling price override is used, mismatched source anchor is refused',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-BOX-OVR',{price:'5.25',anchor:'Pcs',packOverride:'610.00',pricingUnit:'Box'});
    assert.equal((await local(db,'SALE-BOX-OVR')).salePreview.lineAmountMinor,'129320');
    seed(db,'SALE-BOX-BAD',{price:'600',anchor:'Carton',packOverride:'601',pricingUnit:'Box'});
    await assert.rejects(()=>local(db,'SALE-BOX-BAD'),/NEEDS_REVIEW/);
  }finally{db.close();}
});

test('canonical Pcs selling price anchor and independent stock unit override remain exact',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-PCS',{price:'5.25',anchor:'Pcs',pricingUnit:'Pcs'});
    let x=await local(db,'SALE-PCS');
    assert.equal(x.salePreview.unitPriceText,'5.25');
    assert.equal(x.salePreview.lineAmountMinor,'27825');
    seed(db,'SALE-PCS-OVR',{price:'600',anchor:'Carton',stockOverride:'5.2500',pricingUnit:'Pcs'});
    x=await local(db,'SALE-PCS-OVR');
    assert.equal(x.salePreview.unitPriceText,'5.2500');
    assert.equal(x.salePreview.lineAmountMinor,'27825');
    seed(db,'SALE-PCS-CONFLICT',{price:'5.25',anchor:'Pcs',stockOverride:'6',pricingUnit:'Pcs'});
    await assert.rejects(()=>local(db,'SALE-PCS-CONFLICT'),/NEEDS_REVIEW/);
  }finally{db.close();}
});

test('price missing, negative, malformed or stale D1 selling price cannot become customer sale quote',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-NO-PRICE',{sqftPrice:null});
    await assert.rejects(()=>local(db,'SALE-NO-PRICE'),/NEEDS_REVIEW/);
    seed(db,'SALE-BAD-PRICE',{price:'-',anchor:'Pcs',pricingUnit:'Pcs'});
    await assert.rejects(()=>local(db,'SALE-BAD-PRICE'),/NEEDS_REVIEW/);
    seed(db,'SALE-NO-OVR',{price:'5',anchor:'Pcs',pricingUnit:'Box'});
    await assert.rejects(()=>local(db,'SALE-NO-OVR'),/NEEDS_REVIEW/);
  }finally{db.close();}
});

test('old revision, inactive/deleted/Bundle products cannot be sold as active current Tiles',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-HISTORY',{price:'5.25',anchor:'Pcs',pricingUnit:'Pcs'});
    db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,selling_anchor_unit_name) VALUES('SALE-HISTORY',2,'Pcs','Pcs')").run();
    db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('SALE-HISTORY',2,'CTN','Box','24')").run();
    db.prepare(insertSql).run(...values(row('SALE-HISTORY',{revision:2,pieces_per_box:24,selling_pricing_unit:'Pcs'})));
    db.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='SALE-HISTORY'").run();
    await assert.rejects(()=>local(db,'SALE-HISTORY',pack,{revision:1}),/NEEDS_REVIEW/);
    const current=await local(db,'SALE-HISTORY');
    assert.equal(current.quantity.pieces,'51');
    db.prepare("UPDATE products SET status='Inactive' WHERE product_id='SALE-HISTORY'").run();
    await assert.rejects(()=>local(db,'SALE-HISTORY'),/NEEDS_REVIEW/);
    db.prepare("UPDATE products SET status='Active',is_deleted=1 WHERE product_id='SALE-HISTORY'").run();
    await assert.rejects(()=>local(db,'SALE-HISTORY'),/NEEDS_REVIEW/);
    db.prepare("UPDATE products SET is_deleted=0,product_type_text='Bundle' WHERE product_id='SALE-HISTORY'").run();
    await assert.rejects(()=>local(db,'SALE-HISTORY'),/NEEDS_REVIEW/);
  }finally{db.close();}
});

test('missing product or non-Tile returns null, never infers square footage',async()=>{
  const db=sqlite();try{
    assert.equal(await local(db,'DOES-NOT-EXIST'),null);
    db.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name) VALUES('NON-TILE','new','Non Tile','Pcs')").run();
    assert.equal(await local(db,'NON-TILE'),null);
  }finally{db.close();}
});

test('malformed source quantities and unauthorized browser prices/units cannot enter a trusted preview',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-STRICT');
    for(const bad of [
      {mode:'pack',boxes:'0',extraPieces:'0'},
      {mode:'pack',boxes:'-1',extraPieces:'0'},
      {mode:'area',requestedSqft:'0',fulfillment:'loose'},
      {mode:'area',requestedSqft:'35.50',fulfillment:'arbitrary'}
    ])await assert.rejects(()=>local(db,'SALE-STRICT',bad));
    await assert.rejects(()=>quote({DB:d1(db),productId:'SALE-STRICT',
      request:pack,unitPriceText:'0.01'}),/Unsupported|Invalid|NEEDS_REVIEW/);
    await assert.rejects(()=>quote({DB:d1(db),productId:'SALE-STRICT',
      request:pack,pricingUnit:'Pcs'}),/Unsupported|Invalid|NEEDS_REVIEW/);
  }finally{db.close();}
});

test('read-only customer quote contains no private purchase costs, bank, Customer or D1 session data',async()=>{
  const db=sqlite();try{
    seed(db,'SALE-PRIVATE');
    db.prepare("UPDATE products SET purchase_price_text='12.345' WHERE product_id='SALE-PRIVATE'").run();
    const x=await local(db,'SALE-PRIVATE');
    const serialized=JSON.stringify(x);
    assert.equal(serialized.includes('purchasePriceText'),false);
    assert.equal(serialized.includes('purchase'),false);
    assert.equal(serialized.includes('bankAccount'),false);
    assert.equal(serialized.includes('customerId'),false);
    assert.equal(serialized.includes('session'),false);
    assert.equal(x.salePreview.postingAllowed,false);
    assert.equal(x.stockAuthority,'not-loaded');
  }finally{db.close();}
});
