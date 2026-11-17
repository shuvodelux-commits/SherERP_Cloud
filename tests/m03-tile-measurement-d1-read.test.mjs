import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {readTileMeasurementCandidateD1} from '../src/db/tile-measurement-d1-read.js';
import {seedSql,insertSql,row,values} from './fixtures/m02-tile-measurement-rows.mjs';

function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 const path=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(path).filter(x=>/^\\d{4}_.+\\.sql$/.test(x)).sort())
  db.exec(readFileSync(new URL(name,path),'utf8'));
 return db;
}
function seed(db,id,pack='25.000'){
 for(const item of seedSql(id,1,pack))db.prepare(item.sql).run(...item.args);
 db.prepare('UPDATE products SET current_unit_revision=1 WHERE product_id=?').run(id);
}
function insert(db,value){db.prepare(insertSql).run(...values(value));}
function d1(db,change=()=>null){
 return {prepare(sql){
  return {bind(...args){
   return {
    async first(){
     const found=db.prepare(sql).get(...args)??null;
     return sql.includes('FROM product_tile_measurement_revisions') ? (change(found)??found) : found;
    },
    async all(){return {success:true,results:db.prepare(sql).all(...args)};}
   };
  }};
 }};
}
test('missing Product ID or missing tile row never invents a measurement',async()=>{
 const db=setup();try{
  seed(db,'NOT-TILE');
  assert.equal(await readTileMeasurementCandidateD1({DB:d1(db),productId:'MISSING'}),null);
  assert.equal(await readTileMeasurementCandidateD1({DB:d1(db),productId:'NOT-TILE'}),null);
 }finally{db.close();}
});
test('current tile read preserves exact Sqft price, manufacturer metadata, physical pack label and source evidence',async()=>{
 const db=setup();try{
  seed(db,'READ-TILE');
  insert(db,row('READ-TILE',{length_text:'304.800000000001',dimension_unit:'mm',
   coverage_policy:'manufacturer',manufacturer_sqft_per_box_text:'16.668000',
   manufacturer_evidence_ref:'synthetic-manufacturer-label',
   purchase_sqft_price_override_text:'0.0000',selling_sqft_price_override_text:null}));
  const before=db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n;
  const out=await readTileMeasurementCandidateD1({DB:d1(db),productId:'READ-TILE'});
  assert.equal(out.catalog.productId,'READ-TILE');
  assert.equal(out.catalog.stockAuthority,'not-loaded');
  assert.equal(out.measurement.revision,'1');
  assert.equal(out.measurement.length,'304.800000000001');
  assert.equal(out.measurement.width,'8');
  assert.equal(out.measurement.dimensionUnit,'mm');
  assert.equal(out.measurement.piecesPerBox,'25');
  assert.equal(out.measurement.boxUnitName,'Carton');
  assert.equal(out.measurement.manufacturerSqftPerBox,'16.668000');
  assert.equal(out.measurement.manufacturerEvidence,'synthetic-manufacturer-label');
  assert.deepEqual(out.pricing,{purchasePricingUnit:'Box',sellingPricingUnit:'Sqft',
   purchaseSqftPriceOverrideText:'0.0000',sellingSqftPriceOverrideText:null});
  assert.equal(out.evidence.sourceEvidenceRef,'synthetic-label:001');
  assert.equal(out.evidence.createdAtText,'2026-11-17 local');
  assert.equal(out.isCurrent,true);
  assert.equal(db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n,before);
 }finally{db.close();}
});
test('historical 25-piece tile remains pinned after current pack revision changes to 24',async()=>{
 const db=setup();try{
  seed(db,'REV-TILE');insert(db,row('REV-TILE'));
  db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('REV-TILE',2,'Pcs')").run();
  db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,status) VALUES('REV-TILE',2,'CTN','Box','24','Inactive')").run();
  insert(db,row('REV-TILE',{revision:2,pieces_per_box:24,length_text:'12',width_text:'12'}));
  db.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='REV-TILE'").run();
  const old=await readTileMeasurementCandidateD1({DB:d1(db),productId:'REV-TILE',revision:1});
  const current=await readTileMeasurementCandidateD1({DB:d1(db),productId:'REV-TILE'});
  assert.equal(old.measurement.piecesPerBox,'25');assert.equal(old.measurement.boxUnitName,'Carton');
  assert.equal(old.isCurrent,false);
  assert.equal(current.measurement.piecesPerBox,'24');assert.equal(current.measurement.boxUnitName,'Box');
  assert.equal(current.catalog.unitConfig.conversions[0].status,'Inactive');
  assert.equal(current.isCurrent,true);
 }finally{db.close();}
});
test('malformed or tampered D1 tile rows fail closed without leaking evidence',async()=>{
 const db=setup();try{
  seed(db,'TAMPER-TILE');insert(db,row('TAMPER-TILE'));
  const base=d1(db);
  for(const patch of [{pieces_per_box:24},{length_text:'not-decimal'},{coverage_policy:'manufacturer'},
   {manufacturer_sqft_per_box_text:'7',manufacturer_evidence_ref:null},
   {box_conversion_id:'UNRELATED'},{selling_sqft_price_override_text:'1e4'},
   {source_evidence_ref:' '}]) {
   const result=d1(db,value=>({...value,...patch}));
   await assert.rejects(()=>readTileMeasurementCandidateD1({DB:result,productId:'TAMPER-TILE'}),
    error=>/NEEDS_REVIEW/.test(error.message)&&!/synthetic-label|UNRELATED|not-decimal/.test(error.message));
  }
  assert.equal((await readTileMeasurementCandidateD1({DB:base,productId:'TAMPER-TILE'})).measurement.piecesPerBox,'25');
 }finally{db.close();}
});
test('invalid arguments and SQL faults never permit unsafe D1 calls',async()=>{
 await assert.rejects(()=>readTileMeasurementCandidateD1({DB:null,productId:'X'}),/binding/);
 const unusable={prepare(){throw new Error('PRIVATE CUSTOMER DATA IN DB ERROR');}};
 await assert.rejects(()=>readTileMeasurementCandidateD1({DB:unusable,productId:'X'}),err=>!/PRIVATE CUSTOMER/.test(err.message));
 for(const opts of [{productId:''},{productId:' X '},{productId:'X',revision:0},{productId:'X',revision:1.5}])
  await assert.rejects(()=>readTileMeasurementCandidateD1({DB:unusable,...opts}),/invalid/i);
});