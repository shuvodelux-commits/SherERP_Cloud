import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createFrozenSourceReadback} from '../src/db/m03-frozen-source-readback.js';
import {createM03PrivateIdEvidenceReconciler} from '../src/db/m03-private-id-evidence-reconcile.js';
import {createM03PrivateSourceFloorAudit} from '../src/db/m03-private-source-floor-audit.js';
import {M02_ID_FAMILIES} from '../scripts/dry-run-id-floor.mjs';
import {captureM02IdEvidenceFreeze} from '../scripts/dry-run-id-evidence-freeze.mjs';

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

function resealSyntheticSourceGroup(x,group,total,{gapAfter=Infinity}={}){
 const headers=schema.tables.find(t=>t.sheetKey===group)?.columns;
 assert.ok(headers);
 x.sql.prepare('DELETE FROM m03_private_source_rows WHERE source_group=?').run(group);
 const insert=x.sql.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)');
 const rows=[];
 for(let i=0;i<total;i++){
  const cells=headers.map((h,j)=>h==='Message'
   ?'বাংলা '+i+' original '+j
   :h==='Timestamp'?'2026-11-17T10:20:00.000+06:00'
    :'synthetic-page-'+i+'-'+j);
  const row={sheetRow:i+2+(i>=gapAfter?3:0),cells};
  rows.push(row);
  insert.run(pin,group,row.sheetRow,JSON.stringify(row.cells));
 }
 const fullDigest=digest(group,headers,rows);
 x.sql.prepare('UPDATE m03_private_source_seals SET expected_rows=?,source_digest=? WHERE source_group=?')
  .run(rows.length,fullDigest,group);
 return rows;
}
test('Super QA / RED: 1001 original rows from a correctly sealed group read back exactly, not truncated',async()=>{
 await withDb(async x=>{
  const group='LOGS';
  const rows=resealSyntheticSourceGroup(x,group,1001,{gapAfter:512});
  const actual=await createFrozenSourceReadback(x.env).readAllSourceGroups();
  assert.deepEqual(actual.groups.LOGS.rows,rows);
  assert.equal(actual.groups.LOGS.rows[512].sheetRow,517);
  assert.equal(actual.groups.LOGS.rows[1000].cells[2],'বাংলা 1000 original 2');
  const source=original();source.groups.LOGS.rows=rows;
  const parity=reviewOfflineSourceParity({schema,pinnedSourceCommit:pin,sourceExport:source,candidateExport:actual});
  assert.equal(parity.exactTextParity,true);
  assert.equal(parity.d1Verified,false);
 });
});
test('RED: 2049 source rows cross nine keyset pages with original row gaps and full digest',async()=>{
 await withDb(async x=>{
  const rows=resealSyntheticSourceGroup(x,'LOGS',2049,{gapAfter:1300});
  const got=await createFrozenSourceReadback(x.env).readAllSourceGroups();
  assert.deepEqual(got.groups.LOGS.rows,rows);
  const r=got.groups.LOGS.rows;
  assert.equal(r.length,2049);
  assert.equal(r[1300].sheetRow,1305);
  assert.equal(got.groups.LOGS.headers.length,3);
  const reads=x.statements.filter(q=>q.includes('FROM m03_private_source_rows')&&q.includes('legacy_sheet_row > ?'));
  assert.ok(reads.length>=10,'must page with a bounded source-row cursor');
  assert.ok(reads.every(q=>!q.includes(' OFFSET ')),'offset paging can skip rows across deletions');
 });
});
test('RED: sealed count cannot under-report an additional original row after page boundaries',async()=>{
 await withDb(async x=>{
  const rows=resealSyntheticSourceGroup(x,'LOGS',1001);
  const headers=schema.tables.find(t=>t.sheetKey==='LOGS').columns;
  x.sql.prepare('UPDATE m03_private_source_seals SET expected_rows=?,source_digest=? WHERE source_group=?')
   .run(1000,digest('LOGS',headers,rows.slice(0,1000)),'LOGS');
  await assert.rejects(()=>createFrozenSourceReadback(x.env).readAllSourceGroups(),errorMsg);
 });
});
test('RED: a removed row in the second page fails whole-group count/digest',async()=>{
 await withDb(async x=>{
  resealSyntheticSourceGroup(x,'LOGS',1001);
  x.sql.prepare('DELETE FROM m03_private_source_rows WHERE source_group=? AND legacy_sheet_row=?')
   .run('LOGS',520);
  await assert.rejects(()=>createFrozenSourceReadback(x.env).readAllSourceGroups(),errorMsg);
 });
});
test('RED: duplicate/out-of-order result row at later keyset page boundary fails redacted',async()=>{
 for(const mode of ['duplicate','backwards']){
  await withDb(async x=>{
   resealSyntheticSourceGroup(x,'LOGS',1001);
   const DB={prepare(sql){
    const query=x.env.DB.prepare(sql);
    return {bind(...args){const stmt=query.bind(...args);return {async all(){
     const response=await stmt.all();
     if(sql.includes('FROM m03_private_source_rows') && args[1]==='LOGS' &&
        args[2]>=2 && response.results.length){
      response.results[0].legacy_sheet_row=mode==='duplicate'?args[2]:args[2]-1;
     }
     return response;
    }};}};
   }};
   await assert.rejects(()=>createFrozenSourceReadback({DB}).readAllSourceGroups(),e=>{
    assert.equal(e.message,'Invalid or incomplete private M03 source archive');
    assert.doesNotMatch(e.message,/synthetic-page|legacy_sheet_row|LOGS/);
    return true;
   });
  });
 }
});
test('RED: source-commit sealed metadata changing during pagination invalidates entire read',async()=>{
 await withDb(async x=>{
  resealSyntheticSourceGroup(x,'LOGS',1001);
  let mutated=false;
  const DB={prepare(sql){
   const query=x.env.DB.prepare(sql);
   return {bind(...args){const stmt=query.bind(...args);return {async all(){
    const result=await stmt.all();
    if(!mutated&&sql.includes('FROM m03_private_source_rows')&&args[1]==='LOGS'){
     mutated=true;
     x.sql.prepare("UPDATE m03_private_source_seals SET status='STAGING' WHERE source_group='LOGS'").run();
    }
    return result;
   }};}};
  }};
  await assert.rejects(()=>createFrozenSourceReadback({DB}).readAllSourceGroups(),errorMsg);
 });
});
test('RED: large source count above explicit resource budget fails closed before unbounded queries',async()=>{
 await withDb(async x=>{
  x.sql.prepare("UPDATE m03_private_source_seals SET expected_rows=250001 WHERE source_group='LOGS'").run();
  await assert.rejects(()=>createFrozenSourceReadback(x.env).readAllSourceGroups(),errorMsg);
 });
});
test('Super QA: unexpected private D1 columns fail without emitting any sensitive row values',async()=>{
 await withDb(async x=>{
  const DB={prepare(sql){
   const bound=x.env.DB.prepare(sql);
   return {bind(...args){
    const stmt=bound.bind(...args);
    return {async all(){
     const result=await stmt.all();
     if(sql.includes('FROM m03_private_source_seals')){
      result.results[0].private_staff_token='synthetic-qa-canary-should-never-leak';
     }
     return result;
    }};
   }};
  }};
  await assert.rejects(()=>createFrozenSourceReadback({DB}).readAllSourceGroups(),e=>{
   assert.equal(e.message,'Invalid or incomplete private M03 source archive');
   assert.doesNotMatch(e.message,/private_staff_token|synthetic-qa-canary/);
   return true;
  });
 });
});

test('Super QA: malicious D1 row accessor is rejected without executing its getter',async()=>{
 await withDb(async x=>{
  let called=0;
  const DB={prepare(sql){
   const bound=x.env.DB.prepare(sql);
   return {bind(...args){
    const stmt=bound.bind(...args);
    return {async all(){
     const result=await stmt.all();
     if(sql.includes('FROM m03_private_source_rows') && args[1]==='PRODUCTS'){
      Object.defineProperty(result.results[0],'cells_json',{
       enumerable:true,configurable:true,
       get(){called++;throw new Error('synthetic-qa-private-credential');}
      });
     }
     return result;
    }};
   }};
  }};
  await assert.rejects(()=>createFrozenSourceReadback({DB}).readAllSourceGroups(),e=>{
   assert.equal(e.message,'Invalid or incomplete private M03 source archive');
   assert.doesNotMatch(e.message,/credential|cells_json|PRODUCTS/);
   return true;
  });
  assert.equal(called,0,'source readback may not execute D1 accessor side effects');
 });
});

test('page resource budget rejects a correctly sealed 8MiB+ cell before any partial source output',async()=>{
 await withDb(async x=>{
  const name='LOGS';
  const headers=schema.tables.find(t=>t.sheetKey===name).columns;
  const huge='q'.repeat(8*1024*1024+1);
  const rows=[{sheetRow:2,cells:['2026-11-17T00:00:00+06:00','QA',huge]}];
  x.sql.prepare('DELETE FROM m03_private_source_rows WHERE source_group=?').run(name);
  x.sql.prepare('INSERT INTO m03_private_source_rows VALUES (?,?,?,?)')
   .run(pin,name,2,JSON.stringify(rows[0].cells));
  x.sql.prepare('UPDATE m03_private_source_seals SET expected_rows=?,source_digest=? WHERE source_group=?')
   .run(1,digest(name,headers,rows),name);
  await assert.rejects(()=>createFrozenSourceReadback(x.env).readAllSourceGroups(),e=>{
   assert.equal(e.message,'Invalid or incomplete private M03 source archive');
   assert.doesNotMatch(e.message,/qqqq|LOGS|SQL/);
   return true;
  });
 });
});

function run5Evidence(){
 const source=original();
 const product=source.groups.PRODUCTS;
 const historical={sheetRow:19,cells:product.headers.map(()=>'')};
 historical.cells[product.headers.indexOf('Is Deleted')]='TRUE';
 product.rows.push(historical);
 const evidence={formatVersion:1,sourceCommit:pin,groups:{},counters:{},declaredSourceCounts:{}};
 for(const f of M02_ID_FAMILIES){
  const rows=source.groups[f.sourceGroup].rows;
  rows.forEach((row,i)=>{row.cells[0]=f.prefix+'-'+String(i+1).padStart(6,'0');});
  evidence.groups[f.sourceGroup]=rows.map(row=>({sheetRow:row.sheetRow,id:row.cells[0]}));
  evidence.declaredSourceCounts[f.sourceGroup]=rows.length;
  evidence.counters[f.sourceGroup]=String(rows.length+3);
 }
 const manifest=captureM02IdEvidenceFreeze({
  schema,pinnedSourceCommit:pin,evidence,salt:'ab'.repeat(32)
 });
 return {source,evidence,manifest};
}
const run5Denied=/M03 private original ID evidence rejected/;
const change=x=>structuredClone(x);

test('M03 Run 5 RED: exact 49 sealed D1 groups reconcile 38 ID families and frozen counters without enabling posting',async()=>{
 const x=run5Evidence(),db=fixtureDb(x.source);
 try{
  const adapter=createM03PrivateIdEvidenceReconciler(db.env);
  const result=await adapter.reconcile_({idEvidence:x.evidence,freezeManifest:x.manifest});
  assert.deepEqual(result,{
   formatVersion:1,sourceGroups:49,idFamilies:38,localD1ArchiveMatchesSuppliedIdFreeze:true,
   independentSourceCaptureVerified:false,sourceToD1Reconciled:false,
   idIssuanceAuthorized:false,publicRpcEnabled:false,productionReady:false
  });
  assert.ok(db.statements.every(s=>s.startsWith('SELECT ')));
  assert.equal(x.source.groups.PRODUCTS.rows.at(-1).cells[0],'PRD-000002');
  assert.equal(x.source.groups.PRODUCTS.rows.at(-1).cells[13],'TRUE');
 }finally{db.close();}
});

test('M03 Run 5 RED: independently sealed archive differs from otherwise self-consistent original-ID freeze',async()=>{
 const x=run5Evidence(),db=fixtureDb(x.source);
 try{
  const evidence=change(x.evidence),manifest=change(x.manifest);
  const old=evidence.groups.PRODUCTS[0].id;
  evidence.groups.PRODUCTS[0].id='PRD-000009';
  evidence.counters.PRODUCTS='10';
  // Freeze the wrong source snapshot: internally valid but NOT actual D1.
  const wrong=captureM02IdEvidenceFreeze({schema,pinnedSourceCommit:pin,evidence,
   salt:manifest.salt});
  const adapter=createM03PrivateIdEvidenceReconciler(db.env);
  await assert.rejects(()=>adapter.reconcile_({
   idEvidence:evidence,freezeManifest:wrong
  }),run5Denied);
  assert.notEqual(old,evidence.groups.PRODUCTS[0].id);
 }finally{db.close();}
});

test('M03 Run 5 RED: counter tamper, deleted ID omission, forged root and duplicate original ID are denied',async()=>{
 const x=run5Evidence(),db=fixtureDb(x.source);
 try{
  const adapter=createM03PrivateIdEvidenceReconciler(db.env);
  const attacks=[
   ()=>{const e=change(x.evidence);e.counters.SALES='77';return {idEvidence:e,freezeManifest:x.manifest};},
   ()=>{const e=change(x.evidence);e.groups.PRODUCTS.pop();e.declaredSourceCounts.PRODUCTS--;
     return {idEvidence:e,freezeManifest:x.manifest};},
   ()=>{const m=change(x.manifest);m.rootDigest='0'.repeat(64);
     return {idEvidence:x.evidence,freezeManifest:m};},
   ()=>{const e=change(x.evidence);e.groups.PRODUCTS[1].id=e.groups.PRODUCTS[0].id;
     return {idEvidence:e,freezeManifest:x.manifest};},
   ()=>({idEvidence:{...x.evidence,counters:{...x.evidence.counters,SALES:null}},
     freezeManifest:x.manifest})
  ];
  for(const attack of attacks)
   await assert.rejects(()=>adapter.reconcile_(attack()),run5Denied);
 }finally{db.close();}
});

test('M03 Run 5 RED: forged input, unbound D1 and unknown caller flags never expose original IDs or salts',async()=>{
 const x=run5Evidence(),db=fixtureDb(x.source);
 try{
  const adapter=createM03PrivateIdEvidenceReconciler(db.env);
  for(const patch of [
   {actorId:'ADMIN'}, {skipSeals:true},{idIssuanceAuthorized:true}
  ])await assert.rejects(()=>adapter.reconcile_({
   idEvidence:x.evidence,freezeManifest:x.manifest,...patch
  }),run5Denied);
  await assert.rejects(()=>adapter.reconcile_(),run5Denied);
  await assert.rejects(()=>adapter.reconcile_({
   idEvidence:x.evidence,freezeManifest:x.manifest
  },{allowProduction:true}),run5Denied);
  assert.throws(()=>createM03PrivateIdEvidenceReconciler({}),/D1 database binding unavailable/);
  db.sql.prepare("UPDATE m03_private_source_rows SET cells_json='[]' WHERE source_group='PRODUCTS' AND legacy_sheet_row=19").run();
  await assert.rejects(()=>adapter.reconcile_({
   idEvidence:x.evidence,freezeManifest:x.manifest
  }),e=>{
   assert.match(e.message,run5Denied);
   for(const secret of ['PRD-000002',x.manifest.salt,x.manifest.rootDigest])
    assert.ok(!e.message.includes(secret));
   return true;
  });
 }finally{db.close();}
});

function run6SeedDb(input,initialEvidence=input.evidence){
 const db=fixtureDb(input.source);
 db.sql.exec([
 'CREATE TABLE synthetic_m03_id_counters(tenant_id TEXT NOT NULL,id_key TEXT NOT NULL,prefix TEXT NOT NULL,current_sequence INTEGER NOT NULL,PRIMARY KEY(tenant_id,id_key)) STRICT;',
 'CREATE TABLE synthetic_m03_id_receipts(tenant_id TEXT NOT NULL,id_key TEXT NOT NULL,operation_id TEXT NOT NULL,issued_sequence INTEGER NOT NULL,PRIMARY KEY(tenant_id,id_key,operation_id)) STRICT;'
 ].join('\n'));
 const insert=db.sql.prepare('INSERT INTO synthetic_m03_id_counters VALUES (?,?,?,?)');
 for(const family of M02_ID_FAMILIES){
  const key=family.sourceGroup;
  const highest=initialEvidence.groups[key].reduce((max,row)=>
   Math.max(max,Number(row.id.slice(family.prefix.length+1))),0);
  const floor=Math.max(Number(initialEvidence.counters[key]),highest);
  insert.run('TENANT-A',key,family.prefix,floor);
 }
 return db;
}
const run6Denied=/M03 private original ID counter floor rejected/;
test('M03 Run 6 RED: exact 38-family synthetic D1 floors match fully sealed 49-group archive',async()=>{
 const x=run5Evidence(),db=run6SeedDb(x);
 try{
  const auditor=createM03PrivateSourceFloorAudit(db.env,'TENANT-A');
  const result=await auditor.auditFreshSeed_({idEvidence:x.evidence,freezeManifest:x.manifest});
  assert.deepEqual(result,{
   formatVersion:1,sourceGroups:49,idFamilies:38,
   exactFreshSyntheticD1CounterFloors:true,
   sourceToD1Reconciled:false,idIssuanceAuthorized:false,
   publicRpcEnabled:false,productionReady:false
  });
  assert.ok(db.statements.every(sql=>sql.startsWith('SELECT ')));
 }finally{db.close();}
});
test('M03 Run 6 RED: wrong floor, wrong prefix, extra family, absent family and foreign tenant all fail closed',async()=>{
 const x=run5Evidence(),db=run6SeedDb(x);
 try{
  const audit=createM03PrivateSourceFloorAudit(db.env,'TENANT-A');
  const args={idEvidence:x.evidence,freezeManifest:x.manifest};
  const sql=db.sql;
  const deny=async()=>assert.rejects(()=>audit.auditFreshSeed_(args),run6Denied);
  sql.prepare("UPDATE synthetic_m03_id_counters SET current_sequence=0 WHERE id_key='PRODUCTS'").run();
  await deny();
  sql.prepare("UPDATE synthetic_m03_id_counters SET current_sequence=6 WHERE id_key='PRODUCTS'").run();
  await deny();
  sql.prepare("UPDATE synthetic_m03_id_counters SET current_sequence=5,prefix='WRONG' WHERE id_key='PRODUCTS'").run();
  await deny();
  sql.prepare("UPDATE synthetic_m03_id_counters SET prefix='PRD' WHERE id_key='PRODUCTS'").run();
  sql.prepare("INSERT INTO synthetic_m03_id_counters VALUES ('TENANT-A','SESSIONS','BAD',0)").run();
  await deny();
  sql.prepare("DELETE FROM synthetic_m03_id_counters WHERE id_key='SESSIONS'").run();
  sql.prepare("DELETE FROM synthetic_m03_id_counters WHERE id_key='PRODUCT_UNITS'").run();
  await deny();
  await assert.rejects(()=>createM03PrivateSourceFloorAudit(db.env,'TENANT-Z')
   .auditFreshSeed_(args),run6Denied);
 }finally{db.close();}
});
test('M03 Run 6 RED: prior receipt, changed original counter and untrusted caller flags never approve issuer',async()=>{
 const x=run5Evidence(),db=run6SeedDb(x);
 try{
  const audit=createM03PrivateSourceFloorAudit(db.env,'TENANT-A');
  const args={idEvidence:x.evidence,freezeManifest:x.manifest};
  await assert.rejects(()=>audit.auditFreshSeed_({...args,allowIssue:true}),run6Denied);
  await assert.rejects(()=>audit.auditFreshSeed_(args,{actorId:'admin'}),run6Denied);
  db.sql.prepare("INSERT INTO synthetic_m03_id_receipts VALUES ('TENANT-A','PRODUCTS','OP-OLD',5)").run();
  await assert.rejects(()=>audit.auditFreshSeed_(args),run6Denied);
  db.sql.prepare("DELETE FROM synthetic_m03_id_receipts").run();
  const changed=structuredClone(x.evidence);changed.counters.SALES='999';
  await assert.rejects(()=>audit.auditFreshSeed_({
   idEvidence:changed,freezeManifest:x.manifest}),run6Denied);
  assert.throws(()=>createM03PrivateSourceFloorAudit({},'TENANT-A'),/D1.*unavailable/i);
 }finally{db.close();}
});
