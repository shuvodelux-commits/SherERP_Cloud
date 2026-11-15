import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createGuardedCatalogDeleteAdapter} from '../src/db/legacy-catalog-delete.js';
import {createLegacyCatalogReadAdapter} from '../src/db/legacy-catalog-read.js';

const ddl=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const cat=(sourceId,name,status)=>({sourceId,name,status});

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(ddl);
  db.exec(`
    INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES
      ('CAT-A','Electrical','Active',2),('CAT-B','Hardware','Inactive',3),
      ('CAT-C','Hardware Plus','Active',4);
    INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES
      ('UNIT-A','Pcs','Active',2),('UNIT-B','Feet','Active',3);
  `);
  let batchCount=0;
  const DB={
    prepare(sql){
      const prepared=db.prepare(sql);
      return {prepared,args:[],sql,bind(...args){return {prepared,args,sql,async all(){return {success:true,results:prepared.all(...args)}}};}};
    },
    async batch(statements){
      batchCount++;
      db.exec('BEGIN IMMEDIATE');
      try{
        const out=[];
        for(const s of statements){
          const results=s.prepared.all(...s.args);
          const changes=db.prepare('SELECT changes() AS n').get().n;
          out.push({success:true,results,meta:{changes}});
        }
        db.exec('COMMIT');
        return out;
      }catch(err){db.exec('ROLLBACK');throw err;}
    }
  };
  return {db,DB,writer:createGuardedCatalogDeleteAdapter({DB}),reader:createLegacyCatalogReadAdapter({DB}),
    batchCount:()=>batchCount,close:()=>db.close()};
}
const projection=(rows,key)=>rows.map(r=>[r[key],r._rowIndex]);

test('deletes middle physical category row, shifts following rows, keeps source identity',async()=>{
  const x=fixture();
  try{
    assert.equal(await x.writer.deleteRow_('PRODUCT_CATEGORIES',3,cat('CAT-B','Hardware','Inactive')),undefined);
    assert.deepEqual(projection(await x.reader.getAllRows_('PRODUCT_CATEGORIES'),'Category ID'),[['CAT-A',2],['CAT-C',3]]);
    assert.equal(await x.reader.findRowIndex_('PRODUCT_CATEGORIES','Category ID','CAT-B'),-1);
    assert.deepEqual(projection(await x.reader.getAllRows_('PRODUCT_UNITS'),'Unit ID'),[['UNIT-A',2],['UNIT-B',3]]);
    assert.equal(x.batchCount(),1);
  }finally{x.close();}
});

test('deletes first and final physical rows, including one-row sheet, without orphaned indexes',async()=>{
  const x=fixture();
  try{
    await x.writer.deleteRow_('PRODUCT_CATEGORIES',2,cat('CAT-A','Electrical','Active'));
    assert.deepEqual(projection(await x.reader.getAllRows_('PRODUCT_CATEGORIES'),'Category ID'),[['CAT-B',2],['CAT-C',3]]);
    await x.writer.deleteRow_('PRODUCT_CATEGORIES',3,cat('CAT-C','Hardware Plus','Active'));
    assert.deepEqual(projection(await x.reader.getAllRows_('PRODUCT_CATEGORIES'),'Category ID'),[['CAT-B',2]]);
    await x.writer.deleteRow_('PRODUCT_CATEGORIES',2,cat('CAT-B','Hardware','Inactive'));
    assert.deepEqual(await x.reader.getAllRows_('PRODUCT_CATEGORIES'),[]);
    await x.writer.deleteRow_('PRODUCT_UNITS',3,cat('UNIT-B','Feet','Active'));
    assert.deepEqual(projection(await x.reader.getAllRows_('PRODUCT_UNITS'),'Unit ID'),[['UNIT-A',2]]);
  }finally{x.close();}
});

test('stale ID/name/status/row preimages and replay fail without shifting or partial deletion',async()=>{
  const x=fixture();
  try{
    for(const [rowIndex,pre] of [
      [3,cat('CAT-A','Hardware','Inactive')],
      [2,cat('CAT-B','Hardware','Inactive')],
      [3,cat('CAT-B','Other','Inactive')],
      [3,cat('CAT-B','Hardware','Active')],
      [10,cat('CAT-B','Hardware','Inactive')]
    ])await assert.rejects(()=>x.writer.deleteRow_('PRODUCT_CATEGORIES',rowIndex,pre),/stale|refus|unsafe|missing/i);
    assert.deepEqual(projection(await x.reader.getAllRows_('PRODUCT_CATEGORIES'),'Category ID'),[['CAT-A',2],['CAT-B',3],['CAT-C',4]]);
    await x.writer.deleteRow_('PRODUCT_CATEGORIES',3,cat('CAT-B','Hardware','Inactive'));
    await assert.rejects(()=>x.writer.deleteRow_('PRODUCT_CATEGORIES',3,cat('CAT-B','Hardware','Inactive')),/stale|refus|unsafe|missing/i);
    assert.deepEqual(projection(await x.reader.getAllRows_('PRODUCT_CATEGORIES'),'Category ID'),[['CAT-A',2],['CAT-C',3]]);
  }finally{x.close();}
});

test('two concurrent identical delete requests cannot both commit the same source ID',async()=>{
  const x=fixture();
  try{
    const results=await Promise.allSettled([
      x.writer.deleteRow_('PRODUCT_CATEGORIES',3,cat('CAT-B','Hardware','Inactive')),
      x.writer.deleteRow_('PRODUCT_CATEGORIES',3,cat('CAT-B','Hardware','Inactive'))
    ]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    assert.deepEqual(projection(await x.reader.getAllRows_('PRODUCT_CATEGORIES'),'Category ID'),[['CAT-A',2],['CAT-C',3]]);
  }finally{x.close();}
});

test('invalid inputs, forged row and forbidden group never start a transaction',async()=>{
  const x=fixture();
  try{
    const bad=[
      ['SETTINGS',2,cat('X','secret','Active')],
      ['SALES',2,cat('INV-1','sales','Active')],
      ['product_categories',2,cat('CAT-A','Electrical','Active')],
      ['PRODUCT_CATEGORIES',1,cat('CAT-A','Electrical','Active')],
      ['PRODUCT_CATEGORIES',1002,cat('CAT-A','Electrical','Active')],
      ['PRODUCT_CATEGORIES','2',cat('CAT-A','Electrical','Active')],
      ['PRODUCT_CATEGORIES',2,cat('','Electrical','Active')],
      ['PRODUCT_CATEGORIES',2,cat('CAT-A','  ','Active')],
      ['PRODUCT_CATEGORIES',2,cat('CAT-A','Electrical',null)],
      ['PRODUCT_CATEGORIES',2,{...cat('CAT-A','Electrical','Active'),other:'x'}],
      ['PRODUCT_CATEGORIES',2,[]],
    ];
    for(const args of bad)await assert.rejects(()=>x.writer.deleteRow_(...args),/unsupported|invalid|required|row|precondition/i);
    assert.equal(x.batchCount(),0);
  }finally{x.close();}
});

test('gapped and NULL physical row provenance refuse deletion',async()=>{
  const x=fixture();
  try{
    x.db.exec("UPDATE product_categories SET legacy_sheet_row=9 WHERE category_id='CAT-C'");
    await assert.rejects(()=>x.writer.deleteRow_('PRODUCT_CATEGORIES',3,cat('CAT-B','Hardware','Inactive')),/refus|unsafe|stale/i);
    x.db.exec("UPDATE product_categories SET legacy_sheet_row=NULL WHERE category_id='CAT-C'");
    await assert.rejects(()=>x.writer.deleteRow_('PRODUCT_CATEGORIES',3,cat('CAT-B','Hardware','Inactive')),/refus|unsafe|stale/i);
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM product_categories').get().n,3);
  }finally{x.close();}
});

test('mid-transaction SQLite trigger failure rolls back deleted row and shifts',async()=>{
  const x=fixture();
  try{
    x.db.exec(`CREATE TRIGGER stop_shift BEFORE UPDATE ON product_categories
      WHEN NEW.legacy_sheet_row > 1002
      BEGIN SELECT RAISE(ABORT,'synthetic-shift-failure'); END`);
    await assert.rejects(()=>x.writer.deleteRow_('PRODUCT_CATEGORIES',3,cat('CAT-B','Hardware','Inactive')),/synthetic-shift-failure/i);
    assert.deepEqual(projection(await x.reader.getAllRows_('PRODUCT_CATEGORIES'),'Category ID'),[['CAT-A',2],['CAT-B',3],['CAT-C',4]]);
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM product_categories').get().n,3);
  }finally{x.close();}
});

test('missing or nontransactional D1 binding refuses initialization',()=>{
  assert.throws(()=>createGuardedCatalogDeleteAdapter({}),/D1|binding/i);
  assert.throws(()=>createGuardedCatalogDeleteAdapter({DB:{prepare(){}}}),/D1|batch|transaction/i);
});
