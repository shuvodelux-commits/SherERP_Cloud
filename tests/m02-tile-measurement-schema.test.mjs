import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {insertSql,row,values,seedSql,invalidRows} from './fixtures/m02-tile-measurement-rows.mjs';

function create(){
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const dir=new URL('../migrations/',import.meta.url);
  // Read explicitly first: the RED failure must name the absent migration.
  readFileSync(new URL('0014_tile_measurement_revisions.sql',dir),'utf8');
  for(const name of readdirSync(dir).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort())
    db.exec(readFileSync(new URL(name,dir),'utf8'));
  return db;
}
function seed(db,id,revision=1,factor='25.000',base='Pcs',type=''){
  for(const {sql,args} of seedSql(id,revision,factor,base,type))db.prepare(sql).run(...args);
}

test('0014 creates one empty STRICT measurement extension with restrictive parent references',()=>{
  const db=create();try{
    assert.equal(db.prepare("PRAGMA table_list('product_tile_measurement_revisions')").get().strict,1);
    assert.equal(db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n,0);
    const fks=db.prepare('PRAGMA foreign_key_list(product_tile_measurement_revisions)').all();
    assert.deepEqual([...new Set(fks.map(x=>x.table))].sort(),['product_unit_conversions','product_unit_profiles']);
    assert.ok(fks.every(x=>x.on_delete==='RESTRICT'));
  }finally{db.close();}
});

test('exact dimensions, pack quantities and dimension units survive without REAL coercion',()=>{
  const db=create();try{
    const cases=[['8','12',25,'in'],['12','12',10,'in'],['12','24',6,'in'],
      ['24','24',4,'in'],['304.8','203.2',25,'mm'],['30.48','20.32',25,'cm'],
      ['999999999999999999999999','0.000000000001',25,'in']];
    for(const [index,[length,width,pack,unit]] of cases.entries()){
      const id='DIM-'+index;seed(db,id,1,String(pack));
      db.prepare(insertSql).run(...values(row(id,{length_text:length,width_text:width,pieces_per_box:pack,dimension_unit:unit})));
      const out=db.prepare('SELECT length_text,width_text,pieces_per_box,dimension_unit FROM product_tile_measurement_revisions WHERE product_id=?').get(id);
      assert.equal(out.length_text,length);assert.equal(out.width_text,width);
      assert.equal(out.pieces_per_box,pack);assert.equal(out.dimension_unit,unit);
    }
  }finally{db.close();}
});

test('manufacturer coverage is explicit and Sqft overrides retain independent exact zero and null',()=>{
  const db=create();try{
    seed(db,'NOM');seed(db,'MFR');
    const metadata={manufacturer_sqft_per_box_text:'16.668000',manufacturer_evidence_ref:'label:verified',purchase_sqft_price_override_text:'0.0000'};
    db.prepare(insertSql).run(...values(row('NOM',metadata)));
    db.prepare(insertSql).run(...values(row('MFR',{...metadata,coverage_policy:'manufacturer',selling_sqft_price_override_text:null})));
    const out=db.prepare("SELECT * FROM product_tile_measurement_revisions WHERE product_id='MFR'").get();
    assert.equal(out.manufacturer_sqft_per_box_text,'16.668000');
    assert.equal(out.purchase_sqft_price_override_text,'0.0000');
    assert.equal(out.selling_sqft_price_override_text,null);
    assert.equal(out.created_at_text,'2026-11-17 local');
    assert.equal(db.prepare("SELECT coverage_policy FROM product_tile_measurement_revisions WHERE product_id='NOM'").get().coverage_policy,'nominal');
  }finally{db.close();}
});

test('invalid decimal representations, physical pack counts, policies and incomplete evidence fail closed',()=>{
  const db=create();try{
    for(const [i,patch] of invalidRows.entries()){
      const id='BAD-'+i;seed(db,id);
      assert.throws(()=>db.prepare(insertSql).run(...values(row(id,patch))),/constraint|mismatch|datatype|integer|CHECK/i,JSON.stringify(patch));
      assert.equal(db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions WHERE product_id=?').get(id).n,0);
    }
  }finally{db.close();}
});

test('same product/revision and exact integral pack factor are mandatory',()=>{
  const db=create();try{
    seed(db,'OK');seed(db,'FRACTION',1,'25.000000000001');
    seed(db,'OTHER-PACK',1,'24');seed(db,'WIRE',1,'25','Gira');
    seed(db,'BUNDLE',1,'25','Pcs','Bundle');
    for(const input of [row('MISSING'),row('OK',{revision:2}),
      row('OK',{box_conversion_id:'OTHER'}),row('FRACTION'),row('OTHER-PACK'),row('WIRE'),row('BUNDLE')])
      assert.throws(()=>db.prepare(insertSql).run(...values(input)),/mismatch|constraint|revision|pack/i);
    db.prepare(insertSql).run(...values(row('OK')));
    assert.throws(()=>db.prepare(insertSql).run(...values(row('OK'))),/unique/i);
  }finally{db.close();}
});

test('historical measurements cannot be updated, deleted or retargeted',()=>{
  const db=create();try{
    seed(db,'HISTORY');db.prepare(insertSql).run(...values(row('HISTORY')));
    for(const sql of ["UPDATE product_tile_measurement_revisions SET pieces_per_box=24",
      "UPDATE product_tile_measurement_revisions SET product_id='OTHER'",
      "UPDATE product_tile_measurement_revisions SET coverage_policy='manufacturer'",
      'DELETE FROM product_tile_measurement_revisions'])
      assert.throws(()=>db.exec(sql),/immutable/i);
    assert.equal(db.prepare('SELECT pieces_per_box FROM product_tile_measurement_revisions').get().pieces_per_box,25);
    assert.throws(()=>db.exec('DELETE FROM products'),/constraint|foreign key/i);
  }finally{db.close();}
});
