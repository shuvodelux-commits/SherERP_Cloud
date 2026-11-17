import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {FROZEN_SOURCE_COLUMNS,FROZEN_SOURCE_COMMIT} from '../src/db/m03-frozen-source-headers.js';

const sql=readFileSync(new URL('../docs/schema/m03-archive-v0015.review.sql',import.meta.url),'utf8');
const groups=Object.keys(FROZEN_SOURCE_COLUMNS);
const checksum=(group,rows)=>createHash('sha256').update(JSON.stringify([
 'SherERP_M02_offline_source_parity_v1',
 group,FROZEN_SOURCE_COLUMNS[group],rows.map(x=>[x.sheetRow,x.cells])
])).digest('hex');
const proof=createHash('sha256').update('synthetic-only M10 evidence').digest('hex');
const err=/constraint|forbidden|immutable|deleted|seal|STAGING|SEALED|tenant|scope|group|COUNT|UNIQUE|CHECK|FOREIGN/i;
function fresh(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(sql);
 return db;
}
async function withDb(fn){const db=fresh();try{return await fn(db);}finally{db.close();}}
function batch(db,tenant='TENANT_ALPHA',id='BATCH_1'){
 db.prepare('INSERT INTO m03_archive_batches VALUES (?,?,?,?,?,?)')
  .run(tenant,id,FROZEN_SOURCE_COMMIT,proof,'M10:synthetic-proof-only','STAGING');
}
function rowsFor(group,tag='A'){
 const cols=FROZEN_SOURCE_COLUMNS[group];
 const cells=cols.map((name,i)=>{
  if(name==='Phone')return '01700000000';
  if(name==='Opening Balance')return '-0001.50';
  if(name==='Product ID')return '000-PR-'+tag;
  if(name==='Product Name')return 'বাংলা টাইলস '+tag;
  return 'SOURCE-'+tag+'-'+i;
 });
 return [{sheetRow:9,cells}];
}
function group(db,tenant,id,name,rows=[]){
 db.prepare('INSERT INTO m03_archive_groups VALUES (?,?,?,?,?,?,?)')
  .run(tenant,id,name,JSON.stringify(FROZEN_SOURCE_COLUMNS[name]),rows.length,checksum(name,rows),'STAGING');
 for(const item of rows){
  db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)')
   .run(tenant,id,name,item.sheetRow,JSON.stringify(item.cells));
 }
}
function sealGroup(db,tenant,id,name){
 db.prepare('UPDATE m03_archive_groups SET status=? WHERE tenant_id=? AND batch_id=? AND source_group=?')
  .run('SEALED',tenant,id,name);
}
function sealBatch(db,tenant,id){
 db.prepare('UPDATE m03_archive_batches SET status=? WHERE tenant_id=? AND batch_id=?')
  .run('SEALED',tenant,id);
}
function full(db,tenant='TENANT_ALPHA',id='BATCH_1',tag='A'){
 batch(db,tenant,id);
 for(const g of groups){
  group(db,tenant,id,g,['CUSTOMERS','PRODUCTS'].includes(g)?rowsFor(g,tag):[]);
  sealGroup(db,tenant,id,g);
 }
 sealBatch(db,tenant,id);
}
test('RED v0015: design SQL is nondeployable, strict, additive and source-pinned',async()=>{
 assert.equal(groups.length,49);
 assert.equal(Object.values(FROZEN_SOURCE_COLUMNS).reduce((n,x)=>n+x.length,0),659);
 const names=readdirSync(new URL('../migrations/',import.meta.url));
 assert.ok(!names.some(name=>/^0015_.*archive/i.test(name)),'no numbered archive migration authorized');
 const statements=sql.replace(/^\s*--[^\n]*(?:\n|$)/gm,'');
 assert.doesNotMatch(statements,/\bDROP\s+TABLE\b|\bALTER\s+TABLE\b|\bATTACH\b|\bCREATE\s+VIRTUAL\s+TABLE\b/i);
 await withDb(db=>{
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'm03_archive_%' ORDER BY name")
   .all().map(x=>x.name);
  assert.deepEqual(tables,['m03_archive_batches','m03_archive_groups','m03_archive_rows']);
  for(const name of tables){
   assert.equal(db.prepare('PRAGMA table_list').all().find(x=>x.name===name)?.strict,1);
  }
 });
});
test('RED v0015: two tenants and two batches retain completely separate original provenance',async()=>{
 await withDb(db=>{
  full(db,'TENANT_ALPHA','BATCH_1','A');
  full(db,'TENANT_BETA','BATCH_1','B');
  full(db,'TENANT_ALPHA','BATCH_2','C');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM m03_archive_groups').get().n,147);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM m03_archive_batches WHERE status='SEALED'").get().n,3);
  const product=db.prepare("SELECT legacy_sheet_row,cells_json FROM m03_archive_rows WHERE tenant_id=? AND batch_id=? AND source_group='PRODUCTS'").all('TENANT_BETA','BATCH_1');
  assert.equal(product.length,1);
  assert.equal(product[0].legacy_sheet_row,9);
  const cells=JSON.parse(product[0].cells_json);
  assert.equal(cells[FROZEN_SOURCE_COLUMNS.PRODUCTS.indexOf('Product ID')],'000-PR-B');
  assert.equal(cells[FROZEN_SOURCE_COLUMNS.PRODUCTS.indexOf('Product Name')],'বাংলা টাইলস B');
  assert.equal(JSON.parse(db.prepare("SELECT cells_json FROM m03_archive_rows WHERE tenant_id=? AND batch_id=? AND source_group='CUSTOMERS'").get('TENANT_ALPHA','BATCH_2').cells_json)[FROZEN_SOURCE_COLUMNS.CUSTOMERS.indexOf('Phone')],'01700000000');
 });
});
test('RED v0015: cross-tenant, cross-batch and unknown source group row injection rejected',async()=>{
 await withDb(db=>{
  batch(db,'TENANT_ALPHA','BATCH_1');
  group(db,'TENANT_ALPHA','BATCH_1','PRODUCTS',rowsFor('PRODUCTS'));
  const row=db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)');
  const original=JSON.stringify(rowsFor('PRODUCTS')[0].cells);
  assert.throws(()=>row.run('TENANT_BETA','BATCH_1','PRODUCTS',99,original),err);
  assert.throws(()=>row.run('TENANT_ALPHA','BATCH_2','PRODUCTS',99,original),err);
  assert.throws(()=>row.run('TENANT_ALPHA','BATCH_1','SYNTHETIC_UNLISTED',99,'[]'),err);
  assert.throws(()=>db.prepare('INSERT INTO m03_archive_groups VALUES (?,?,?,?,?,?,?)').run(
   'TENANT_BETA','BATCH_1','LOGS',JSON.stringify(FROZEN_SOURCE_COLUMNS.LOGS),0,checksum('LOGS',[]),'STAGING'),err);
 });
});
test('RED v0015: cannot seal a group with missing rows or seal batch before all 49 groups',async()=>{
 await withDb(db=>{
  batch(db);
  group(db,'TENANT_ALPHA','BATCH_1','LOGS',[]);
  assert.throws(()=>sealBatch(db,'TENANT_ALPHA','BATCH_1'),err);
  const products=rowsFor('PRODUCTS');
  group(db,'TENANT_ALPHA','BATCH_1','PRODUCTS',products);
  db.prepare("DELETE FROM m03_archive_rows WHERE source_group='PRODUCTS'").run();
  assert.throws(()=>sealGroup(db,'TENANT_ALPHA','BATCH_1','PRODUCTS'),err);
  assert.equal(db.prepare("SELECT status FROM m03_archive_groups WHERE source_group='PRODUCTS'").get().status,'STAGING');
  db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)')
   .run('TENANT_ALPHA','BATCH_1','PRODUCTS',products[0].sheetRow,JSON.stringify(products[0].cells));
  sealGroup(db,'TENANT_ALPHA','BATCH_1','PRODUCTS');
  assert.throws(()=>sealBatch(db,'TENANT_ALPHA','BATCH_1'),err);
 });
});
test('RED v0015: post-seal batch, group, and row mutations all fail at SQL layer',async()=>{
 await withDb(db=>{
  full(db);
  const attacks=[
   ()=>db.prepare("UPDATE m03_archive_batches SET tenant_id='TENANT_BETA' WHERE tenant_id='TENANT_ALPHA'").run(),
   ()=>db.prepare("UPDATE m03_archive_batches SET status='STAGING' WHERE tenant_id='TENANT_ALPHA'").run(),
   ()=>db.prepare("UPDATE m03_archive_batches SET source_manifest_digest=?").run('0'.repeat(64)),
   ()=>db.prepare("DELETE FROM m03_archive_batches WHERE tenant_id='TENANT_ALPHA'").run(),
   ()=>db.prepare("UPDATE m03_archive_groups SET source_digest=? WHERE source_group='PRODUCTS'").run('0'.repeat(64)),
   ()=>db.prepare("UPDATE m03_archive_groups SET status='STAGING' WHERE source_group='LOGS'").run(),
   ()=>db.prepare("DELETE FROM m03_archive_groups WHERE source_group='LOGS'").run(),
   ()=>db.prepare("UPDATE m03_archive_rows SET cells_json='[]' WHERE source_group='PRODUCTS'").run(),
   ()=>db.prepare("DELETE FROM m03_archive_rows WHERE source_group='PRODUCTS'").run(),
   ()=>db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)')
    .run('TENANT_ALPHA','BATCH_1','PRODUCTS',10,'[]')
  ];
  for(const attack of attacks)assert.throws(attack,err);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM m03_archive_groups WHERE status='SEALED'").get().n,49);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM m03_archive_rows").get().n,2);
 });
});
test('RED v0015: INSERT OR REPLACE cannot erase a sealed or staging source record',async()=>{
 await withDb(db=>{
  batch(db);
  group(db,'TENANT_ALPHA','BATCH_1','PRODUCTS',rowsFor('PRODUCTS'));
  const replaceBatch=db.prepare('INSERT OR REPLACE INTO m03_archive_batches VALUES (?,?,?,?,?,?)');
  assert.throws(()=>replaceBatch.run('TENANT_ALPHA','BATCH_1',FROZEN_SOURCE_COMMIT,proof,'M10:replacement','STAGING'),err);
  assert.throws(()=>db.prepare('INSERT OR REPLACE INTO m03_archive_groups VALUES (?,?,?,?,?,?,?)')
   .run('TENANT_ALPHA','BATCH_1','PRODUCTS',JSON.stringify(FROZEN_SOURCE_COLUMNS.PRODUCTS),1,checksum('PRODUCTS',rowsFor('PRODUCTS')),'STAGING'),err);
  assert.throws(()=>db.prepare('INSERT OR REPLACE INTO m03_archive_rows VALUES (?,?,?,?,?)')
   .run('TENANT_ALPHA','BATCH_1','PRODUCTS',9,'[]'),err);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM m03_archive_rows").get().n,1);
 });
});
test('RED v0015: stage may remove and reinsert a row but never rewrite physical row identity',async()=>{
 await withDb(db=>{
  batch(db);
  group(db,'TENANT_ALPHA','BATCH_1','PRODUCTS',rowsFor('PRODUCTS'));
  assert.throws(()=>db.prepare("UPDATE m03_archive_rows SET legacy_sheet_row=8 WHERE source_group='PRODUCTS'").run(),err);
  db.prepare("DELETE FROM m03_archive_rows WHERE source_group='PRODUCTS'").run();
  db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)')
   .run('TENANT_ALPHA','BATCH_1','PRODUCTS',9,JSON.stringify(rowsFor('PRODUCTS')[0].cells));
  sealGroup(db,'TENANT_ALPHA','BATCH_1','PRODUCTS');
  assert.throws(()=>db.prepare("DELETE FROM m03_archive_rows WHERE source_group='PRODUCTS'").run(),err);
 });
});
test('RED v0015: invalid batch identity and fabricated digest are rejected',async()=>{
 await withDb(db=>{
  const q=db.prepare('INSERT INTO m03_archive_batches VALUES (?,?,?,?,?,?)');
  assert.throws(()=>q.run('','BATCH_1',FROZEN_SOURCE_COMMIT,proof,'M10:evidence','STAGING'),err);
  assert.throws(()=>q.run('TENANT_ALPHA','',FROZEN_SOURCE_COMMIT,proof,'M10:evidence','STAGING'),err);
  assert.throws(()=>q.run('TENANT_ALPHA','BATCH_2','0000000000000000000000000000000000000000',proof,'M10:evidence','STAGING'),err);
  assert.throws(()=>q.run('TENANT_ALPHA','BATCH_2',FROZEN_SOURCE_COMMIT,'bad','M10:evidence','STAGING'),err);
  assert.throws(()=>q.run('TENANT_ALPHA','BATCH_2',FROZEN_SOURCE_COMMIT,proof,'M10:evidence','SEALED'),err);
 });
});
test('RED v0015: the source manifest digest is an external proof, not independently verified by SQLite',async()=>{
 await withDb(db=>{
  batch(db);
  group(db,'TENANT_ALPHA','BATCH_1','LOGS',[{sheetRow:2,cells:['wrong','synthetic','text']}]);
  sealGroup(db,'TENANT_ALPHA','BATCH_1','LOGS');
  const seal=db.prepare("SELECT source_digest FROM m03_archive_groups WHERE source_group='LOGS'").get();
  assert.equal(seal.source_digest,checksum('LOGS',[{sheetRow:2,cells:['wrong','synthetic','text']}]));
  assert.equal(db.prepare("SELECT status FROM m03_archive_batches WHERE tenant_id='TENANT_ALPHA'").get().status,'STAGING');
  // SQL count and self-supplied digest prove structure, NOT source authenticity.
  // Independent M10/owner evidence and restricted readers remain required.
 });
});
test('RED v0015: a failed source-row insert inside a transaction rolls back all staged rows',async()=>{
 await withDb(db=>{
  batch(db);
  group(db,'TENANT_ALPHA','BATCH_1','PRODUCTS',[]);
  const before=db.prepare("SELECT COUNT(*) AS n FROM m03_archive_rows").get().n;
  db.exec('BEGIN');
  try{
   db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)').run(
    'TENANT_ALPHA','BATCH_1','PRODUCTS',9,JSON.stringify(rowsFor('PRODUCTS')[0].cells));
   assert.throws(()=>db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)').run(
    'TENANT_BETA','BATCH_1','PRODUCTS',10,'[]'),err);
  }finally{db.exec('ROLLBACK');}
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM m03_archive_rows").get().n,before);
 });
});

test('RED v0015: cross-tenant SQL triggers deny forged rows even with foreign_keys OFF',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(sql);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,0);
  batch(db,'TENANT_ALPHA','BATCH_1');
  group(db,'TENANT_ALPHA','BATCH_1','PRODUCTS',[]);
  assert.throws(()=>db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)')
   .run('TENANT_BETA','BATCH_1','PRODUCTS',2,'[]'),err);
  assert.throws(()=>db.prepare('INSERT INTO m03_archive_groups VALUES (?,?,?,?,?,?,?)')
   .run('TENANT_BETA','BATCH_1','LOGS',JSON.stringify(FROZEN_SOURCE_COLUMNS.LOGS),0,checksum('LOGS',[]),'STAGING'),err);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM m03_archive_rows').get().n,0);
 }finally{db.close();}
});
test('RED v0015: source headers and cells require JSON arrays, never objects or malformed JSON',async()=>{
 await withDb(db=>{
  batch(db);
  group(db,'TENANT_ALPHA','BATCH_1','LOGS',[]);
  assert.throws(()=>db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)')
   .run('TENANT_ALPHA','BATCH_1','LOGS',2,'{}'),err);
  assert.throws(()=>db.prepare('INSERT INTO m03_archive_rows VALUES (?,?,?,?,?)')
   .run('TENANT_ALPHA','BATCH_1','LOGS',2,'not-json'),/malformed|JSON|constraint|CHECK/i);
  assert.throws(()=>db.prepare('INSERT INTO m03_archive_groups VALUES (?,?,?,?,?,?,?)')
   .run('TENANT_ALPHA','BATCH_1','CUSTOMERS','{}',0,checksum('CUSTOMERS',[]),'STAGING'),err);
 });
});
