import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {proposeTileQuantityCandidateD1} from '../src/db/tile-quantity-d1-proposal.js';
import {seedSql,insertSql,row,values} from './fixtures/m02-tile-measurement-rows.mjs';

function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 const path=new URL('../migrations/',import.meta.url);
 for(const file of readdirSync(path).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort())
  db.exec(readFileSync(new URL(file,path),'utf8'));
 return db;
}
function d1(db){
 return {prepare(sql){return {bind(...args){return {
  async first(){return db.prepare(sql).get(...args)??null;},
  async all(){return {success:true,results:db.prepare(sql).all(...args)};}
 };}};}};
}
function seed(db,id,patch={}){
 for(const item of seedSql(id,1))db.prepare(item.sql).run(...item.args);
 db.prepare(insertSql).run(...values(row(id,patch)));
 db.prepare('UPDATE products SET current_unit_revision=1 WHERE product_id=?').run(id);
}
const pack={mode:'pack',boxes:'2',extraPieces:'3'};
const area={mode:'area',requestedSqft:'35.50',fulfillment:'loose'};

test('stored nominal 12 by 8 tile, 2 Cartons and 3 Pcs produce exact 53 Pcs, 106/3 Sqft',async()=>{
 const db=setup();try{
  seed(db,'D1-COMP-1');
  const before=db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n;
  const result=await proposeTileQuantityCandidateD1({DB:d1(db),productId:'D1-COMP-1',request:pack});
  assert.equal(result.quantity.pieces,'53');
  assert.deepEqual(result.quantity.actualSqft,{numerator:'106',denominator:'3'});
  assert.equal(result.quantity.displaySqft,'35.33');
  assert.equal(result.quantity.measurementSnapshot.boxUnitName,'Carton');
  assert.equal(result.quantity.unitSnapshot[0].unitName,'Carton');
  assert.equal(result.catalog.stockAuthority,'not-loaded');
  assert.equal(result.pricing.sellingPricingUnit,'Sqft');
  assert.deepEqual(result.quantity.requestSnapshot,pack);
  assert.equal(db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n,before);
 }finally{db.close();}
});
test('stored area request rounds to 54 Pcs loose or 75 Pcs box-only without shrinking demand',async()=>{
 const db=setup();try{
  seed(db,'D1-COMP-AREA');
  const loose=await proposeTileQuantityCandidateD1({DB:d1(db),productId:'D1-COMP-AREA',request:area});
  const boxes=await proposeTileQuantityCandidateD1({DB:d1(db),productId:'D1-COMP-AREA',request:{...area,fulfillment:'box-only'}});
  assert.equal(loose.quantity.pieces,'54');assert.equal(loose.quantity.boxes,'2');
  assert.equal(loose.quantity.extraPieces,'4');
  assert.deepEqual(loose.quantity.requestedSqft,{numerator:'71',denominator:'2'});
  assert.deepEqual(loose.quantity.actualSqft,{numerator:'36',denominator:'1'});
  assert.equal(boxes.quantity.pieces,'75');assert.equal(boxes.quantity.displaySqft,'50.00');
 }finally{db.close();}
});
test('manufacturer coverage evidence remains explicit, never silently replaced by nominal',async()=>{
 const db=setup();try{
  seed(db,'D1-COMP-MFR',{coverage_policy:'manufacturer',
   manufacturer_sqft_per_box_text:'16.668',
   manufacturer_evidence_ref:'synthetic-verified-label'});
  const result=await proposeTileQuantityCandidateD1({DB:d1(db),productId:'D1-COMP-MFR',request:{mode:'pack',boxes:'18',extraPieces:'0'}});
  assert.equal(result.quantity.pieces,'450');
  assert.equal(result.quantity.displaySqft,'300.02');
  assert.deepEqual(result.quantity.nominalSqft,{numerator:'300',denominator:'1'});
  assert.equal(result.quantity.measurementSnapshot.manufacturerEvidence,'synthetic-verified-label');
  assert.equal(result.quantity.measurementSnapshot.coveragePolicy,'manufacturer');
 }finally{db.close();}
});
test('historical 25 Pcs per carton remains stable when current revision uses 24 Pcs',async()=>{
 const db=setup();try{
  seed(db,'D1-COMP-HISTORY');
  db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('D1-COMP-HISTORY',2,'Pcs')").run();
  db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('D1-COMP-HISTORY',2,'CTN','Box','24')").run();
  db.prepare(insertSql).run(...values(row('D1-COMP-HISTORY',{revision:2,pieces_per_box:24,width_text:'12'})));
  db.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='D1-COMP-HISTORY'").run();
  const old=await proposeTileQuantityCandidateD1({DB:d1(db),productId:'D1-COMP-HISTORY',revision:1,request:pack});
  const current=await proposeTileQuantityCandidateD1({DB:d1(db),productId:'D1-COMP-HISTORY',request:pack});
  assert.equal(old.quantity.pieces,'53');
  assert.equal(old.quantity.measurementSnapshot.boxUnitName,'Carton');
  assert.equal(old.isCurrent,false);
  assert.equal(current.quantity.pieces,'51');
  assert.equal(current.quantity.measurementSnapshot.boxUnitName,'Box');
  assert.equal(current.isCurrent,true);
  assert.deepEqual(current.quantity.actualSqft,{numerator:'51',denominator:'1'});
  assert.equal(old.quantity.pieces,'53');
 }finally{db.close();}
});
test('missing tiles are absent, invalid physical requests are rejected, no public or write authority',async()=>{
 const db=setup();try{
  for(const item of seedSql('D1-NON-TILE'))db.prepare(item.sql).run(...item.args);
  assert.equal(await proposeTileQuantityCandidateD1({DB:d1(db),productId:'MISSING',request:pack}),null);
  assert.equal(await proposeTileQuantityCandidateD1({DB:d1(db),productId:'D1-NON-TILE',request:pack}),null);
  seed(db,'D1-INVALID-TILE');
  for(const request of [
   {mode:'pack',boxes:'0',extraPieces:'0'},
   {mode:'pack',boxes:'-1',extraPieces:'0'},
   {mode:'area',requestedSqft:'35.50',fulfillment:'unsupported'},
   {mode:'area',requestedSqft:'0',fulfillment:'loose'}
  ]) await assert.rejects(()=>proposeTileQuantityCandidateD1({DB:d1(db),productId:'D1-INVALID-TILE',request}));
  assert.equal(typeof (await proposeTileQuantityCandidateD1({DB:d1(db),productId:'D1-INVALID-TILE',request:pack})).quantity.pieces,'string');
 }finally{db.close();}
});