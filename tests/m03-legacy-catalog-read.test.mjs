import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createLegacyCatalogReadAdapter} from '../src/db/legacy-catalog-read.js';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE product_categories (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT, legacy_sheet_row INTEGER UNIQUE,
    category_id TEXT NOT NULL, category_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT
  );
  CREATE TABLE product_units (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT, legacy_sheet_row INTEGER UNIQUE,
    unit_id TEXT NOT NULL, unit_name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT
  );
  INSERT INTO product_categories (legacy_sheet_row,category_id,category_name,status,created_at) VALUES
    (2,'CAT-001','Electrical','Active',NULL),
    (3,'CAT-002','দড়ি','Inactive','2026-11-14T17:00:00'),
    (4,'CAT-003','Electrical','Active',NULL);
  INSERT INTO product_units (legacy_sheet_row,unit_id,unit_name,status,created_at) VALUES
    (2,'UNIT-001','Pcs','Active',NULL),
    (3,'UNIT-002','Feet','Active','2026-11-14T18:00:00');`);
  const seen=[];
  const DB={prepare(statement){
    seen.push(statement);
    const prepared=sql.prepare(statement);
    return {bind(...args){return {async all(){return {success:true,results:prepared.all(...args)}}};}};
  }};
  return {sql,DB,seen,adapter:createLegacyCatalogReadAdapter({DB}),close:()=>sql.close()};
}

test('getAllRows_ preserves original Config.gs headers, values, blank cells, and physical _rowIndex',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.adapter.getSheetHeaders_('PRODUCT_CATEGORIES'),['Category ID','Category Name','Status','Created At']);
    assert.deepEqual(await x.adapter.getSheetHeaders_('PRODUCT_UNITS'),['Unit ID','Unit Name','Status','Created At']);
    assert.deepEqual(await x.adapter.getAllRows_('PRODUCT_CATEGORIES'),[
      {'Category ID':'CAT-001','Category Name':'Electrical','Status':'Active','Created At':'',_rowIndex:2},
      {'Category ID':'CAT-002','Category Name':'দড়ি','Status':'Inactive','Created At':'2026-11-14T17:00:00',_rowIndex:3},
      {'Category ID':'CAT-003','Category Name':'Electrical','Status':'Active','Created At':'',_rowIndex:4}
    ]);
    assert.deepEqual(await x.adapter.getAllRows_('PRODUCT_UNITS'),[
      {'Unit ID':'UNIT-001','Unit Name':'Pcs','Status':'Active','Created At':'',_rowIndex:2},
      {'Unit ID':'UNIT-002','Unit Name':'Feet','Status':'Active','Created At':'2026-11-14T18:00:00',_rowIndex:3}
    ]);
    assert(x.seen.every(s=>/^SELECT\s/i.test(s)),'all catalog queries must be read-only');
    assert(x.seen.every(s=>/LIMIT\s+\?/i.test(s)),'all reads must be bounded');
  }finally{x.close();}
});

test('find helpers reproduce source string-coerced exact match and first physical row semantics',async()=>{
  const x=fixture();try{
    assert.equal(await x.adapter.findRowIndex_('PRODUCT_CATEGORIES','Category ID','CAT-002'),3);
    assert.equal(await x.adapter.findRowIndex_('PRODUCT_CATEGORIES','Category ID','missing'),-1);
    assert.deepEqual(await x.adapter.findRow_('PRODUCT_CATEGORIES','Category Name','Electrical'),{
      row:{'Category ID':'CAT-001','Category Name':'Electrical',Status:'Active','Created At':'',_rowIndex:2},rowIndex:2
    });
    assert.deepEqual((await x.adapter.findRows_('PRODUCT_CATEGORIES','Category Name','Electrical')).map(r=>r._rowIndex),[2,4]);
    assert.equal((await x.adapter.findFirstRow_('PRODUCT_UNITS','Unit ID','UNIT-002'))._rowIndex,3);
    assert.equal(await x.adapter.findFirstRow_('PRODUCT_UNITS','Unit ID','not-found'),null);
    assert.equal(await x.adapter.findRow_('PRODUCT_CATEGORIES','Category ID','nope'),null);
  }finally{x.close();}
});

test('unknown sheets and columns fail closed: no Settings, finance, arbitrary SQL or legacy writers',async()=>{
  const x=fixture();try{
    for(const key of ['SETTINGS','PRODUCTS','CUSTOMERS','product_categories',"PRODUCT_CATEGORIES; DROP TABLE parties",'']){
      await assert.rejects(()=>x.adapter.getAllRows_(key),/unavailable|unsupported|allowed/i);
      await assert.rejects(()=>x.adapter.getSheetHeaders_(key),/unavailable|unsupported|allowed/i);
    }
    await assert.rejects(()=>x.adapter.findRowIndex_('PRODUCT_CATEGORIES','Cat ID','CAT-001'),/Column not found/i);
    await assert.rejects(()=>x.adapter.findRows_('PRODUCT_CATEGORIES','Category ID; DROP','CAT-001'),/Column not found|unsupported/i);
    assert.equal(x.adapter.appendRow_,undefined);
    assert.equal(x.adapter.updateRowFields_,undefined);
    assert.equal(x.adapter.deleteRow_,undefined);
    assert(x.seen.every(s=>/^SELECT\s/i.test(s)));
  }finally{x.close();}
});

test('detects missing, gapped or non-physical legacy row indexes rather than returning wrong _rowIndex',async()=>{
  const x=fixture();try{
    x.sql.exec("UPDATE product_categories SET legacy_sheet_row = NULL WHERE category_id='CAT-002'");
    await assert.rejects(()=>x.adapter.getAllRows_('PRODUCT_CATEGORIES'),/legacy.*row|physical.*row|row index/i);
    x.sql.exec("UPDATE product_categories SET legacy_sheet_row = 8 WHERE category_id='CAT-002'");
    await assert.rejects(()=>x.adapter.getAllRows_('PRODUCT_CATEGORIES'),/legacy.*row|physical.*row|row index/i);
  }finally{x.close();}
});

test('never silently truncates a catalog exceeding the explicitly bounded query cap',async()=>{
  const x=fixture();try{
    const insert=x.sql.prepare('INSERT INTO product_units(legacy_sheet_row,unit_id,unit_name,status) VALUES (?,?,?,?)');
    for(let i=4;i<=1002;i++)insert.run(i,'UNIT-'+i,'Name-'+i,'Active');
    await assert.rejects(()=>x.adapter.getAllRows_('PRODUCT_UNITS'),/exceeds|limit|too many/i);
  }finally{x.close();}
});

test('D1 is mandatory and malformed DB results are rejected, never treated as empty',async()=>{
  assert.throws(()=>createLegacyCatalogReadAdapter({}),/D1|binding/i);
  const broken={DB:{prepare:()=>({bind:()=>({all:async()=>({success:false,results:[]})})})}};
  await assert.rejects(()=>createLegacyCatalogReadAdapter(broken).getAllRows_('PRODUCT_UNITS'),/D1|result/i);
  const nullResult={DB:{prepare:()=>({bind:()=>({all:async()=>({success:true,results:[null]})})})}};
  await assert.rejects(()=>createLegacyCatalogReadAdapter(nullResult).getAllRows_('PRODUCT_UNITS'),/row|D1/i);
});
