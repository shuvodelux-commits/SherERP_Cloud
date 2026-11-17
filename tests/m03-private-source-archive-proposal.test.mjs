import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {FROZEN_SOURCE_COLUMNS,FROZEN_SOURCE_COMMIT} from '../src/db/m03-frozen-source-headers.js';
import {createFrozenSourceReadback} from '../src/db/m03-frozen-source-readback.js';

const schema=readFileSync(new URL('../docs/schema/m03-private-source-archive.proposed.sql',import.meta.url),'utf8');
const groups=Object.keys(FROZEN_SOURCE_COLUMNS);
const invalid=/constraint|not allowed|FOREIGN KEY|UNIQUE|CHECK|sealed|staging|immutable|source/i;
const sha=group=>createHash('sha256').update(JSON.stringify([
 'SherERP_M02_offline_source_parity_v1',
 group,FROZEN_SOURCE_COLUMNS[group],[]
])).digest('hex');
function canonical(group,rows){
 return createHash('sha256').update(JSON.stringify([
  'SherERP_M02_offline_source_parity_v1',
  group,FROZEN_SOURCE_COLUMNS[group],rows.map(x=>[x.sheetRow,x.cells])
 ])).digest('hex');
}
function cells(group,values={}){
 const columns=FROZEN_SOURCE_COLUMNS[group];
 return columns.map(name=>Object.hasOwn(values,name)?values[name]:'');
}
function fresh(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(schema);
 return db;
}
function stage(db,values={}){
 for(const group of groups){
  const rows=values[group]||[];
  db.prepare('INSERT INTO m03_private_source_seals VALUES (?,?,?,?,?,?)').run(
   FROZEN_SOURCE_COMMIT,group,JSON.stringify(FROZEN_SOURCE_COLUMNS[group]),
   rows.length,canonical(group,rows),'STAGING');
  for(const row of rows){
   db.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)').run(
    FROZEN_SOURCE_COMMIT,group,row.sheetRow,JSON.stringify(row.cells));
  }
 }
}
function seal(db,group){
 db.prepare('UPDATE m03_private_source_seals SET status=? WHERE source_commit=? AND source_group=?')
   .run('SEALED',FROZEN_SOURCE_COMMIT,group);
}
function sealAll(db){for(const group of groups)seal(db,group);}
function dbEnv(db){
 return {DB:{prepare(sql){
  const q=db.prepare(sql);
  return {bind(...args){return {async all(){return {success:true,results:q.all(...args)};}};}};
 }}};
}
const sample={
 PRODUCTS:[{sheetRow:8,cells:cells('PRODUCTS',{
  'Product ID':'000-AB-009','Product Name':'বাংলা টাইলস ১২×১২',
  'Purchase Price':'00012.50','Selling Price':'0017.000','Is Deleted':'TRUE'
 })}],
 CUSTOMERS:[{sheetRow:39,cells:cells('CUSTOMERS',{
  'Customer ID':'0007','Phone':'01700000000','Opening Balance':'-001.00',
  'Current Due':'00103.50','Is Deleted':'FALSE'
 })}],
 LOGS:[{sheetRow:2,cells:cells('LOGS',{
  Timestamp:'2026-11-17T10:00:00+06:00',
  Context:'স্থগিত',Message:'private-synthetic-only'
 })}]
};
async function withDb(fn){const db=fresh();try{return await fn(db);}finally{db.close();}}

test('RED: proposed source archive schema is strict, pinned, local and contains exactly two compatible tables',async()=>{
 assert.equal(groups.length,49);
 assert.equal(Object.values(FROZEN_SOURCE_COLUMNS).reduce((sum,h)=>sum+h.length,0),659);
 const executableSchema=schema.replace(/^\\s*--[^\\n]*(?:\\n|$)/gm,'');
 assert.doesNotMatch(executableSchema,/CREATE\\s+VIEW|CREATE\\s+VIRTUAL\\s+TABLE|\\bATTACH\\b|DROP\\s+TABLE|https?:\\/\\/|public\\s+rpc/i);
 await withDb(db=>{
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'm03_private_source_%' ORDER BY name").all().map(x=>x.name);
  assert.deepEqual(tables,['m03_private_source_rows','m03_private_source_seals']);
  for(const table of tables){
   assert.equal(db.prepare('PRAGMA table_list').all().find(x=>x.name===table)?.strict,1);
  }
 });
});
test('RED: accepts all 49 STAGING groups, exact original strings and gaps, then immutable full-group readback',async()=>{
 await withDb(async db=>{
  stage(db,sample);
  sealAll(db);
  const result=await createFrozenSourceReadback(dbEnv(db)).readAllSourceGroups();
  assert.equal(Object.keys(result.groups).length,49);
  assert.deepEqual(result.groups.PRODUCTS.rows,sample.PRODUCTS);
  assert.deepEqual(result.groups.CUSTOMERS.rows,sample.CUSTOMERS);
  assert.deepEqual(result.groups.LOGS.rows,sample.LOGS);
  assert.equal(result.groups.PRODUCTS.rows[0].cells[0],'000-AB-009');
  assert.equal(result.groups.CUSTOMERS.rows[0].cells[3],'01700000000');
  assert.equal(result.groups.CUSTOMERS.rows[0].cells[5],'-001.00');
  assert.equal(result.groups.PRODUCTS.rows[0].sheetRow,8);
  assert.equal(result.groups.CUSTOMERS.rows[0].sheetRow,39);
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys,1);
 });
});
test('RED: direct sealed import, fabricated commit, unknown group and malformed source cells fail',async()=>{
 await withDb(db=>{
  const s=db.prepare('INSERT INTO m03_private_source_seals VALUES (?,?,?,?,?,?)');
  for(const [commit,group,status] of [
   [FROZEN_SOURCE_COMMIT,'LOGS','SEALED'],
   ['0000000000000000000000000000000000000000','LOGS','STAGING'],
   [FROZEN_SOURCE_COMMIT,'FAKE_GROUP','STAGING']
  ])assert.throws(()=>s.run(commit,group,JSON.stringify(FROZEN_SOURCE_COLUMNS.LOGS),0,sha('LOGS'),status),invalid);
  stage(db);
  const r=db.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)');
  assert.throws(()=>r.run(FROZEN_SOURCE_COMMIT,'LOGS',2,'{broken-json'),invalid);
  assert.throws(()=>r.run(FROZEN_SOURCE_COMMIT,'LOGS',1,'["x"]'),invalid);
  assert.throws(()=>r.run('0000000000000000000000000000000000000000','LOGS',2,'[]'),invalid);
  assert.throws(()=>r.run(FROZEN_SOURCE_COMMIT,'FAKE_GROUP',2,'[]'),invalid);
 });
});
test('RED: a group must be staged fully before it can be sealed',async()=>{
 await withDb(db=>{
  stage(db,sample);
  db.prepare("DELETE FROM m03_private_source_rows WHERE source_group='PRODUCTS'").run();
  assert.throws(()=>seal(db,'PRODUCTS'),invalid);
  assert.equal(db.prepare("SELECT status FROM m03_private_source_seals WHERE source_group='PRODUCTS'").get().status,'STAGING');
  db.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)').run(
   FROZEN_SOURCE_COMMIT,'PRODUCTS',8,JSON.stringify(sample.PRODUCTS[0].cells));
  seal(db,'PRODUCTS');
  assert.equal(db.prepare("SELECT status FROM m03_private_source_seals WHERE source_group='PRODUCTS'").get().status,'SEALED');
 });
});
test('RED: after seal database rejects every source-row or source-seal mutation',async()=>{
 await withDb(db=>{
  stage(db,sample);sealAll(db);
  const row=JSON.stringify(sample.PRODUCTS[0].cells);
  const blocked=[
   ()=>db.prepare("INSERT INTO m03_private_source_rows VALUES (?,?,?,?)").run(FROZEN_SOURCE_COMMIT,'LOGS',99,'[]'),
   ()=>db.prepare("UPDATE m03_private_source_rows SET cells_json=? WHERE source_group='PRODUCTS'").run('[]'),
   ()=>db.prepare("DELETE FROM m03_private_source_rows WHERE source_group='PRODUCTS'").run(),
   ()=>db.prepare("UPDATE m03_private_source_seals SET source_digest=? WHERE source_group='LOGS'").run('a'.repeat(64)),
   ()=>db.prepare("UPDATE m03_private_source_seals SET headers_json=? WHERE source_group='LOGS'").run('[]'),
   ()=>db.prepare("UPDATE m03_private_source_seals SET expected_rows=? WHERE source_group='LOGS'").run(1),
   ()=>db.prepare("UPDATE m03_private_source_seals SET status=? WHERE source_group='LOGS'").run('STAGING'),
   ()=>db.prepare("DELETE FROM m03_private_source_seals WHERE source_group='LOGS'").run(),
   ()=>db.prepare("UPDATE m03_private_source_rows SET source_group=? WHERE source_group='PRODUCTS'").run('LOGS')
  ];
  for(const mutate of blocked)assert.throws(mutate,invalid);
  assert.equal(db.prepare("SELECT cells_json FROM m03_private_source_rows WHERE source_group='PRODUCTS'").get().cells_json,row);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM m03_private_source_seals WHERE status='SEALED'").get().n,49);
 });
});
test('RED: duplicate source sheet row, rewritten row identity, and illegal seal identity fail while staging',async()=>{
 await withDb(db=>{
  stage(db,sample);
  const row=db.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)');
  assert.throws(()=>row.run(FROZEN_SOURCE_COMMIT,'PRODUCTS',8,JSON.stringify(sample.PRODUCTS[0].cells)),invalid);
  assert.throws(()=>db.prepare("UPDATE m03_private_source_rows SET legacy_sheet_row=7 WHERE source_group='PRODUCTS'").run(),invalid);
  assert.throws(()=>db.prepare("UPDATE m03_private_source_seals SET source_group='LOGS' WHERE source_group='PRODUCTS'").run(),invalid);
  assert.throws(()=>db.prepare("UPDATE m03_private_source_seals SET source_commit=? WHERE source_group='PRODUCTS'").run('0000000000000000000000000000000000000000'),invalid);
  // Staging can be restarted by removing an unsealed row, never by reassigning original identity.
  db.prepare("DELETE FROM m03_private_source_rows WHERE source_group='PRODUCTS'").run();
  row.run(FROZEN_SOURCE_COMMIT,'PRODUCTS',8,JSON.stringify(sample.PRODUCTS[0].cells));
  seal(db,'PRODUCTS');
 });
});
test('RED: seal transition cannot silently rewrite expected source counts or digest',async()=>{
 await withDb(db=>{
  stage(db,sample);
  assert.throws(()=>db.prepare(
   "UPDATE m03_private_source_seals SET status='SEALED',expected_rows=0 WHERE source_group='PRODUCTS'"
  ).run(),invalid);
  assert.throws(()=>db.prepare(
   "UPDATE m03_private_source_seals SET status='SEALED',source_digest=? WHERE source_group='PRODUCTS'"
  ).run('0'.repeat(64)),invalid);
  assert.equal(db.prepare("SELECT status FROM m03_private_source_seals WHERE source_group='PRODUCTS'").get().status,'STAGING');
 });
});
test('RED: corrupt but matching-count original values cannot pass canonical private readback after sealing',async()=>{
 await withDb(async db=>{
  stage(db,sample);
  db.prepare("DELETE FROM m03_private_source_rows WHERE source_group='LOGS'").run();
  db.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)')
   .run(FROZEN_SOURCE_COMMIT,'LOGS',2,JSON.stringify(['wrong','different','values']));
  sealAll(db);
  await assert.rejects(()=>createFrozenSourceReadback(dbEnv(db)).readAllSourceGroups(),
   /Invalid or incomplete private M03 source archive/);
 });
});
test('RED: a failing multi-statement SQLite staging transaction rolls back completely',async()=>{
 await withDb(db=>{
  stage(db,sample);
  seal(db,'PRODUCTS');
  const count=db.prepare("SELECT COUNT(*) AS n FROM m03_private_source_rows WHERE source_group='LOGS'").get().n;
  db.exec('BEGIN');
  try{
   db.prepare("INSERT INTO m03_private_source_rows VALUES (?,?,?,?)").run(
    FROZEN_SOURCE_COMMIT,'LOGS',100,JSON.stringify(['t','c','m']));
   assert.throws(()=>db.prepare("DELETE FROM m03_private_source_rows WHERE source_group='PRODUCTS'").run(),invalid);
  }finally{db.exec('ROLLBACK');}
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM m03_private_source_rows WHERE source_group='LOGS'").get().n,count);
 });
});
