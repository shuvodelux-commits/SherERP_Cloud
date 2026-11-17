import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {previewTilePurchaseLineCandidateD1} from '../src/modules/m05-tile-purchase-line-preview.js';
import {insertSql,row,values} from './fixtures/m02-tile-measurement-rows.mjs';

function sqlite(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 const path=new URL('../migrations/',import.meta.url);
 for(const file of readdirSync(path).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort())
  db.exec(readFileSync(new URL(file,path),'utf8'));
 return db;
}
function d1(db){return {prepare(sql){return {bind(...args){return {
 async first(){return db.prepare(sql).get(...args)??null;},
 async all(){return {success:true,results:db.prepare(sql).all(...args)};}
};}};}};}
function seed(db,id,{price='',anchor='',stockOverride='',packOverride='',pricingUnit='Sqft',sqftPrice='38.00',policy='nominal'}={}){
 db.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name,purchase_price_text) VALUES(?,'new','Synthetic tile','Pcs',?)").run(id,price);
 db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name,stock_purchase_override_text) VALUES(?,1,'Pcs',?,?)").run(id,anchor,stockOverride);
 db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,purchase_price_override_text) VALUES(?,1,'CTN','Carton','25.000',?)").run(id,packOverride);
 db.prepare(insertSql).run(...values(row(id,{
  purchase_pricing_unit:pricingUnit,purchase_sqft_price_override_text:sqftPrice,
  ...(policy==='manufacturer'?{coverage_policy:'manufacturer',manufacturer_sqft_per_box_text:'16.668',manufacturer_evidence_ref:'synthetic-label-verified'}:{})
 })));
 db.prepare("UPDATE products SET current_unit_revision=1 WHERE product_id=?").run(id);
}
const pack={mode:'pack',boxes:'2',extraPieces:'3'};
const requestArea={mode:'area',requestedSqft:'35.50',fulfillment:'loose'};
test('Sqft price from immutable D1 exact 2 Cartons plus 3 Pcs produces 53 received and BDT 1342.67',async()=>{
 const db=sqlite();try{seed(db,'PUR-TILE-1');
 const before=db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n;
 const r=await previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-TILE-1',request:pack});
 assert.equal(r.purchasePreview.postingAllowed,false);
 assert.equal(r.purchasePreview.receivedPcs,'53');
 assert.equal(r.purchasePreview.pricingUnit,'Sqft');
 assert.equal(r.purchasePreview.unitPriceText,'38.00');
 assert.equal(r.purchasePreview.lineAmountMinor,'134267');
 assert.deepEqual(r.purchasePreview.billingQuantity,{numerator:'106',denominator:'3'});
 assert.equal(r.quantity.measurementSnapshot.boxUnitName,'Carton');
 assert.equal(r.catalog.stockAuthority,'not-loaded');
 assert.equal(db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n,before);
 }finally{db.close();}
});
test('requested 35.50 Sqft yields 54 canonical Pcs and 36 Sqft purchased with exact quote',async()=>{
 const db=sqlite();try{seed(db,'PUR-AREA');
 const r=await previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-AREA',request:requestArea});
 assert.equal(r.purchasePreview.receivedPcs,'54');
 assert.equal(r.purchasePreview.lineAmountMinor,'136800');
 assert.deepEqual(r.quantity.requestedSqft,{numerator:'71',denominator:'2'});
 assert.deepEqual(r.quantity.actualSqft,{numerator:'36',denominator:'1'});
 }finally{db.close();}
});
test('evidenced manufacturer 16.668 Sqft per box is not substituted by nominal coverage',async()=>{
 const db=sqlite();try{seed(db,'PUR-MFR',{policy:'manufacturer'});
 const r=await previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-MFR',request:{mode:'pack',boxes:'18',extraPieces:'0'}});
 assert.equal(r.purchasePreview.receivedPcs,'450');
 assert.equal(r.purchasePreview.lineAmountMinor,'1140091');
 assert.equal(r.quantity.displaySqft,'300.02');
 assert.deepEqual(r.quantity.nominalSqft,{numerator:'300',denominator:'1'});
 assert.equal(r.quantity.measurementSnapshot.manufacturerEvidence,'synthetic-label-verified');
 }finally{db.close();}
});
test('Box anchor price and exact conversion price agree without coercion',async()=>{
 const db=sqlite();try{seed(db,'PUR-BOX',{price:'600.0000',anchor:'Carton',packOverride:'600.00',pricingUnit:'Box',sqftPrice:null});
 const r=await previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-BOX',request:pack});
 assert.equal(r.purchasePreview.receivedPcs,'53');
 assert.equal(r.purchasePreview.pricingUnit,'Box');
 assert.equal(r.purchasePreview.unitPriceText,'600.0000');
 assert.deepEqual(r.purchasePreview.billingQuantity,{numerator:'53',denominator:'25'});
 assert.equal(r.purchasePreview.lineAmountMinor,'127200');
 }finally{db.close();}
});
test('Box nonanchor exact override is honored but inconsistent active anchor fails closed',async()=>{
 const db=sqlite();try{
 seed(db,'PUR-BOX-OVERRIDE',{price:'5.25',anchor:'Pcs',packOverride:'610.00',pricingUnit:'Box'});
 assert.equal((await previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-BOX-OVERRIDE',request:pack})).purchasePreview.lineAmountMinor,'129320');
 seed(db,'PUR-BOX-BAD',{price:'600',anchor:'Carton',packOverride:'601',pricingUnit:'Box'});
 await assert.rejects(()=>previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-BOX-BAD',request:pack}),/NEEDS_REVIEW/);
 }finally{db.close();}
});
test('Pcs anchor price and independent explicit stock override use exact integer quantity',async()=>{
 const db=sqlite();try{
 seed(db,'PUR-PCS',{price:'5.25',anchor:'Pcs',pricingUnit:'Pcs'});
 let r=await previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-PCS',request:pack});
 assert.equal(r.purchasePreview.lineAmountMinor,'27825');
 seed(db,'PUR-PCS-STOCK-OVR',{price:'600',anchor:'Carton',stockOverride:'5.2500',pricingUnit:'Pcs'});
 r=await previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-PCS-STOCK-OVR',request:pack});
 assert.equal(r.purchasePreview.unitPriceText,'5.2500');
 assert.equal(r.purchasePreview.lineAmountMinor,'27825');
 }finally{db.close();}
});
test('missing D1 price, bad price, inactive and historical product are not purchasable',async()=>{
 const db=sqlite();try{
 seed(db,'PUR-NO-PRICE',{sqftPrice:null});
 await assert.rejects(()=>previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-NO-PRICE',request:pack}),/NEEDS_REVIEW/);
 seed(db,'PUR-OLD',{price:'5.25',anchor:'Pcs',pricingUnit:'Pcs'});
 db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name) VALUES('PUR-OLD',2,'Pcs','Pcs')").run();
 db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('PUR-OLD',2,'CTN','Box','24')").run();
 db.prepare(insertSql).run(...values(row('PUR-OLD',{revision:2,pieces_per_box:24,purchase_pricing_unit:'Pcs'})));
 db.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='PUR-OLD'").run();
 await assert.rejects(()=>previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-OLD',revision:1,request:pack}),/NEEDS_REVIEW/);
 db.prepare("UPDATE products SET status='Inactive' WHERE product_id='PUR-OLD'").run();
 await assert.rejects(()=>previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-OLD',request:pack}),/NEEDS_REVIEW/);
 }finally{db.close();}
});
test('missing product returns null; untrusted caller price and invalid requests fail closed',async()=>{
 const db=sqlite();try{
 seed(db,'PUR-STRICT');
 assert.equal(await previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'NOT-THERE',request:pack}),null);
 await assert.rejects(()=>previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-STRICT',request:pack,unitPriceText:'0.01'}),/Unsupported|Invalid|NEEDS_REVIEW/);
 await assert.rejects(()=>previewTilePurchaseLineCandidateD1({DB:d1(db),productId:'PUR-STRICT',request:{mode:'area',requestedSqft:'0',fulfillment:'loose'}}));
 }finally{db.close();}
});