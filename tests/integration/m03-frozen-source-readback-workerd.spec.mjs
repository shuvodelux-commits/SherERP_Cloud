import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {createFrozenSourceReadback} from '../../src/db/m03-frozen-source-readback.js';
import {createSealedSourceLookup} from '../../src/db/m03-sealed-source-lookup.js';
import {reviewOfflineSourceParity} from '../../scripts/dry-run-source-parity.mjs';

const source=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const samples=JSON.parse(readFileSync(new URL('../fixtures/m02-source-parity.synthetic.json',import.meta.url),'utf8'));
const server=createTestHarness({workers:[{configPath:'./wrangler.m03-test.jsonc'}]});
const worker=server.getWorker('shererp-m03-workerd-test');
let DB;
let initial;
function sourceData(){
 const groups=Object.fromEntries(source.tables.map(g=>[g.sheetKey,{headers:g.columns,rows:[]}]));
 for(const item of samples.rows){
  const headers=groups[item.group].headers;
  groups[item.group].rows.push({sheetRow:item.sheetRow,cells:headers.map(h=>item.values[h]??'')});
 }
 for(const g of Object.values(groups))g.rows.sort((a,b)=>a.sheetRow-b.sheetRow);
 return {formatVersion:1,sourceCommit:pin,groups};
}
function hash(group,headers,rows){
 return createHash('sha256').update(JSON.stringify([
  'SherERP_M02_offline_source_parity_v1',group,headers,rows.map(r=>[r.sheetRow,r.cells])
 ])).digest('hex');
}
before(async()=>{
 await server.listen();
 await worker.applyD1Migrations('DB');
 ({DB}=await worker.getEnv());
 await DB.prepare("CREATE TABLE m03_private_source_seals(source_commit TEXT NOT NULL,source_group TEXT NOT NULL,headers_json TEXT NOT NULL,expected_rows INTEGER NOT NULL CHECK(expected_rows>=0),source_digest TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('STAGING','SEALED')),PRIMARY KEY(source_commit,source_group)) STRICT").run();
 await DB.prepare("CREATE TABLE m03_private_source_rows(source_commit TEXT NOT NULL,source_group TEXT NOT NULL,legacy_sheet_row INTEGER NOT NULL CHECK(legacy_sheet_row>=2),cells_json TEXT NOT NULL,PRIMARY KEY(source_commit,source_group,legacy_sheet_row),FOREIGN KEY(source_commit,source_group) REFERENCES m03_private_source_seals(source_commit,source_group)) STRICT").run();
 initial=sourceData();
 for(const sourceGroup of source.tables.map(x=>x.sheetKey)){
  const {headers,rows}=initial.groups[sourceGroup];
  await DB.prepare('INSERT INTO m03_private_source_seals VALUES (?,?,?,?,?,?)')
   .bind(pin,sourceGroup,JSON.stringify(headers),rows.length,hash(sourceGroup,headers,rows),'SEALED').run();
  for(const row of rows)await DB.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)')
   .bind(pin,sourceGroup,row.sheetRow,JSON.stringify(row.cells)).run();
 }
});
after(async()=>{await server.close();});

test('real local Workerd D1 reads exact frozen 49 groups and original row hashes',async()=>{
 const actual=await createFrozenSourceReadback({DB}).readAllSourceGroups();
 assert.equal(Object.keys(actual.groups).length,49);
 assert.deepEqual(actual,initial);
 const parity=reviewOfflineSourceParity({
  schema:source,pinnedSourceCommit:pin,sourceExport:initial,candidateExport:actual
 });
 assert.equal(parity.exactTextParity,true);
 assert.equal(parity.d1Verified,false);
});
test('local Workerd DB readback never writes source archive or exposes a public snapshot API',async()=>{
 const beforeCount=(await DB.prepare('SELECT COUNT(*) AS n FROM m03_private_source_rows').first()).n;
 const adapter=createFrozenSourceReadback({DB});
 await adapter.readAllSourceGroups();
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM m03_private_source_rows').first()).n,beforeCount);
 assert.equal(adapter.productionReady,false);
 assert.equal(adapter.authorizesImport,false);
 assert.equal(adapter.publicRpcEnabled,false);
 const route=await worker.fetch('http://m03.local/__m03_test__/source-archive');
 assert.equal(route.status,404);
});
test('real local Workerd fails redacted on forged source-money row without changing data',async()=>{
 const row=await DB.prepare("SELECT legacy_sheet_row,cells_json FROM m03_private_source_rows WHERE source_group='PRODUCTS' LIMIT 1").first();
 const names=initial.groups.PRODUCTS.headers,cells=JSON.parse(row.cells_json);
 const originalPrice=cells[names.indexOf('Purchase Price')];
 cells[names.indexOf('Purchase Price')]='0.00';
 await DB.prepare("UPDATE m03_private_source_rows SET cells_json=? WHERE source_group='PRODUCTS' AND legacy_sheet_row=?")
  .bind(JSON.stringify(cells),row.legacy_sheet_row).run();
 await assert.rejects(()=>createFrozenSourceReadback({DB}).readAllSourceGroups(),e=>{
  assert.equal(e.message,'Invalid or incomplete private M03 source archive');
  assert.equal(e.message.includes('PRODUCTS'),false);
  return true;
 });
 cells[names.indexOf('Purchase Price')]=originalPrice;
 await DB.prepare("UPDATE m03_private_source_rows SET cells_json=? WHERE source_group='PRODUCTS' AND legacy_sheet_row=?")
  .bind(JSON.stringify(cells),row.legacy_sheet_row).run();
});
test('unsealed historical record or missing group never becomes accepted Workerd readback',async()=>{
 await DB.prepare("UPDATE m03_private_source_seals SET status='STAGING' WHERE source_group='CUSTOMERS'").run();
 await assert.rejects(()=>createFrozenSourceReadback({DB}).readAllSourceGroups(),/Invalid or incomplete private M03 source archive/);
 await DB.prepare("UPDATE m03_private_source_seals SET status='SEALED' WHERE source_group='CUSTOMERS'").run();
});

test('real local Workerd D1 opens private 49-group source-shaped awaited snapshot with exact provenance',async()=>{
 const adapter=createSealedSourceLookup({DB});
 const snapshot=await adapter.openSnapshot_();
 assert.equal((await snapshot.getSheetHeaders_('PRODUCTS')).length,19);
 for(const group of source.tables){
  const rows=await snapshot.getAllRows_(group.sheetKey);
  assert.equal(rows.length,initial.groups[group.sheetKey].rows.length,group.sheetKey);
  assert.deepEqual(await snapshot.getSheetHeaders_(group.sheetKey),group.columns);
  for(let i=0;i<rows.length;i++){
   const original=initial.groups[group.sheetKey].rows[i],converted=rows[i];
   assert.equal(converted._rowIndex,original.sheetRow);
   assert.deepEqual(group.columns.map(name=>converted[name]),original.cells);
  }
 }
 const h=initial.groups.PRODUCTS.headers;
 const product=initial.groups.PRODUCTS.rows[0];
 const id=product.cells[h.indexOf('Product ID')];
 const found=await snapshot.findRow_('PRODUCTS','Product ID',id);
 assert.equal(found.rowIndex,product.sheetRow);
 assert.equal(found.row['Product ID'],id);
 assert.equal((await snapshot.findRows_('PRODUCTS','Product ID',id)).length,1);
 await assert.rejects(()=>snapshot.getAllRows_('suppliers'),/source|unsupported|group/i);
 const publicPage=await worker.fetch('http://m03.local/__m03_test__/source-lookup');
 assert.equal(publicPage.status,404);
});

test('real local Workerd D1 reads 1001 sealed LOGS rows over keyset pages and detects forged tail',async()=>{
 // Run after the original four tests so they retain their frozen initial state.
 const group='LOGS',headers=initial.groups.LOGS.headers;
 await DB.prepare("DELETE FROM m03_private_source_rows WHERE source_group='LOGS'").run();
 const rows=Array.from({length:1001},(_,i)=>({
  sheetRow:i+2+(i>=512?3:0),
  cells:['2026-11-17T12:30:00+06:00','QA-only','বাংলা ledger text '+i]
 }));
 const INSERT='INSERT INTO m03_private_source_rows VALUES (?,?,?,?)';
 let batch=[];
 for(const row of rows){
  batch.push(DB.prepare(INSERT).bind(pin,group,row.sheetRow,JSON.stringify(row.cells)));
  if(batch.length===50){
   await DB.batch(batch);
   batch=[];
  }
 }
 if(batch.length)await DB.batch(batch);
 const seal=hash(group,headers,rows);
 await DB.prepare("UPDATE m03_private_source_seals SET expected_rows=?,source_digest=? WHERE source_group='LOGS'")
  .bind(rows.length,seal).run();
 const archive=await createFrozenSourceReadback({DB}).readAllSourceGroups();
 assert.deepEqual(archive.groups.LOGS.rows,rows);
 assert.equal(archive.groups.LOGS.rows[512].sheetRow,517);
 assert.equal(Object.keys(archive.groups).length,49);
 const snapshot=sourceData();snapshot.groups.LOGS.rows=rows;
 assert.equal(reviewOfflineSourceParity({
  schema:source,pinnedSourceCommit:pin,sourceExport:snapshot,candidateExport:archive
 }).exactTextParity,true);
 // An undeclared extra row must not be silently dropped when the caller
 // believes all source rows have been read.
 await DB.prepare("UPDATE m03_private_source_seals SET expected_rows=?,source_digest=? WHERE source_group='LOGS'")
  .bind(1000,hash(group,headers,rows.slice(0,1000))).run();
 await assert.rejects(()=>createFrozenSourceReadback({DB}).readAllSourceGroups(),
  /Invalid or incomplete private M03 source archive/);
 await DB.prepare("UPDATE m03_private_source_seals SET expected_rows=?,source_digest=? WHERE source_group='LOGS'")
  .bind(rows.length,seal).run();
});
