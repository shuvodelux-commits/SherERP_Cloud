import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildM02IdFloorReview,M02_ID_FAMILIES} from '../scripts/dry-run-id-floor.mjs';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;

function fixture(){
 const groups={},counters={},declaredSourceCounts={};
 for(const item of M02_ID_FAMILIES){
  groups[item.sourceGroup]=[];
  counters[item.sourceGroup]='0';
  declaredSourceCounts[item.sourceGroup]=0;
 }
 return {formatVersion:1,sourceCommit:pin,groups,counters,declaredSourceCounts};
}
function add(input,group,id,row){
 input.groups[group].push({sheetRow:row,id});
 input.declaredSourceCounts[group]=input.groups[group].length;
 return input;
}
function review(input=fixture(),context={}) {
 return buildM02IdFloorReview({schema,pinnedSourceCommit:pin,evidence:input,...context});
}
function family(report,group){return report.families.find(f=>f.sourceGroup===group);}
function issue(report,code,group){return report.issues.some(i=>i.code===code&&i.sourceGroup===group);}

test('pinned Config defines 38 distinct original families, six-digit pad and first-column identity',()=>{
 assert.equal(M02_ID_FAMILIES.length,38);
 assert.equal(new Set(M02_ID_FAMILIES.map(x=>x.prefix)).size,38);
 for(const name of ['SALES','PURCHASES','SALES_RETURN','PURCHASE_RETURN']){
  assert.ok(M02_ID_FAMILIES.some(x=>x.sourceGroup===name));
 }
 assert.equal(M02_ID_FAMILIES.find(f=>f.sourceGroup==='SALES').prefix,'INV');
 assert.equal(M02_ID_FAMILIES.find(f=>f.sourceGroup==='PURCHASES').prefix,'PUR');
 assert.equal(M02_ID_FAMILIES.find(f=>f.sourceGroup==='SALES_RETURN').prefix,'SRT');
 assert.equal(M02_ID_FAMILIES.find(f=>f.sourceGroup==='PURCHASE_RETURN').prefix,'PRT');
 assert.equal(M02_ID_FAMILIES.some(f=>f.sourceGroup==='SESSIONS'),false);
 assert.equal(M02_ID_FAMILIES.some(f=>f.prefix==='SRB'),false);
 for(const item of M02_ID_FAMILIES){
  assert.equal(schema.tables.find(g=>g.sheetKey===item.sourceGroup).columns[0],item.sourceIdColumn);
  assert.equal(item.minimumPad,6);
 }
});
test('empty source and verified zero property counter yield *nonissuable* provisional first ID',()=>{
 const r=review();
 assert.equal(r.sourceFamilies,38);
 assert.equal(r.issues.length,0);
 assert.equal(r.candidateComplete,true);
 assert.equal(family(r,'SALES').nextIdCandidate,'INV-000001');
 assert.equal(r.d1Verified,false);
 assert.equal(r.sourceToD1Reconciled,false);
 assert.equal(r.idIssuanceAuthorized,false);
 assert.equal(r.productionReady,false);
});
test('highest surviving original Invoice ID beats stale DocumentProperties and row count',()=>{
 const x=fixture();
 add(x,'SALES','INV-000001',2);
 add(x,'SALES','INV-000016',9);
 x.counters.SALES='4';
 const r=review(x);
 assert.equal(r.issues.length,0);
 assert.equal(family(r,'SALES').maxHistoricalSequence,16);
 assert.equal(family(r,'SALES').propertyCounter,4);
 assert.equal(family(r,'SALES').nextIdCandidate,'INV-000017');
});
test('greater stored counter is never reduced after rows were deleted',()=>{
 const x=fixture();
 add(x,'PURCHASES','PUR-000004',22);
 x.counters.PURCHASES='30';
 assert.equal(family(review(x),'PURCHASES').nextIdCandidate,'PUR-000031');
});
test('Sales Returns, Purchase Returns and purchases use independent prefixes and floors',()=>{
 const x=fixture();
 add(x,'SALES_RETURN','SRT-000003',8);
 add(x,'PURCHASE_RETURN','PRT-000015',8);
 add(x,'PURCHASES','PUR-000024',8);
 const r=review(x);
 assert.equal(family(r,'SALES_RETURN').nextIdCandidate,'SRT-000004');
 assert.equal(family(r,'PURCHASE_RETURN').nextIdCandidate,'PRT-000016');
 assert.equal(family(r,'PURCHASES').nextIdCandidate,'PUR-000025');
});
test('duplicate historical Invoice ID is blocked, including a soft-deleted duplicate',()=>{
 const x=fixture();
 add(x,'SALES','INV-000007',2);
 add(x,'SALES','INV-000007',5);
 const r=review(x);
 assert.ok(issue(r,'DUPLICATE_OR_REUSED_ID','SALES'));
 assert.equal(family(r,'SALES').nextIdCandidate,null);
 assert.equal(r.candidateComplete,false);
});
test('malformed/ambiguous legacy prefix accepted by permissive parseInt must be reviewed',()=>{
 const x=fixture();
 add(x,'SALES','INV-000016junk',2);
 const r=review(x);
 assert.ok(issue(r,'MALFORMED_OR_NONCANONICAL_ID','SALES'));
 assert.equal(family(r,'SALES').nextIdCandidate,null);
});
test('cross-family ID, whitespace alias, zero and extra leading-zero aliases are rejected',()=>{
 for(const bad of ['PUR-000016',' INV-000016','INV-000000','INV-000000016','inv-000016']){
  const x=fixture();add(x,'SALES',bad,2);
  assert.equal(review(x).candidateComplete,false,bad);
 }
});
test('missing, duplicate or nonpositive physical sheet-row provenance fails closed',()=>{
 const x=fixture();
 add(x,'SALES','INV-000001',2);
 add(x,'SALES','INV-000002',2);
 assert.ok(issue(review(x),'DUPLICATE_OR_INVALID_ROW_PROVENANCE','SALES'));
 x.groups.SALES[1].sheetRow=1;
 assert.ok(issue(review(x),'DUPLICATE_OR_INVALID_ROW_PROVENANCE','SALES'));
});
test('independently declared count mismatch is a blocker, not a row-count derived floor',()=>{
 const x=fixture();add(x,'SALES','INV-000016',5);
 x.declaredSourceCounts.SALES=5;
 assert.ok(issue(review(x),'DECLARED_SOURCE_COUNT_MISMATCH','SALES'));
});
test('missing DocumentProperties capture cannot be substituted with zero',()=>{
 const x=fixture();add(x,'SALES','INV-000016',5);
 x.counters.SALES=null;
 const r=review(x);
 assert.ok(issue(r,'MISSING_COUNTER_EVIDENCE','SALES'));
 assert.equal(family(r,'SALES').nextIdCandidate,null);
});
test('invalid, ambiguous and unsafe property counters block allocation',()=>{
 for(const counter of ['04','-1','1.5','Infinity','9007199254740992',4]){
  const x=fixture();x.counters.SALES=counter;
  assert.ok(issue(review(x),'INVALID_COUNTER_EVIDENCE','SALES'),String(counter));
 }
});
test('counter exhaustion cannot roll over safe integer boundary',()=>{
 const x=fixture();x.counters.SALES='9007199254740991';
 const r=review(x);
 assert.ok(issue(r,'COUNTER_EXHAUSTED','SALES'));
 assert.equal(family(r,'SALES').nextIdCandidate,null);
});
test('oversized original numeric suffix is quarantined, not rounded by Number()',()=>{
 const x=fixture();add(x,'SALES','INV-9007199254740992',2);
 assert.ok(issue(review(x),'MALFORMED_OR_NONCANONICAL_ID','SALES'));
});
test('missing or unexpected original group and source drift are structurally rejected',()=>{
 const x=fixture();delete x.groups.SALES;
 assert.throws(()=>review(x),/M02 original ID floor rejected/);
 const y=fixture();y.groups.UNREVIEWED=[];
 assert.throws(()=>review(y),/M02 original ID floor rejected/);
 const z=fixture();z.sourceCommit='0'.repeat(40);
 assert.throws(()=>review(z),/M02 original ID floor rejected/);
});
test('original IDs are never emitted as issues, error messages or source data in result',()=>{
 const x=fixture();
 add(x,'SALES','INV-000016junk',2);
 const r=review(x);
 assert.equal(JSON.stringify(r).includes('INV-000016junk'),false);
 assert.deepEqual(Object.keys(r.issues[0]).sort(),['code','count','sourceGroup'].sort());
 assert.equal(r.idIssuanceAuthorized,false);
});
test('offline CLI prints redacted summary only and never a private source ID',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-idfloor-'));
 try{
  const x=fixture();add(x,'SALES','INV-000016',2);x.counters.SALES='4';
  const path=join(dir,'private.json');writeFileSync(path,JSON.stringify(x));
  const process=spawnSync(processExec(),[new URL('../scripts/dry-run-id-floor.mjs',import.meta.url).pathname,path],{encoding:'utf8'});
  assert.equal(process.status,0,process.stderr);
  assert.equal(process.stdout.includes('INV-000016'),false);
  assert.equal(process.stdout.includes('INV-000017'),false);
  const data=JSON.parse(process.stdout);
  assert.equal(data.idIssuanceAuthorized,false);
  assert.equal(data.sourceFamilies,38);
  x.groups.SALES[0].id='INV-000016junk';writeFileSync(path,JSON.stringify(x));
  const rejected=spawnSync(processExec(),[new URL('../scripts/dry-run-id-floor.mjs',import.meta.url).pathname,path],{encoding:'utf8'});
  assert.equal(rejected.status,2);
  assert.equal(rejected.stdout.includes('INV-000016junk'),false);
  assert.equal(rejected.stderr.includes('INV-000016junk'),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
function processExec(){return process.execPath;}
