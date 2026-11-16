import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { verifyCatalogMapping, legacyToD1Record } from '../src/db/catalog-mapping.js';

const schema = await readFile(new URL('../migrations/0001_core_catalog.sql', import.meta.url), 'utf8');
const newDB = () => {const db = new DatabaseSync(':memory:'); db.exec(schema); return db;};

// An intentionally minimal fixture; CI additionally tests mapping against all 49 source groups.
const sourceInventory = {tables: [
  {sheetKey: 'SETTINGS', sheetName: 'Settings', columns: ['Key', 'Value']},
  {sheetKey: 'PRODUCT_CATEGORIES', sheetName:'Product Categories', columns: ['Category ID','Category Name','Status','Created At']},
  {sheetKey: 'PRODUCT_UNITS', sheetName:'Product Units', columns: ['Unit ID','Unit Name','Status','Created At']},
  {sheetKey: 'EXPENSE_CATEGORIES', sheetName:'Expense Categories', columns: ['Category ID','Category Name','Description','Status','Created At']},
]};

test('migrations create only the three reviewed master-data tables', () => {
  const db=newDB();
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
  assert.deepEqual(names,['product_categories','product_units','settings']);
  assert.deepEqual(db.prepare("PRAGMA table_info('settings')").all().map(x=>x.name),['row_id','legacy_sheet_row','key','value']);
  db.close();
});

test('settings prevent duplicate keys, empty keys and duplicate legacy rows', () => {
  const db=newDB();
  const ins=db.prepare('INSERT INTO settings (legacy_sheet_row,key,value) VALUES (?,?,?)');
  ins.run(2,'Shop Name','নবাবী');
  assert.equal(db.prepare('SELECT value FROM settings WHERE key=?').get('Shop Name').value,'নবাবী');
  assert.throws(()=>ins.run(3,'Shop Name','Wrong'),/UNIQUE/);
  assert.throws(()=>ins.run(4,'','empty'),/CHECK/);
  assert.throws(()=>ins.run(2,'Tax Percent','0'),/UNIQUE/);
  assert.throws(()=>ins.run(1,'Timezone','Asia\/Dhaka'),/CHECK/);
  db.close();
});

test('category/unit IDs remain unique but labels can be deleted and recreated', () => {
  const db=newDB();
  const cat=db.prepare('INSERT INTO product_categories (category_id, category_name, status, created_at, legacy_sheet_row) VALUES (?,?,?,?,?)');
  cat.run('CAT-000001','Electrical','Active','2026-11-14T12:00:00.000Z',2);
  assert.throws(()=>cat.run('CAT-000001','Other','Active',null,3),/UNIQUE/);
  db.prepare('DELETE FROM product_categories WHERE category_id=?').run('CAT-000001');
  cat.run('CAT-000002','Electrical','Active',null,2);
  const unit=db.prepare('INSERT INTO product_units (unit_id, unit_name, status) VALUES (?,?,?)');
  unit.run('UNT-000001','Pcs','Active');
  assert.throws(()=>unit.run('UNT-000001','Feet','Active'),/UNIQUE/);
  assert.equal(db.prepare('SELECT unit_name FROM product_units WHERE unit_id=?').get('UNT-000001').unit_name,'Pcs');
  db.close();
});

test('catalog mapping covers exactly the original source column names and preserves strings',()=>{
  verifyCatalogMapping(sourceInventory);
  assert.deepEqual(legacyToD1Record('PRODUCT_CATEGORIES',{'Category ID':'CAT-000123','Category Name':'  সাদা LED  ','Status':'Active','Created At':'','_rowIndex':2}),{
    category_id:'CAT-000123',category_name:'  সাদা LED  ',status:'Active',created_at:'',legacy_sheet_row:2
  });
  assert.deepEqual(legacyToD1Record('SETTINGS',{'Key':'Phone 1','Value':'01712345678','_rowIndex':7}), {key:'Phone 1',value:'01712345678',legacy_sheet_row:7});
  assert.deepEqual(legacyToD1Record('SETTINGS',{'Key':'Invoice Show Signature','Value':false}), {key:'Invoice Show Signature',value:'false'});
  assert.throws(()=>legacyToD1Record('SETTINGS',{'Key':'foo','Value':'bar','Unknown':'danger'}),/unexpected/i);
  assert.throws(()=>legacyToD1Record('SETTINGS',{'Key':'foo','Value':{injected:true}}),/unsupported/i);
});

test('mapping rejects a future unreviewed source column or missing reviewed group',()=>{
  assert.throws(()=>verifyCatalogMapping({tables:[...sourceInventory.tables.slice(0,2),{...sourceInventory.tables[2],columns:[...sourceInventory.tables[2].columns,'New Field']}]}),/mismatch/i);
  assert.throws(()=>verifyCatalogMapping({tables:sourceInventory.tables.slice(0,2)}),/missing/i);
});
