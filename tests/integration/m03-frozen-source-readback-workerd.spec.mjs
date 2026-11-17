import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createTestHarness} from 'wrangler';
import {createFrozenSourceReadback} from '../../src/db/m03-frozen-source-readback.js';
import {createSealedSourceLookup} from '../../src/db/m03-sealed-source-lookup.js';
import {createM03PrivateIdEvidenceReconciler} from '../../src/db/m03-private-id-evidence-reconcile.js';
import {createM03PrivateSourceFloorAudit} from '../../src/db/m03-private-source-floor-audit.js';
import {createM03PrivateSourceFloorInstaller} from '../../src/db/m03-private-source-floor-install.js';
import {M02_ID_FAMILIES} from '../../scripts/dry-run-id-floor.mjs';
import {captureM02IdEvidenceFreeze} from '../../scripts/dry-run-id-evidence-freeze.mjs';
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

 // M03 #544 proposed SQL is NOT a deployed migration. Prove the unchanged
 // proposal's triggers under actual disposable local Workerd/D1, after all
 // earlier five-case prerequisites have completed. Do not alter the number
 // of test cases; the M11 six-shard coverage oracle expects exactly five.
 await DB.prepare('DROP TABLE m03_private_source_rows').run();
 await DB.prepare('DROP TABLE m03_private_source_seals').run();
 const reviewedSql=readFileSync(new URL('../../docs/schema/m03-private-source-archive.proposed.sql',import.meta.url),'utf8');
 assert.match(reviewedSql,/CREATE TRIGGER trg_m03_private_seal_validate_count/);
 assert.match(reviewedSql,/CREATE TRIGGER trg_m03_private_row_delete_staging_only/);
 // D1.exec splits SQL scripts on internal trigger semicolons, unlike local
 // Node SQLite db.exec; replay exactly the reviewed ten complete statements.
 // The remainder check rejects silently ignored future SQL/provenance edits.
 const executable=reviewedSql.replace(/^\s*--[^\n]*(?:\n|$)/gm,'');
 const ddlPattern=/CREATE TABLE[\s\S]*?\)\s+STRICT;|CREATE TRIGGER[\s\S]*?\bEND;/g;
 const statements=[...executable.matchAll(ddlPattern)].map(match=>match[0]);
 assert.equal(statements.length,10,'two strict tables plus eight source-immutability triggers');
 assert.equal(executable.replace(ddlPattern,'').trim(),'','no source archive DDL may be skipped');
 for(const sql of statements)await DB.prepare(sql).run();

 const staged=sourceData();
 staged.groups.LOGS.rows=rows;
 // The source-parity fixture deliberately has arbitrary original-ID strings.
 // Use independent synthetic canonical IDs for this final Run 5 D1 gate.
 for(const family of M02_ID_FAMILIES){
  const group=staged.groups[family.sourceGroup];
  group.rows.forEach((r,i)=>{r.cells[0]=family.prefix+'-'+String(i+1).padStart(6,'0');});
 }
 for(const sheet of source.tables){
  const sourceGroup=sheet.sheetKey;
  const {headers:fields,rows:original}=staged.groups[sourceGroup];
  await DB.prepare('INSERT INTO m03_private_source_seals VALUES (?,?,?,?,?,?)')
   .bind(pin,sourceGroup,JSON.stringify(fields),original.length,
    hash(sourceGroup,fields,original),'STAGING').run();
  // An attempt to seal before all original physical rows exist must fail.
  if(sourceGroup==='PRODUCTS'){
   assert.ok(original.length>0,'frozen PRODUCTS synthetic source must contain an original row');
   await assert.rejects(()=>DB.prepare(
    "UPDATE m03_private_source_seals SET status='SEALED' WHERE source_group='PRODUCTS'"
   ).run());
  }
  let page=[];
  for(const item of original){
   page.push(DB.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)')
    .bind(pin,sourceGroup,item.sheetRow,JSON.stringify(item.cells)));
   if(page.length===50){await DB.batch(page);page=[];}
  }
  if(page.length)await DB.batch(page);
  await DB.prepare('UPDATE m03_private_source_seals SET status=? WHERE source_commit=? AND source_group=?')
   .bind('SEALED',pin,sourceGroup).run();
 }
 const sealedArchive=await createFrozenSourceReadback({DB}).readAllSourceGroups();
 assert.deepEqual(sealedArchive,staged);
 assert.equal(sealedArchive.groups.LOGS.rows.length,1001);
 assert.equal(sealedArchive.groups.LOGS.rows[512].sheetRow,517);
 assert.deepEqual(sealedArchive.groups.PRODUCTS.headers,
  source.tables.find(table=>table.sheetKey==='PRODUCTS').columns);
 assert.deepEqual(sealedArchive.groups.CUSTOMERS.headers,
  source.tables.find(table=>table.sheetKey==='CUSTOMERS').columns);
 assert.equal((await DB.prepare(
  "SELECT COUNT(*) AS n FROM m03_private_source_seals WHERE status='SEALED'"
 ).first()).n,49);

 // Every attack exercises SQL constraints/triggers in Workerd, not JS preflight.
 await assert.rejects(()=>DB.prepare(
  'INSERT INTO m03_private_source_rows VALUES (?,?,?,?)'
 ).bind(pin,'LOGS',999999,JSON.stringify(['date','context','forged'])).run());
 await assert.rejects(()=>DB.prepare(
  "UPDATE m03_private_source_rows SET cells_json='[]' WHERE source_group='PRODUCTS'"
 ).run());
 await assert.rejects(()=>DB.prepare(
  "DELETE FROM m03_private_source_rows WHERE source_group='PRODUCTS'"
 ).run());
 await assert.rejects(()=>DB.prepare(
  "UPDATE m03_private_source_seals SET status='STAGING' WHERE source_group='LOGS'"
 ).run());
 await assert.rejects(()=>DB.prepare(
  "UPDATE m03_private_source_seals SET source_digest=? WHERE source_group='LOGS'"
 ).bind('0'.repeat(64)).run());
 await assert.rejects(()=>DB.prepare(
  "DELETE FROM m03_private_source_seals WHERE source_group='LOGS'"
 ).run());
 await assert.rejects(()=>DB.prepare(
  'INSERT INTO m03_private_source_rows VALUES (?,?,?,?)'
 ).bind(pin,'LOGS',rows[0].sheetRow,JSON.stringify(rows[0].cells)).run());
 assert.deepEqual(await createFrozenSourceReadback({DB}).readAllSourceGroups(),staged);
 const archiveRoute=await worker.fetch('http://m03.local/__m03_test__/source-archive');
 assert.equal(archiveRoute.status,404);

 // Run 5: re-read all 49 sealed groups from real local D1. The M02 salted
 // commitments come from separate synthetic ID/Property evidence, not D1.
 const idEvidence={
  formatVersion:1,sourceCommit:pin,groups:{},counters:{},declaredSourceCounts:{}
 };
 for(const family of M02_ID_FAMILIES){
  const group=staged.groups[family.sourceGroup];
  idEvidence.groups[family.sourceGroup]=group.rows.map(r=>({
   sheetRow:r.sheetRow,id:r.cells[0]
  }));
  idEvidence.counters[family.sourceGroup]=String(group.rows.length+3);
  idEvidence.declaredSourceCounts[family.sourceGroup]=group.rows.length;
 }
 const freezeManifest=captureM02IdEvidenceFreeze({
  schema:source,pinnedSourceCommit:pin,evidence:idEvidence,salt:'ac'.repeat(32)
 });
 const reviewer=createM03PrivateIdEvidenceReconciler({DB});
 const beforeCount=(await DB.prepare('SELECT COUNT(*) AS n FROM m03_private_source_rows').first()).n;
 const status=await reviewer.reconcile_({idEvidence,freezeManifest});
 assert.equal(status.localD1ArchiveMatchesSuppliedIdFreeze,true);
 assert.equal(status.independentSourceCaptureVerified,false);
 assert.equal(status.sourceToD1Reconciled,false);
 assert.equal(status.idIssuanceAuthorized,false);
 assert.equal(status.productionReady,false);
 const tampered=structuredClone(idEvidence);
 tampered.counters.SALES='77';
 await assert.rejects(()=>reviewer.reconcile_({
  idEvidence:tampered,freezeManifest
 }),/M03 private original ID evidence rejected/);
 const falseRows=structuredClone(idEvidence);
 falseRows.groups.PRODUCTS[0].id='PRD-000099';
 await assert.rejects(()=>reviewer.reconcile_({
  idEvidence:falseRows,freezeManifest
 }),/M03 private original ID evidence rejected/);
 // M03 Run 6: fresh, tenant-bound original high-water floors. This
 // locally created fixture is NEVER a reviewed production migration.
 await DB.prepare(
  'CREATE TABLE synthetic_m03_id_counters ('+
  'tenant_id TEXT NOT NULL,id_key TEXT NOT NULL,prefix TEXT NOT NULL,'+
  'current_sequence INTEGER NOT NULL,PRIMARY KEY(tenant_id,id_key)) STRICT'
 ).run();
 await DB.prepare(
  'CREATE TABLE synthetic_m03_id_receipts ('+
  'tenant_id TEXT NOT NULL,id_key TEXT NOT NULL,operation_id TEXT NOT NULL,'+
  'issued_sequence INTEGER NOT NULL,PRIMARY KEY(tenant_id,id_key,operation_id)) STRICT'
 ).run();
 const floorSeed='INSERT INTO synthetic_m03_id_counters VALUES (?,?,?,?)';
 for(const family of M02_ID_FAMILIES){
  const group=family.sourceGroup, prefix=family.prefix;
  const highest=idEvidence.groups[group].reduce((max,item)=>
   Math.max(max,Number(item.id.slice(prefix.length+1))),0);
  await DB.prepare(floorSeed).bind('TENANT-A',group,prefix,
   Math.max(highest,Number(idEvidence.counters[group]))).run();
 }
 const floorAudit=createM03PrivateSourceFloorAudit({DB},'TENANT-A');
 const floorArgs={idEvidence,freezeManifest};
 const audited=await floorAudit.auditFreshSeed_(floorArgs);
 assert.equal(audited.exactFreshSyntheticD1CounterFloors,true);
 assert.equal(audited.idIssuanceAuthorized,false);
 assert.equal(audited.productionReady,false);
 await DB.prepare(
  "UPDATE synthetic_m03_id_counters SET current_sequence=0 WHERE tenant_id='TENANT-A' AND id_key='PRODUCTS'"
 ).run();
 await assert.rejects(()=>floorAudit.auditFreshSeed_(floorArgs),
  /M03 private original ID counter floor rejected/);
 await DB.prepare(
  "UPDATE synthetic_m03_id_counters SET current_sequence=? WHERE tenant_id='TENANT-A' AND id_key='PRODUCTS'"
 ).bind(Number(idEvidence.counters.PRODUCTS)).run();
 await DB.prepare(
  "INSERT INTO synthetic_m03_id_receipts VALUES ('TENANT-A','PRODUCTS','OLD',999)"
 ).run();
 await assert.rejects(()=>floorAudit.auditFreshSeed_(floorArgs),
  /M03 private original ID counter floor rejected/);
 await DB.prepare("DELETE FROM synthetic_m03_id_receipts").run();
 await assert.rejects(()=>createM03PrivateSourceFloorAudit({DB},'TENANT-B')
  .auditFreshSeed_(floorArgs),/M03 private original ID counter floor rejected/);

 // Run 7: use the same already-sharded real local D1 fixture to test the
 // single-statement, 38-family synthetic seed. No production migrations.
 await DB.prepare(
  "DELETE FROM synthetic_m03_id_counters WHERE tenant_id='TENANT-A'"
 ).run();
 const floorInstaller=createM03PrivateSourceFloorInstaller({DB},'TENANT-A');
 const seeded=await floorInstaller.installFreshSynthetic_(floorArgs);
 assert.equal(seeded.localSyntheticD1FloorsInstalled,true);
 assert.equal(seeded.idIssuanceAuthorized,false);
 assert.equal(seeded.publicRpcEnabled,false);
 assert.equal(seeded.productionReady,false);
 assert.equal((await DB.prepare(
  "SELECT COUNT(*) AS n FROM synthetic_m03_id_counters WHERE tenant_id='TENANT-A'"
 ).first()).n,38);
 assert.deepEqual(await floorInstaller.installFreshSynthetic_(floorArgs),seeded,
  'stable replay cannot consume an ID or mutate a counter');
 const firstFloor=(await DB.prepare(
  "SELECT current_sequence AS n FROM synthetic_m03_id_counters WHERE tenant_id='TENANT-A' AND id_key='PRODUCTS'"
 ).first()).n;
 assert.equal(firstFloor,Number(idEvidence.counters.PRODUCTS));
 // Partial pre-existing seed blocks all remaining family INSERTs.
 await DB.prepare(
  "DELETE FROM synthetic_m03_id_counters WHERE tenant_id='TENANT-A' AND id_key!='PRODUCTS'"
 ).run();
 await assert.rejects(()=>floorInstaller.installFreshSynthetic_(floorArgs),
  /M03 private source ID floor installation rejected/);
 assert.equal((await DB.prepare(
  "SELECT COUNT(*) AS n FROM synthetic_m03_id_counters WHERE tenant_id='TENANT-A'"
 ).first()).n,1);
 await DB.prepare(
  "DELETE FROM synthetic_m03_id_counters WHERE tenant_id='TENANT-A'"
 ).run();
 // SQL-trigger failure must roll back the entire 38-row statement in D1.
 await DB.prepare(
  "CREATE TRIGGER synthetic_run7_abort BEFORE INSERT ON synthetic_m03_id_counters "+
  "WHEN NEW.id_key='PRODUCT_UNITS' BEGIN SELECT RAISE(ABORT,'injected seed error'); END"
 ).run();
 await assert.rejects(()=>floorInstaller.installFreshSynthetic_(floorArgs),
  /M03 private source ID floor installation rejected/);
 assert.equal((await DB.prepare(
  "SELECT COUNT(*) AS n FROM synthetic_m03_id_counters WHERE tenant_id='TENANT-A'"
 ).first()).n,0);
 await DB.prepare('DROP TRIGGER synthetic_run7_abort').run();
 assert.equal((await floorInstaller.installFreshSynthetic_(floorArgs)).localSyntheticD1FloorsInstalled,true);

 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM m03_private_source_rows').first()).n,beforeCount);
});
