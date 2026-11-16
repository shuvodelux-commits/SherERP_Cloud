import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {inventorySchema} from '../scripts/inventory-schema.mjs';
import {catalogTables,verifyCatalogMapping,legacyToD1Record} from '../src/db/catalog-mapping.js';

const source=inventorySchema(readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8'));
const originalColumns=['Category ID','Category Name','Description','Status','Created At'];

test('frozen EXPENSE_CATEGORIES maps only its five source columns and preserves descriptive bytes',()=>{
  const entry=source.tables.find(x=>x.sheetKey==='EXPENSE_CATEGORIES');
  assert.deepEqual(entry?.columns,originalColumns);
  assert.deepEqual(catalogTables.EXPENSE_CATEGORIES,{
    table:'expense_categories',
    columns:{
      'Category ID':'category_id','Category Name':'category_name',
      'Description':'description','Status':'status','Created At':'created_at'
    }
  });
  assert.equal(verifyCatalogMapping(source),true);
  assert.deepEqual(legacyToD1Record('EXPENSE_CATEGORIES',{
    'Category ID':'EC-00001','Category Name':'দোকান ভাড়া',
    'Description':'  মাসিক খরচ  ','Status':'Inactive',
    'Created At':'2026-11-16T09:00:00.000Z',_rowIndex:2
  }),{
    category_id:'EC-00001',category_name:'দোকান ভাড়া',
    description:'  মাসিক খরচ  ',status:'Inactive',
    created_at:'2026-11-16T09:00:00.000Z',legacy_sheet_row:2
  });
  assert.throws(()=>legacyToD1Record('EXPENSE_CATEGORIES',{
    'Category ID':'EC-1','Category Name':'Rent','Unknown':'unsafe'
  }),/unexpected/i);
});

test('0005 creates a reviewed STRICT expense master, preserving stable row identity and no finance tables',()=>{
  const sql=readFileSync(new URL('../migrations/0005_expense_categories.sql',import.meta.url),'utf8');
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(sql);
    const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
    assert.deepEqual(names,['expense_categories']);
    assert.deepEqual(db.prepare("PRAGMA table_info('expense_categories')").all().map(x=>x.name),[
      'row_id','legacy_sheet_row','category_id','category_name',
      'description','status','created_at'
    ]);
    assert.equal(db.prepare("PRAGMA table_list('expense_categories')").get().strict,1);
    const insert=db.prepare(`INSERT INTO expense_categories
      (legacy_sheet_row,category_id,category_name,description,status,created_at)
      VALUES (?,?,?,?,?,?)`);
    insert.run(2,'EXP-001','বিদ্যুৎ বিল','আগের মাস','Active','');
    insert.run(3,'EXP-002','বিদ্যুৎ বিল','','Inactive','2026-11-16T00:00:00.000Z');
    const rows=db.prepare('SELECT legacy_sheet_row,category_id,category_name,description,status,created_at FROM expense_categories ORDER BY legacy_sheet_row').all();
    assert.deepEqual(rows,[
      {legacy_sheet_row:2,category_id:'EXP-001',category_name:'বিদ্যুৎ বিল',
       description:'আগের মাস',status:'Active',created_at:''},
      {legacy_sheet_row:3,category_id:'EXP-002',category_name:'বিদ্যুৎ বিল',
       description:'',status:'Inactive',created_at:'2026-11-16T00:00:00.000Z'}
    ]);
    assert.throws(()=>insert.run(4,'EXP-001','Other','','Active',''),/UNIQUE/i);
    assert.throws(()=>insert.run(2,'EXP-003','Other','','Active',''),/UNIQUE/i);
    assert.throws(()=>insert.run(1,'EXP-004','Other','','Active',''),/CHECK/i);
    assert.throws(()=>insert.run(4,'','Other','','Active',''),/CHECK/i);
    assert.throws(()=>insert.run(4,'EXP-004','  ','','Active',''),/CHECK/i);
    assert.throws(()=>insert.run(4,'EXP-004','Other','','Deleted',''),/CHECK/i);
    const id=db.prepare("SELECT row_id FROM expense_categories WHERE category_id='EXP-001'").get().row_id;
    db.prepare("UPDATE expense_categories SET category_name='ভাড়া',status='Inactive' WHERE category_id='EXP-001'").run();
    assert.equal(db.prepare("SELECT row_id FROM expense_categories WHERE category_id='EXP-001'").get().row_id,id);
  } finally {db.close();}
});