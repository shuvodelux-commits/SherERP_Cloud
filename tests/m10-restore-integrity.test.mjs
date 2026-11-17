import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessM10RestoreIntegrity} from '../src/migration/m10-restore-integrity.js';

const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'
));
const sourceCommit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const hash=n=>n.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map(({sheetKey},index)=>sheetKey==='LOGS'
  ?{sheetKey,rowCount:index+1,rowDigest:hash(index+1),
    positionDigest:hash(index+1001),identityKind:'SOURCE_ROW_POSITION_ONLY'}
  :{sheetKey,rowCount:index+1,rowDigest:hash(index+1),idDigest:hash(index+1001)}
);
const evidence=()=>({
  inventory,
  backup:{captureId:'BACKUP-A0001',capturedAt:'2026-11-17T06:10:00.000Z',
    sourceCommit,groups:groups()},
  restored:{captureId:'RESTORE-A0002',capturedAt:'2026-11-17T06:20:00.000Z',
    sourceCommit,groups:groups()},
  receipt:{attemptId:'DRILL-LOCAL-001',backupCaptureId:'BACKUP-A0001',
    restoredCaptureId:'RESTORE-A0002',isolatedTarget:true,
    completedAt:'2026-11-17T06:15:00.000Z'}
});
const issue=(r,code)=>r.issues.find(i=>i.code===code)?.count||0;

test('all 49 synthetic groups and isolated chronology allow only candidate restore parity',()=>{
  assert.equal(inventory.tables.length,49);
  const r=assessM10RestoreIntegrity(evidence());
  assert.deepEqual(r,{
    formatVersion:1,phase:'M10_OFFLINE_RESTORE_PREFLIGHT',
    groupsComparedComplete:true,candidateRestoreParity:true,
    authorizesRestore:false,authorizesImport:false,productionReady:false,
    issues:[],
    limitations:'Supplied snapshot hashes and receipt do not prove an actual D1 restore, verified backup custody, or release authorization'
  });
});

test('missing backup/readback/receipt never asserts restore parity',()=>{
  const r=assessM10RestoreIntegrity({inventory});
  assert.equal(r.groupsComparedComplete,false);
  assert.equal(r.candidateRestoreParity,false);
  assert.equal(issue(r,'RESTORE_BACKUP_EVIDENCE_MISSING'),1);
  assert.equal(issue(r,'RESTORE_READBACK_EVIDENCE_MISSING'),1);
  assert.equal(issue(r,'RESTORE_RECEIPT_MISSING'),1);
});

test('independent row count, content and original ID mismatch reject a fake restore',()=>{
  for(const [field,code,value] of [
    ['rowCount','RESTORE_ROW_COUNT_MISMATCH',777],
    ['rowDigest','RESTORE_ROW_DIGEST_MISMATCH',hash(998)],
    ['idDigest','RESTORE_ORIGINAL_ID_MISMATCH',hash(997)]
  ]){
    const x=evidence();
    const row=x.restored.groups.find(g=>g.sheetKey!=='LOGS');
    row[field]=value;
    const r=assessM10RestoreIntegrity(x);
    assert.equal(r.candidateRestoreParity,false,field);
    assert.equal(issue(r,code),1,field);
  }
});

test('LOGS uses physical source-row provenance, never a synthetic business ID',()=>{
  const x=evidence();
  x.restored.groups.find(g=>g.sheetKey==='LOGS').positionDigest=hash(987);
  const r=assessM10RestoreIntegrity(x);
  assert.equal(issue(r,'RESTORE_POSITION_PROVENANCE_MISMATCH'),1);
  assert.equal(r.candidateRestoreParity,false);
  x.restored.groups.find(g=>g.sheetKey==='LOGS').idDigest=hash(1);
  assert.throws(()=>assessM10RestoreIntegrity(x),
    {message:'M10 restore evidence invalid'});
});

test('missing, unexpected and duplicated group rows are explicit integrity failures',()=>{
  for(const [edit,code] of [
    [x=>x.restored.groups.pop(),'RESTORE_GROUP_MISSING'],
    [x=>x.restored.groups.push({sheetKey:'EXTRA',rowCount:1,rowDigest:hash(1),idDigest:hash(2)}),
      'RESTORE_GROUP_UNEXPECTED'],
    [x=>x.backup.groups.push({...x.backup.groups[0]}),'RESTORE_GROUP_DUPLICATE']
  ]){
    const x=evidence();
    edit(x);
    const r=assessM10RestoreIntegrity(x);
    assert.equal(r.candidateRestoreParity,false);
    assert.equal(r.groupsComparedComplete,false,'extra or duplicate groups are not complete evidence');
    assert.equal(issue(r,code),1);
  }
});

test('backup and restored captures must be distinct and ordered',()=>{
  const same=evidence();
  same.restored.captureId=same.backup.captureId;
  const r=assessM10RestoreIntegrity(same);
  assert.equal(r.candidateRestoreParity,false);
  assert.equal(issue(r,'RESTORE_CAPTURE_NOT_DISTINCT'),1);
  const reverse=evidence();
  reverse.restored.capturedAt='2026-11-17T06:00:00.000Z';
  const s=assessM10RestoreIntegrity(reverse);
  assert.equal(issue(s,'RESTORE_CAPTURE_NOT_ORDERED'),1);
});

test('receipt must bind exact captures, completion time and isolated target',()=>{
  for(const [edit,code] of [
    [x=>{x.receipt.backupCaptureId='BACKUP-B9999'},'RESTORE_RECEIPT_CAPTURE_MISMATCH'],
    [x=>{x.receipt.isolatedTarget=false},'RESTORE_TARGET_NOT_ISOLATED'],
    [x=>{x.receipt.completedAt='2026-11-17T06:09:00.000Z'},'RESTORE_RECEIPT_CHRONOLOGY_INVALID'],
    [x=>{x.receipt.completedAt='2026-11-17T06:21:00.000Z'},'RESTORE_RECEIPT_CHRONOLOGY_INVALID']
  ]){
    const x=evidence();
    edit(x);
    const r=assessM10RestoreIntegrity(x);
    assert.equal(r.candidateRestoreParity,false);
    assert.equal(issue(r,code),1,code);
  }
});

test('malformed hashes, source pins, getters and evidence shapes fail with fixed redacted error',()=>{
  const edits=[
    x=>{x.backup.sourceCommit='CUSTOMER-PRIVATE-SECRET';},
    x=>{x.restored.groups[0].rowDigest='CUSTOMER-PRIVATE-SECRET';},
    x=>{x.backup.groups[0].rowCount=-1;},
    x=>{x.inventory.tables=x.inventory.tables.slice(1);},
    x=>{x.restored.groups[0].privateAmount='CUSTOMER-PRIVATE-SECRET';},
    x=>{x.receipt.completedAt='2026-02-31T01:00:00.000Z';},
    x=>Object.defineProperty(x.backup.groups[0],'sheetKey',{
      enumerable:true,get(){throw new Error('CUSTOMER-PRIVATE-SECRET');}
    })
  ];
  for(const edit of edits){
    const x=evidence();
    x.inventory=structuredClone(x.inventory);
    edit(x);
    assert.throws(()=>assessM10RestoreIntegrity(x),
      err=>err.message==='M10 restore evidence invalid' &&
        !/PRIVATE|CUSTOMER|SECRET/.test(err.message));
  }
});

test('results never leak private capture IDs, source amounts or supplied hashes',()=>{
  const x=evidence();
  x.restored.groups[0].idDigest=hash(991);
  const rendered=JSON.stringify(assessM10RestoreIntegrity(x));
  assert.doesNotMatch(rendered,/BACKUP-A0001|RESTORE-A0002|DRILL-LOCAL-001|idDigest|positionDigest|rowDigest|991|amountMinor/);
});

test('evidence is not mutated and issues have stable sorted diagnostic order',()=>{
  const x=evidence();
  x.backup.groups[0].rowCount=0;
  x.restored.groups[1].rowDigest=hash(123);
  x.receipt.isolatedTarget=false;
  const clone=structuredClone(x);
  const a=assessM10RestoreIntegrity(x);
  const b=assessM10RestoreIntegrity(x);
  assert.deepEqual(a,b);
  assert.deepEqual(x,clone);
  assert.deepEqual(a.issues.map(v=>v.code),[...a.issues.map(v=>v.code)].sort());
});
