import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const read=(name)=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
function create(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(read('0001_core_catalog.sql'));
 db.exec(read('0012_legacy_product_snapshots.sql'));
 db.exec(read('0013_product_catalog_revisions.sql'));
 return db;
}
test('M02 0013 additive STRICT operational catalog has no public routes and no new DB seed',()=>{
 const db=create();
 try{
  for(const table of ['products','product_unit_profiles','product_unit_conversions']){
   assert.equal(db.prepare("PRAGMA table_list('"+table+"')").get().strict,1);
   assert.equal(db.prepare("SELECT count(*) n FROM "+table).get().n,0);
  }
  assert.match(read('0013_product_catalog_revisions.sql'),/CREATE TABLE products/);
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(rpc,/product_unit_profiles|product_unit_conversions/);
 }finally{db.close();}
});
test('canonical products require exact frozen source profile, ID and physical sheet row',()=>{
 const db=create();
 try{
  db.prepare("INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id,unit_text) VALUES ('canonical',2,'P-001','Gira')").run();
  const insert=db.prepare("INSERT INTO products(product_id,source_profile,source_snapshot_row_id,legacy_sheet_row,product_name,base_unit_name) VALUES(?,?,?,?,?,?)");
  assert.throws(()=>insert.run('P-OTHER','canonical',1,2,'Wire','Gira'),/provenance|source|mismatch/i);
  assert.throws(()=>insert.run('P-001','canonical',1,3,'Wire','Gira'),/provenance|source|mismatch/i);
  assert.throws(()=>insert.run('P-001','canonical',1,2,'Wire','Feet'),/provenance|source|mismatch/i);
  assert.throws(()=>insert.run('P-001','canonical',null,2,'Wire','Gira'),/provenance|source|mismatch|check|not null/i);
  insert.run('P-001','canonical',1,2,'তার','Gira');
  assert.throws(()=>db.prepare("UPDATE products SET base_unit_name='Feet' WHERE product_id='P-001'").run(),/sealed|immutable/i);
  assert.throws(()=>db.prepare("UPDATE products SET product_id='P-OTHER' WHERE product_id='P-001'").run(),/sealed|immutable/i);
  assert.throws(()=>insert.run('P-001','canonical',1,2,'Wire','Gira'),/unique/i);
 }finally{db.close();}
});
test('new products cannot forge source rows; historical units survive Unit master removal',()=>{
 const db=create();
 try{
  db.prepare("INSERT INTO product_units(unit_id,unit_name,status) VALUES ('PUNT-1','Gira','Active')").run();
  const stmt=db.prepare("INSERT INTO products(product_id,source_profile,legacy_sheet_row,source_snapshot_row_id,product_name,base_unit_name,base_unit_id,barcode_text) VALUES (?,?,?,?,?,?,?,?)");
  assert.throws(()=>stmt.run('P-FAKE','new',2,null,'Wire','Gira','PUNT-1','0001'),/check/i);
  assert.throws(()=>stmt.run('P-FAKE','new',null,1,'Wire','Gira','PUNT-1','0001'),/check/i);
  stmt.run('P-NEW','new',null,null,'তার','Gira','PUNT-1','0001');
  db.prepare("DELETE FROM product_units WHERE unit_id='PUNT-1'").run();
  const preserved=db.prepare("SELECT base_unit_name,base_unit_id,barcode_text FROM products WHERE product_id='P-NEW'").get();
  assert.equal(preserved.base_unit_name,'Gira');
  assert.equal(preserved.base_unit_id,null);
  assert.equal(preserved.barcode_text,'0001');
 }finally{db.close();}
});
test('immutable profile and conversion revisions protect historical factors and independent prices',()=>{
 const db=create();
 try{
  db.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name) VALUES('P1','new','Gauge Wire','Gira')").run();
  assert.throws(()=>db.prepare("UPDATE products SET current_unit_revision=1 WHERE product_id='P1'").run(),/revision|missing/i);
  db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name,selling_anchor_unit_name,stock_view_unit_name) VALUES ('P1',1,'Gira','Gauge','Gira','Gauge')").run();
  const conv=db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,relation_qty_text,relation_unit_name,purchase_price_override_text,selling_price_override_text) VALUES(?,?,?,?,?,?,?,?,?)");
  conv.run('P1',1,'C-Gauge','Gauge','16.000','16','Gira','400.000','500.00');
  assert.throws(()=>conv.run('P1',1,'C-Box','gauge','20','20','Gira','400','500'),/unique/i);
  assert.throws(()=>conv.run('P1',2,'C-NoProfile','Box','20','20','Gira','400','500'),/foreign key/i);
  assert.throws(()=>conv.run('P1',1,'C-Bad','Bag','-1','1','Gira','100','200'),/check/i);
  db.prepare("UPDATE products SET current_unit_revision=1 WHERE product_id='P1'").run();
  assert.equal(db.prepare("SELECT current_unit_revision FROM products WHERE product_id='P1'").get().current_unit_revision,1);
  assert.throws(()=>db.prepare("UPDATE product_unit_conversions SET factor_text='40' WHERE conversion_id='C-Gauge'").run(),/immutable/i);
  assert.throws(()=>db.prepare("DELETE FROM product_unit_conversions").run(),/immutable/i);
  assert.throws(()=>db.prepare("UPDATE product_unit_profiles SET stock_unit_name='Feet'").run(),/immutable/i);
  assert.throws(()=>db.prepare("DELETE FROM product_unit_profiles").run(),/immutable/i);
  assert.throws(()=>db.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='P1'").run(),/revision|missing/i);
  db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES ('P1',2,'Gira')").run();
  db.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='P1'").run();
  assert.equal(db.prepare("SELECT factor_text FROM product_unit_conversions WHERE product_id='P1' AND revision=1").get().factor_text,'16.000');
 }finally{db.close();}
});
test('product config does not auto-link older supplementary archive or rewrite legacy stock',()=>{
 const db=create();
 try{
  db.prepare("INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id,unit_text,current_stock_text) VALUES('supplementary',2,'P1','Gira','37.000')").run();
  assert.throws(()=>db.prepare("INSERT INTO products(product_id,source_profile,source_snapshot_row_id,legacy_sheet_row,product_name,base_unit_name) VALUES ('P1','canonical',1,2,'Wire','Gira')").run(),/provenance|mismatch|source/i);
  assert.equal(db.prepare('SELECT count(*) n FROM products').get().n,0);
  assert.equal(db.prepare("SELECT current_stock_text FROM legacy_product_snapshots WHERE product_id='P1'").get().current_stock_text,'37.000');
 }finally{db.close();}
});
