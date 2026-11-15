import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createProductMasterOptionsReader} from '../src/modules/product-master-options.js';

function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE product_categories (legacy_sheet_row INTEGER,category_id TEXT,category_name TEXT,status TEXT,created_at TEXT);
    CREATE TABLE product_units (legacy_sheet_row INTEGER,unit_id TEXT,unit_name TEXT,status TEXT,created_at TEXT);
    INSERT INTO product_categories VALUES
      (2,'CAT-A','Electrical','Active',NULL),
      (3,'CAT-B','Old','Inactive',NULL),
      (4,'CAT-C','Electrical','Active',NULL),
      (5,'CAT-D','Lower case','inactive',NULL);
    INSERT INTO product_units VALUES
      (2,'UNT-A','Pcs','Active',NULL),
      (3,'UNT-B','Retired','Inactive',NULL),
      (4,'UNT-C','Feet','Active',NULL);
  `);
  const statements=[];
  const binding={prepare(sql) {
    statements.push(sql);
    const stmt=db.prepare(sql);
    return {bind(...values) {
      return {async all() {return {success:true,results:stmt.all(...values)};}};
    }};
  }};
  return {db,statements,env:{DB:binding}};
}

test('awaits D1 and preserves Products.gs option ID/name projection, physical order and duplicates',async()=>{
  const t=fixture();
  try {
    const result=await createProductMasterOptionsReader(t.env).getOptions();
    assert.deepEqual(result,{
      categories:[{id:'CAT-A',name:'Electrical'},{id:'CAT-C',name:'Electrical'},{id:'CAT-D',name:'Lower case'}],
      units:[{id:'UNT-A',name:'Pcs'},{id:'UNT-C',name:'Feet'}]
    });
    assert.equal(result.categories.some(row=>row.id instanceof Promise),false);
    assert.equal(result.units.some(row=>row.name instanceof Promise),false);
    assert.equal(t.statements.length,2);
    assert(t.statements.every(sql=>/^SELECT\b/i.test(sql)));
    assert(t.statements.every(sql=>/LIMIT\s+\?/i.test(sql)));
    assert(t.statements.every(sql=>!(/settings|products|payments|sales/i.test(sql))));
  }finally{t.db.close();}
});

test('empty categories and units return typed empty arrays, not null or pending promises',async()=>{
  const t=fixture();
  try {
    t.db.exec('DELETE FROM product_categories; DELETE FROM product_units;');
    assert.deepEqual(await createProductMasterOptionsReader(t.env).getOptions(),{categories:[],units:[]});
  }finally{t.db.close();}
});

test('missing D1 binding refuses initialization rather than reading live Sheets or a fallback DB',()=>{
  assert.throws(()=>createProductMasterOptionsReader({}),/D1|binding/i);
  assert.throws(()=>createProductMasterOptionsReader({DB:{}}),/D1|binding/i);
});

test('corrupt physical source row in either catalog fails the complete options request',async()=>{
  const t=fixture();
  try {
    t.db.exec('UPDATE product_categories SET legacy_sheet_row = 17 WHERE category_id = \'CAT-A\'');
    await assert.rejects(()=>createProductMasterOptionsReader(t.env).getOptions(),/legacy|physical|row index/i);
    t.db.exec('UPDATE product_categories SET legacy_sheet_row = 2 WHERE category_id = \'CAT-A\'');
    t.db.exec('UPDATE product_units SET legacy_sheet_row = NULL WHERE unit_id = \'UNT-B\'');
    await assert.rejects(()=>createProductMasterOptionsReader(t.env).getOptions(),/legacy|physical|row index/i);
  }finally{t.db.close();}
});

test('D1 query failure rejects without returning partial category or unit data',async()=>{
  const t=fixture();
  try {
    const broken={DB:{prepare(sql){
      if(sql.includes('product_units')) return {bind:()=>({all:async()=>({success:false,results:[]})})};
      return t.env.DB.prepare(sql);
    }}};
    await assert.rejects(()=>createProductMasterOptionsReader(broken).getOptions(),/D1|result/i);
  }finally{t.db.close();}
});
