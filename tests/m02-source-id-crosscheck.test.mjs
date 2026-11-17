import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {M02_ID_FAMILIES} from '../scripts/dry-run-id-floor.mjs';
import {captureM02IdEvidenceFreeze} from '../scripts/dry-run-id-evidence-freeze.mjs';
import {reviewM02SourceIdCrosscheck} from '../scripts/dry-run-source-id-crosscheck.mjs';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const salt='ab'.repeat(32);
const cli=new URL('../scripts/dry-run-source-id-crosscheck.mjs',import.meta.url).pathname;
function fixture(){
 const sourceExport={formatVersion:1,sourceCommit:pin,groups:{}};
 const idEvidence={formatVersion:1,sourceCommit:pin,groups:{},counters:{},declaredSourceCounts:{}};
 for(const f of schema.tables)sourceExport.groups[f.sheetKey]={headers:[...f.columns],rows:[]};
 for(const f of M02_ID_FAMILIES){
  idEvidence.groups[f.sourceGroup]=[];idEvidence.counters[f.sourceGroup]='0';
  idEvidence.declaredSourceCounts[f.sourceGroup]=0;
 }
 insert(sourceExport,'SALES',2,'INV-000001');
 insert(sourceExport,'SALES',9,'INV-000016');
 idEvidence.groups.SALES=[{sheetRow:2,id:'INV-000001'},{sheetRow:9,id:'INV-000016'}];
 idEvidence.declaredSourceCounts.SALES=2;
 idEvidence.counters.SALES='4';
 return {sourceExport,idEvidence};
}
function insert(source,group,sheetRow,id){
 const table=source.groups[group];
 const cells=table.headers.map(()=>'');
 cells[0]=id;
 table.rows.push({sheetRow,cells});
}
function freeze(x){return captureM02IdEvidenceFreeze({schema,pinnedSourceCommit:pin,evidence:x,salt});}
function review(src,ids,manifest=freeze(ids)){
 return reviewM02SourceIdCrosscheck({schema,pinnedSourceCommit:pin,sourceExport:src,
  idEvidence:ids,freezeManifest:manifest});
}
const copy=x=>structuredClone(x);
const codes=x=>x.issues.map(i=>i.code);
function run(args){return spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});}

test('49 groups, 38 original sequential families, and 11 nonsequential sources are represented without D1 approval',()=>{
 const {sourceExport,idEvidence}=fixture(),r=review(sourceExport,idEvidence);
 assert.equal(r.sourceGroups,49);assert.equal(r.idFamilies,38);
 assert.equal(r.nonSequentialGroups,11);assert.equal(r.exactOfflineCandidate,true);
 assert.equal(r.issues.length,0);
 for(const f of ['independentSourceExportVerified','d1ReadbackVerified','sourceToD1Reconciled','idIssuanceAuthorized','productionReady'])
  assert.equal(r[f],false,f);
});
test('source and ID evidence JSON ordering does not change physical sheet identity',()=>{
 const {sourceExport,idEvidence}=fixture();
 const manifest=freeze(idEvidence);
 sourceExport.groups.SALES.rows.reverse();
 idEvidence.groups.SALES.reverse();
 assert.equal(review(sourceExport,idEvidence,manifest).exactOfflineCandidate,true);
});
test('fresh freeze of unrelated but internally valid IDs cannot hide source mismatch',()=>{
 const {sourceExport,idEvidence}=fixture();
 idEvidence.groups.SALES[1].id='INV-000017';
 assert.ok(codes(review(sourceExport,idEvidence)).includes('SOURCE_ID_EVIDENCE_TEXT_MISMATCH'));
});
test('a physical source row missing from ID evidence is blocked without a name/rowid join',()=>{
 const {sourceExport,idEvidence}=fixture();
 idEvidence.groups.SALES.pop();idEvidence.declaredSourceCounts.SALES=1;
 assert.ok(codes(review(sourceExport,idEvidence)).includes('SOURCE_ID_EVIDENCE_ROW_MISSING'));
});
test('an extra original ID row not in the 49-group source export fails closed',()=>{
 const {sourceExport,idEvidence}=fixture();
 idEvidence.groups.SALES.push({sheetRow:20,id:'INV-000020'});
 idEvidence.declaredSourceCounts.SALES=3;
 assert.ok(codes(review(sourceExport,idEvidence)).includes('SOURCE_ID_EVIDENCE_ROW_EXTRA'));
});
test('same ID at a different physical original row cannot be accepted',()=>{
 const {sourceExport,idEvidence}=fixture();
 idEvidence.groups.SALES[1].sheetRow=12;
 const r=review(sourceExport,idEvidence);
 assert.ok(codes(r).includes('SOURCE_ID_EVIDENCE_ROW_EXTRA'));
 assert.ok(codes(r).includes('SOURCE_ID_EVIDENCE_ROW_MISSING'));
});
test('Run 5 frozen property counter mismatch is a separate blocker',()=>{
 const {sourceExport,idEvidence}=fixture(),manifest=freeze(idEvidence);
 idEvidence.counters.SALES='31';
 const r=review(sourceExport,idEvidence,manifest);
 assert.equal(r.exactOfflineCandidate,false);
 assert.ok(codes(r).includes('ORIGINAL_COUNTER_DIGEST_MISMATCH'));
});
test('Run 4 invalid duplicate historical ID evidence cannot be promoted',()=>{
 const {sourceExport,idEvidence}=fixture(),manifest=freeze(idEvidence);
 idEvidence.groups.SALES[0].id='INV-000016';
 const r=review(sourceExport,idEvidence,manifest);
 assert.equal(r.exactOfflineCandidate,false);
 assert.ok(codes(r).includes('DUPLICATE_OR_REUSED_ID'));
 assert.ok(!JSON.stringify(r).includes('INV-000016'));
});
test('Run 5 changed manifest, source pin, and Run 3 missing group reject structurally',()=>{
 const {sourceExport,idEvidence}=fixture(),manifest=freeze(idEvidence);
 const corrupt=copy(manifest);corrupt.families[0].rowDigest='0'.repeat(64);
 assert.throws(()=>review(sourceExport,idEvidence,corrupt),/M02 ID freeze rejected/);
 const bad=copy(sourceExport);bad.sourceCommit='f'.repeat(40);
 assert.throws(()=>review(bad,idEvidence,manifest),/M02 offline parity rejected/);
 const absent=copy(sourceExport);delete absent.groups.LOGS;
 assert.throws(()=>review(absent,idEvidence,manifest),/M02 offline parity rejected/);
});
test('changed frozen column order rejects, never guesses the first ID column',()=>{
 const {sourceExport,idEvidence}=fixture();
 sourceExport.groups.SALES.headers.reverse();
 assert.throws(()=>review(sourceExport,idEvidence),/M02 offline parity rejected/);
});
test('a non-ID source group is still source-validated but is not assigned a fabricated ID family',()=>{
 const {sourceExport,idEvidence}=fixture(),manifest=freeze(idEvidence);
 insert(sourceExport,'LOGS',18,'synthetic-error-message');
 const r=review(sourceExport,idEvidence,manifest);
 assert.equal(r.exactOfflineCandidate,true);
 assert.equal(r.nonSequentialGroups,11);
 assert.equal(M02_ID_FAMILIES.some(f=>f.sourceGroup==='LOGS'),false);
});
test('CLI reads only three local JSON inputs, outputs fixed issues without any source ID or path',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-cross-'));
 try{
  const src=join(dir,'original.json'),ids=join(dir,'id-evidence.json'),fm=join(dir,'private-freeze.json');
  const x=fixture(),manifest=freeze(x.idEvidence);
  writeFileSync(src,JSON.stringify(x.sourceExport));writeFileSync(ids,JSON.stringify(x.idEvidence));
  writeFileSync(fm,JSON.stringify(manifest));
  const good=run([src,ids,fm]);
  assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(good.stdout).exactOfflineCandidate,true);
  x.idEvidence.groups.SALES[1].id='INV-000017';
  writeFileSync(ids,JSON.stringify(x.idEvidence));
  const bad=run([src,ids,fm]);
  assert.equal(bad.status,2);
  assert.equal(JSON.parse(bad.stdout).exactOfflineCandidate,false);
  for(const value of ['INV-000017',src,ids,fm,manifest.salt,manifest.rootDigest])
   assert.ok(!(bad.stdout+bad.stderr).includes(value));
  const unsafe=run([src,ids,'https://example.invalid/private.json']);
  assert.equal(unsafe.status,2);assert.ok(!unsafe.stderr.includes('example.invalid'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
