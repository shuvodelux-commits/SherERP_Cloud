import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createFrozenSourceReadback} from '../src/db/m03-frozen-source-readback.js';
import {FROZEN_SOURCE_COLUMNS,FROZEN_SOURCE_COMMIT} from '../src/db/m03-frozen-source-headers.js';
import {reviewOfflineSourceParity} from '../scripts/dry-run-source-parity.mjs';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/m02-source-parity.synthetic.json',import.meta.url),'utf8'));
const DDL=[
 "CREATE TABLE m03_private_source_seals(source_commit TEXT NOT NULL,source_group TEXT NOT NULL,headers_json TEXT NOT NULL,expected_rows INTEGER NOT NULL CHECK(expected_rows>=0),source_digest TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('STAGING','SEALED')),PRIMARY KEY(source_commit,source_group)) STRICT;",
 "CREATE TABLE m03_private_source_rows(source_commit TEXT NOT NULL,source_group TEXT NOT NULL,legacy_sheet_row INTEGER NOT NULL CHECK(legacy_sheet_row>=2),cells_json TEXT NOT NULL,PRIMARY KEY(source_commit,source_group,legacy_sheet_row),FOREIGN KEY(source_commit,source_group) REFERENCES m03_private_source_seals(source_commit,source_group)) STRICT;"
].join('\n');
function original(){
 const groups=Object.fromEntries(schema.tables.map(t=>[t.sheetKey,{headers:[...t.columns],rows:[]}]));
 for(const item of fixture.rows){
  const headers=groups[item.group].headers;
  groups[item.group].rows.push({sheetRow:item.sheetRow,cells:headers.map(h=>Object.hasOwn(item.values,h)?item.values[h]:'')});
 }
 for(const group of Object.values(groups))group.rows.sort((a,b)=>a.sheetRow-b.sheetRow);
 return {formatVersion:1,sourceCommit:pin,groups};
}
function digest(group,headers,rows){
 return createHash('sha256').update(JSON.stringify([
  'SherERP_M02_offline_source_parity_v1',group,headers,
  rows.map(row=>[row.sheetRow,row.cells])
 ])).digest('hex');
}
function fixtureDb(input=original()){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON');sql.exec(DDL);
 for(const table of schema.tables){
  const {headers,rows}=input.groups[table.sheetKey];
  sql.prepare('INSERT INTO m03_private_source_seals VALUES (?,?,?,?,?,?)')
   .run(pin,table.sheetKey,JSON.stringify(headers),rows.length,digest(table.sheetKey,headers,rows),'SEALED');
  for(const row of rows)sql.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)')
   .run(pin,table.sheetKey,row.sheetRow,JSON.stringify(row.cells));
 }
 const statements=[];
 const DB={prepare(q){
  statements.push(q);const stmt=sql.prepare(q);
  return {bind(...args){return {async all(){return {success:true,results:stmt.all(...args).map(row=>({...row}))};}};}};
 }};
 return {sql,env:{DB},statements,close:()=>sql.close()};
}
async function withDb(fn){const x=fixtureDb();try{return await fn(x);}finally{x.close();}}
const badText=/Synthetic Rahim|synthetic-password-secret|01700000000|synthetic-hash|private-source-row-secret/;
const errorMsg=/Invalid or incomplete private M03 source archive/;

test('49 frozen source groups and 659 exact headers are compile-time fixed',()=>{
 assert.equal(FROZEN_SOURCE_COMMIT,pin);
 assert.deepEqual(Object.keys(FROZEN_SOURCE_COLUMNS),schema.tables.map(t=>t.sheetKey));
 assert.equal(Object.values(FROZEN_SOURCE_COLUMNS).reduce((n,v)=>n+v.length,0),659);
 for(const t of schema.tables)assert.deepEqual(FROZEN_SOURCE_COLUMNS[t.sheetKey],t.columns);
});
test('awaited D1-shaped snapshot passes M02 exact text and row digest parity',async()=>{
 await withDb(async x=>{
  const adapter=createFrozenSourceReadback(x.env),actual=await adapter.readAllSourceGroups();
  assert.deepEqual(actual,original());
  const p=reviewOfflineSourceParity({schema,pinnedSourceCommit:pin,sourceExport:original(),candidateExport:actual});
  assert.equal(p.exactTextParity,true);
  assert.equal(p.d1Verified,false);
  assert.deepEqual(Object.keys(actual.groups),schema.tables.map(t=>t.sheetKey));
  assert.equal(x.statements.every(s=>s.startsWith('SELECT ')),true);
  assert.equal(x.statements.some(s=>s.includes('SELECT *')),false);
 });
});
test('reading never mutates original rows or converts original strings',async()=>{
 await withDb(async x=>{
  const before=x.sql.prepare('SELECT * FROM m03_private_source_rows ORDER BY source_group,legacy_sheet_row').all();
  const actual=await createFrozenSourceReadback(x.env).readAllSourceGroups();
  assert.deepEqual(x.sql.prepare('SELECT * FROM m03_private_source_rows ORDER BY source_group,legacy_sheet_row').all(),before);
  for(const group of Object.values(actual.groups))
   for(const row of group.rows)assert.ok(row.cells.every(v=>typeof v==='string'));
 });
});
for(const [label,change] of [
 ['missing group',x=>{x.sql.prepare("DELETE FROM m03_private_source_rows WHERE source_group='LOGS'").run();x.sql.prepare("DELETE FROM m03_private_source_seals WHERE source_group='LOGS'").run();}],
 ['unsealed group',x=>x.sql.prepare("UPDATE m03_private_source_seals SET status='STAGING' WHERE source_group='SETTINGS'").run()],
 ['forged count',x=>x.sql.prepare("UPDATE m03_private_source_seals SET expected_rows=888 WHERE source_group='PRODUCTS'").run()],
 ['stale commit',x=>{x.sql.prepare("DELETE FROM m03_private_source_rows WHERE source_group='LOGS'").run();x.sql.prepare("UPDATE m03_private_source_seals SET source_commit='0000000000000000000000000000000000000000' WHERE source_group='LOGS'").run();}],
 ['extra group',x=>x.sql.prepare("INSERT INTO m03_private_source_seals VALUES (?,?,?,?,?,?)").run(pin,'EXTRA_GROUP','[]',0,'a'.repeat(64),'SEALED')],
 ['wrong headers',x=>x.sql.prepare("UPDATE m03_private_source_seals SET headers_json='[\"forged\"]' WHERE source_group='SALES'").run()],
 ['changed seal digest',x=>x.sql.prepare("UPDATE m03_private_source_seals SET source_digest=? WHERE source_group='VENDORS'").run('a'.repeat(64))]
]){
 test('D1 '+label+' blocks source readback without leaking data',async()=>{
  await withDb(async x=>{
   change(x);
   await assert.rejects(()=>createFrozenSourceReadback(x.env).readAllSourceGroups(),e=>{
    assert.match(e.message,errorMsg);assert.doesNotMatch(e.message,badText);return true;
   });
  });
 });
}
test('same-count changed historical price string fails source digest',async()=>{
 await withDb(async x=>{
  const data=x.sql.prepare("SELECT legacy_sheet_row,cells_json FROM m03_private_source_rows WHERE source_group='PRODUCTS'").get();
  const cells=JSON.parse(data.cells_json),headers=schema.tables.find(t=>t.sheetKey==='PRODUCTS').columns;
  cells[headers.indexOf('Purchase Price')]='001.0';
  x.sql.prepare("UPDATE m03_private_source_rows SET cells_json=? WHERE source_group='PRODUCTS' AND legacy_sheet_row=?").run(JSON.stringify(cells),data.legacy_sheet_row);
  await assert.rejects(()=>createFrozenSourceReadback(x.env).readAllSourceGroups(),errorMsg);
 });
});
test('malformed JSON, nonstring cells and row relocation are rejected',async()=>{
 const variants=[
  x=>x.sql.prepare("UPDATE m03_private_source_rows SET cells_json='{bad' WHERE source_group='VENDORS'").run(),
  x=>x.sql.prepare("UPDATE m03_private_source_rows SET cells_json='[123]' WHERE source_group='VENDORS'").run(),
  x=>x.sql.prepare("UPDATE m03_private_source_rows SET legacy_sheet_row=99 WHERE source_group='VENDORS'").run()
 ];
 for(const mutate of variants)await withDb(async x=>{
  mutate(x);await assert.rejects(()=>createFrozenSourceReadback(x.env).readAllSourceGroups(),errorMsg);
 });
});
test('no database binding or corrupted D1 results fail with redacted errors',async()=>{
 assert.throws(()=>createFrozenSourceReadback({}),/D1 database binding unavailable/);
 for(const db of [
  {prepare(){throw new Error('private-source-row-secret');}},
  {prepare(){return {bind(){return {all:async()=>({success:false,results:[]})};}};}},
  {prepare(){return {bind(){return {all:async()=>({success:true,results:[{injected:'x'}]})};}};}}
 ]){
  await assert.rejects(()=>createFrozenSourceReadback({DB:db}).readAllSourceGroups(),e=>{
   assert.match(e.message,errorMsg);assert.doesNotMatch(e.message,badText);return true;
  });
 }
});
test('lost original row cannot pass frozen seal row count',async()=>{
 await withDb(async x=>{
  x.sql.prepare("DELETE FROM m03_private_source_rows WHERE source_group='CUSTOMERS'").run();
  await assert.rejects(()=>createFrozenSourceReadback(x.env).readAllSourceGroups(),errorMsg);
 });
});
test('caller arguments cannot override the frozen 49-group readback scope',async()=>{
 await withDb(async x=>{
  const a=createFrozenSourceReadback(x.env);
  assert.deepEqual(Object.keys(a).sort(),['readAllSourceGroups','productionReady','publicRpcEnabled','authorizesImport'].sort());
  await assert.rejects(()=>a.readAllSourceGroups({sourceGroup:'CUSTOMERS',skipSeals:true}),errorMsg);
  assert.equal(a.productionReady,false);assert.equal(a.publicRpcEnabled,false);assert.equal(a.authorizesImport,false);
 });
});
