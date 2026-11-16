import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessM10SourceFreeze} from '../src/migration/m10-source-freeze.js';
import {assessM10RehearsalEvidence} from '../src/migration/m10-rehearsal-gate.js';
import {assessM10ReviewedGroupParity} from '../src/migration/m10-reviewed-group-parity.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const hex=n=>n.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map((t,i)=>t.sheetKey==='LOGS'
  ?{sheetKey:'LOGS',rowCount:2,rowDigest:hex(44),positionDigest:hex(45),
    identityKind:'SOURCE_ROW_POSITION_ONLY'}
  :{sheetKey:t.sheetKey,rowCount:i+1,rowDigest:hex(i+1),idDigest:hex(i+200)}
);
const captures=()=>({
  firstPass:{snapshotId:'OFFLINE-PASS-001',capturedAt:'2026-11-17T10:00:00.000Z',
    sourceCommit:SOURCE,groups:groups()},
  secondPass:{snapshotId:'OFFLINE-PASS-002',capturedAt:'2026-11-17T10:01:00.000Z',
    sourceCommit:SOURCE,groups:groups()}
});
const coverage=()=>({formatVersion:1,sourceCommit:SOURCE,
  summary:{sourceGroups:49,fullyReconciled:49},
  rows:inventory.tables.map(({sheetKey})=>({sheetKey,sourceImportReconciled:true}))
});
const gross=()=>({sourcePlanValid:true,readbackChecked:true,
  currentMatch:true,openingMatch:true,offlineCheckpointParity:true,issues:[],
  counts:{expectedCurrent:7,observedCurrent:7,expectedOpening:2,observedOpening:2}});
const sourceFreeze=(x={})=>assessM10SourceFreeze({
  inventory,firstPass:captures().firstPass,secondPass:captures().secondPass,
  finalSourceSummary:groups(),...x
});
const rehearsal=(x={})=>assessM10RehearsalEvidence({
  inventory,coverage:coverage(),sourceSummary:groups(),d1Summary:groups(),
  grossParity:gross(),pendingIdentityReviews:0,sourceFreeze:captures(),...x
});
const issue=(result,code)=>result.issues.find(i=>i.code===code)?.count??0;
const LOGS=a=>a.find(x=>x.sheetKey==='LOGS');

test('pinned inventory contains one LOGS without an original business identifier',()=>{
 assert.equal(inventory.tables.length,49);
 const source=inventory.tables.find(x=>x.sheetKey==='LOGS');
 assert.deepEqual(source.columns,['Timestamp','Context','Message']);
 assert.equal(groups().filter(x=>x.sheetKey==='LOGS').length,1);
 assert.equal(Object.hasOwn(LOGS(groups()),'idDigest'),false);
});
test('full 49-group two-pass freeze accepts authentic id-less LOGS row-position proof',()=>{
 const s=sourceFreeze();
 assert.equal(s.stable,true);
 assert.equal(s.comparisonsComplete,true);
 assert.deepEqual(s.issues,[]);
});
test('full 49-group preflight accepts authentic LOGS positions without inventing an idDigest',()=>{
 const s=rehearsal();
 assert.equal(s.groupComparisonsComplete,true);
 assert.equal(s.groupsMatched,true);
 assert.equal(s.candidateDataParity,true);
 assert.deepEqual(s.issues,[]);
 assert.equal(s.authorizesImport,false);
 assert.equal(s.productionReady,false);
});
test('LOGS source freeze changes physical row position even with identical row text',()=>{
 const cap=captures();
 LOGS(cap.secondPass.groups).positionDigest=hex(77);
 const result=sourceFreeze(cap);
 assert.equal(result.stable,false);
 assert.equal(issue(result,'SOURCE_FREEZE_POSITION_PROVENANCE_CHANGED'),1);
});
test('LOGS source vs final source must match positions',()=>{
 const cap=captures(),final=groups();
 LOGS(final).positionDigest=hex(88);
 const result=sourceFreeze({...cap,finalSourceSummary:final});
 assert.equal(result.stable,false);
 assert.equal(issue(result,'SOURCE_FREEZE_FINAL_SOURCE_MISMATCH'),1);
});
test('LOGS source-to-D1 physical row position difference must block 49-group parity',()=>{
 const d1=groups();LOGS(d1).positionDigest=hex(90);
 const result=rehearsal({d1Summary:d1});
 assert.equal(result.groupsMatched,false);
 assert.equal(result.candidateDataParity,false);
 assert.equal(issue(result,'GROUP_POSITION_PROVENANCE_MISMATCH'),1);
 assert.equal(issue(result,'GROUP_ID_DIGEST_MISMATCH'),0);
});
test('LOGS data-row digest remains independently checked',()=>{
 const d1=groups();LOGS(d1).rowDigest=hex(91);
 const result=rehearsal({d1Summary:d1});
 assert.equal(issue(result,'GROUP_ROW_DIGEST_MISMATCH'),1);
});
test('LOGS cannot invent an idDigest, including when claiming correct positional identity',()=>{
 const forged=groups(); const row=LOGS(forged);
 delete row.positionDigest;delete row.identityKind;row.idDigest=hex(45);
 assert.throws(()=>sourceFreeze({firstPass:{
   ...captures().firstPass,groups:forged
 }}),/M10 source freeze evidence invalid/);
 assert.throws(()=>rehearsal({sourceSummary:forged}),/M10 rehearsal evidence invalid/);
 const mixed=groups();LOGS(mixed).idDigest=hex(45);
 assert.throws(()=>sourceFreeze({finalSourceSummary:mixed}),/M10 source freeze evidence invalid/);
 assert.throws(()=>rehearsal({d1Summary:mixed}),/M10 rehearsal evidence invalid/);
});
test('LOGS missing positionDigest or wrong identityKind is rejected',()=>{
 for(const change of [x=>{delete x.positionDigest;},
   x=>{x.identityKind='ORIGINAL_ID';},
   x=>{x.positionDigest='PRIVATE-EXPORT-ID';}]){
   const rows=groups();change(LOGS(rows));
   assert.throws(()=>sourceFreeze({finalSourceSummary:rows}),
     e=>e.message==='M10 source freeze evidence invalid'&&!e.message.includes('PRIVATE'));
   assert.throws(()=>rehearsal({d1Summary:rows}),
     e=>e.message==='M10 rehearsal evidence invalid'&&!e.message.includes('PRIVATE'));
 }
});
test('non-LOGS group cannot masquerade as id-less physical provenance',()=>{
 const rows=groups(),other=rows.find(x=>x.sheetKey!=='LOGS');
 delete other.idDigest;other.positionDigest=hex(33);
 other.identityKind='SOURCE_ROW_POSITION_ONLY';
 assert.throws(()=>sourceFreeze({finalSourceSummary:rows}),/M10 source freeze evidence invalid/);
 assert.throws(()=>rehearsal({d1Summary:rows}),/M10 rehearsal evidence invalid/);
});
test('positional evidence accessors or hidden symbols must not run and leak secret data',()=>{
 const rows=groups();
 Object.defineProperty(LOGS(rows),'positionDigest',{enumerable:true,get(){
   throw new Error('PRIVATE_SOURCE_DATA_EXPOSED');
 }});
 assert.throws(()=>sourceFreeze({finalSourceSummary:rows}),
   e=>e.message==='M10 source freeze evidence invalid'&&!e.message.includes('PRIVATE'));
 assert.throws(()=>rehearsal({d1Summary:rows}),
   e=>e.message==='M10 rehearsal evidence invalid'&&!e.message.includes('PRIVATE'));
 const symbols=groups();LOGS(symbols)[Symbol('secret')]='PRIVATE';
 assert.throws(()=>sourceFreeze({finalSourceSummary:symbols}),/M10 source freeze evidence invalid/);
 assert.throws(()=>rehearsal({sourceSummary:symbols}),/M10 rehearsal evidence invalid/);
});
test('reviewed M10-09 LOGS semantics stay consistent with full-rehearsal LOGS evidence',()=>{
 const all=groups(),keys=[
 'PRODUCT_CATEGORIES','PRODUCT_UNITS','EXPENSE_CATEGORIES','DELETE_LOG','SALES_DRAFT_AUDIT','LOGS'
 ];
 const subset=keys.map(k=>({...all.find(x=>x.sheetKey===k)}));
 const result=assessM10ReviewedGroupParity({inventory,sourceSummaries:subset,d1Summaries:subset});
 assert.equal(result.groupsMatched,true);
 assert.equal(result.positionOnlyGroups,1);
 assert.equal(result.authorizesImport,false);
});
