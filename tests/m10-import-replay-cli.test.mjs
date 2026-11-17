import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const exe=fileURLToPath(new URL('../scripts/m10-import-replay-check.mjs',import.meta.url));
const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const hex=i=>i.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map(({sheetKey},i)=>sheetKey==='LOGS'
  ?{sheetKey,rowCount:i+1,rowDigest:hex(i+1),
    positionDigest:hex(i+2001),identityKind:'SOURCE_ROW_POSITION_ONLY'}
  :{sheetKey,rowCount:i+1,rowDigest:hex(i+1),idDigest:hex(i+2001)});
const cap=(captureId,capturedAt)=>({captureId,capturedAt,sourceCommit:PIN,groups:groups()});
const receipt=(attemptId,readbackCaptureId,outcome,recordedAt)=>({
  attemptId,readbackCaptureId,outcome,recordedAt,isolatedTarget:true
});
const evidence=()=>({
  inventory,
  coverage:{formatVersion:1,sourceCommit:PIN,
    summary:{sourceGroups:49,fullyReconciled:49},
    rows:inventory.tables.map(({sheetKey})=>({sheetKey,sourceImportReconciled:true}))},
  source:cap('SOURCE-ORIGINAL-001','2026-11-17T06:00:00.000Z'),
  firstImport:cap('D1-FIRST-IMPORT-001','2026-11-17T06:02:00.000Z'),
  replayedImport:cap('D1-REPLAY-IMPORT01','2026-11-17T06:04:00.000Z'),
  rejectedRetryReadback:cap('D1-REJECT-RETRY01','2026-11-17T06:06:00.000Z'),
  receipts:{
    first:receipt('ATTEMPT-FIRST01','D1-FIRST-IMPORT-001','COMMITTED','2026-11-17T06:01:00.000Z'),
    replay:receipt('ATTEMPT-REPLAY01','D1-REPLAY-IMPORT01','REPLAYED','2026-11-17T06:03:00.000Z'),
    rejected:receipt('ATTEMPT-REJECT01','D1-REJECT-RETRY01','REJECTED','2026-11-17T06:05:00.000Z')
  }
});
function withFixture(fn){
  const dir=mkdtempSync(join(tmpdir(),'m10-run2-cli-'));
  try{
    const file=join(dir,'PRIVATE-business-data.json');
    writeFileSync(file,JSON.stringify(evidence()),{mode:0o600});
    return fn(file,dir);
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const run=args=>spawnSync(process.execPath,[exe,...args],{
  encoding:'utf8',timeout:20000,maxBuffer:256*1024
});

test('synthetic reconciled 49-group replay only produces candidate, no production authorization',()=>{
  withFixture(file=>{
    const before=readFileSync(file,'utf8'),r=run([file]);
    assert.equal(r.status,0,r.stderr);
    assert.equal(r.stderr,'');
    const out=JSON.parse(r.stdout);
    assert.equal(out.candidateReplayEvidence,true);
    assert.equal(out.authorizesImport,false);
    assert.equal(out.authorizesPosting,false);
    assert.equal(out.productionReady,false);
    assert.equal(readFileSync(file,'utf8'),before);
    assert.doesNotMatch(r.stdout,/SOURCE-ORIGINAL|ATTEMPT|PRIVATE|sheetKey|idDigest|rowDigest/);
  });
});

test('current M02-style zero-reconciled source coverage returns NO-GO exit code 2',()=>{
  withFixture(file=>{
    const x=evidence();
    x.coverage.summary.fullyReconciled=0;
    x.coverage.rows.forEach(row=>{row.sourceImportReconciled=false;});
    writeFileSync(file,JSON.stringify(x));
    const r=run([file]);
    assert.equal(r.status,2);
    assert.equal(JSON.parse(r.stdout).issues.find(x=>x.code==='REPLAY_COVERAGE_UNRECONCILED').count,49);
    assert.doesNotMatch(r.stdout,/SOURCE-ORIGINAL|ATTEMPT|PRIVATE|sheetKey/);
  });
});

test('a partial write after reported rejected retry returns redacted discrepancy and exit 2',()=>{
  withFixture(file=>{
    const x=evidence();x.rejectedRetryReadback.groups[0].rowCount=111111;
    writeFileSync(file,JSON.stringify(x));
    const r=run([file]);
    assert.equal(r.status,2);
    assert.equal(JSON.parse(r.stdout).issues.find(x=>x.code==='REPLAY_REJECTED_ROW_COUNT_MISMATCH').count,1);
    assert.doesNotMatch(r.stdout,/111111|PRIVATE|SOURCE-ORIGINAL|idDigest/);
  });
});

test('invalid JSON containing identifiable secrets is rejected without file path disclosure',()=>{
  withFixture(file=>{
    writeFileSync(file,'{PRIVATE-CUSTOMER-01700000000');
    const r=run([file]);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
    assert.match(r.stderr,/M10 local import replay evidence rejected/);
    assert.doesNotMatch(r.stderr,/PRIVATE|CUSTOMER|01700000000|business-data|m10-run2/);
  });
});

test('unexpected PII in evidence fails with no raw data in any output',()=>{
  withFixture(file=>{
    const x=evidence();
    x.firstImport.groups[0].customerPhone='PRIVATE-SECRET-01700000000';
    writeFileSync(file,JSON.stringify(x));
    const r=run([file]);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
    assert.doesNotMatch(r.stderr,/PRIVATE|SECRET|01700000000|business-data/);
  });
});

test('argument-based remote/unsafe operations are never supported',()=>{
  for(const args of [[],['--remote'],['--apply'],['a','b']]){
    const r=run(args);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
    assert.match(r.stderr,/M10 local import replay evidence rejected/);
  }
});

test('symlinks and directories are rejected instead of following private files',()=>{
  withFixture((file,dir)=>{
    const linked=join(dir,'private-link.json');
    symlinkSync(file,linked);
    for(const input of [linked,dir]){
      const r=run([input]);
      assert.equal(r.status,2);
      assert.equal(r.stdout,'');
    }
  });
});

test('missing absolute path fails without revealing the supplied path',()=>{
  const r=run(['/nonexistent/PRIVATE-CUSTOMER-SECRET.json']);
  assert.equal(r.status,2);
  assert.equal(r.stdout,'');
  assert.doesNotMatch(r.stderr,/PRIVATE|CUSTOMER|SECRET|nonexistent/);
});
