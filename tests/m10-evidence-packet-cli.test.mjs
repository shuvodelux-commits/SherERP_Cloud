import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('../scripts/m10-evidence-packet-check.mjs',import.meta.url));
const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'
));
const PIN='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const hash=n=>n.toString(16).padStart(64,'0');
const groups=()=>inventory.tables.map(({sheetKey},i)=>sheetKey==='LOGS'
  ?{sheetKey,rowCount:i+1,rowDigest:hash(i+1),positionDigest:hash(i+1001),
    identityKind:'SOURCE_ROW_POSITION_ONLY'}
  :{sheetKey,rowCount:i+1,rowDigest:hash(i+1),idDigest:hash(i+1001)});
const domains=()=>[
  ['CUSTOMERS','SOURCE_CURRENT'],['CUSTOMERS','HISTORICAL_OPENING'],
  ['SUPPLIERS','SOURCE_CURRENT'],['SUPPLIERS','HISTORICAL_OPENING'],
  ['VENDORS','SOURCE_CURRENT'],['FINANCE_PERSONS','SOURCE_CURRENT']
].map(([sourceGroup,basis])=>({sourceGroup,basis}));
const account=()=>({sourceGroup:'CUSTOMERS',legacyIdDigest:hash(901),
  accountKind:'CUSTOMER_ADVANCE',sourceField:'Opening Balance',
  basis:'HISTORICAL_OPENING',currency:'BDT',amountMinor:'25000'});
const evidence=()=>{
  const sourcePass=(snapshotId,capturedAt)=>({
    snapshotId,capturedAt,sourceCommit:PIN,groups:groups()
  });
  const acc=(captureId,capturedAt)=>({
    captureId,capturedAt,sourceCommit:PIN,domains:domains(),accounts:[account()]
  });
  return {
    rehearsal:{
      inventory,
      coverage:{formatVersion:1,sourceCommit:PIN,
        summary:{sourceGroups:49,fullyReconciled:49},
        rows:inventory.tables.map(({sheetKey})=>({sheetKey,sourceImportReconciled:true}))},
      sourceSummary:groups(),d1Summary:groups(),
      grossParity:{sourcePlanValid:true,readbackChecked:true,
        currentMatch:true,openingMatch:true,offlineCheckpointParity:true,
        issues:[],counts:{expectedCurrent:7,observedCurrent:7,
          expectedOpening:2,observedOpening:2}},
      pendingIdentityReviews:0,
      sourceFreeze:{
        firstPass:sourcePass('FREEZE-PASS-001','2026-11-16T10:00:00.000Z'),
        secondPass:sourcePass('FREEZE-PASS-002','2026-11-16T10:01:00.000Z')
      }
    },
    restore:{
      inventory,
      backup:{captureId:'BACKUP-001',capturedAt:'2026-11-17T06:10:00.000Z',
        sourceCommit:PIN,groups:groups()},
      restored:{captureId:'RESTORE-001',capturedAt:'2026-11-17T06:20:00.000Z',
        sourceCommit:PIN,groups:groups()},
      receipt:{attemptId:'DRILL-0001',backupCaptureId:'BACKUP-001',
        restoredCaptureId:'RESTORE-001',isolatedTarget:true,
        completedAt:'2026-11-17T06:15:00.000Z'}
    },
    gross:{sourcePlanReviewed:true,identityReviewsPending:0,
      source:acc('GROSS-SOURCE-001','2026-11-17T06:00:00.000Z'),
      d1:acc('GROSS-D1-00001','2026-11-17T06:05:00.000Z')},
    performance:{
      policy:{formatVersion:1,reviewRef:'SYNTH-REVIEW-001',reviewed:true,
        workloads:[{workloadId:'PARTY_LEDGER',latencyP95MaxMs:100,
          latencyP99MaxMs:120,cpuP95MaxMs:20,
          d1QueriesP95Max:5,d1RowsReadP95Max:40}]},
      recording:{sourceCommit:PIN,environment:'LOCAL_SYNTHETIC',
        datasetRef:'SYNTH-DATA-001',captureId:'SYNTH-PERF-001',
        capturedAt:'2026-11-17T07:00:00.000Z',
        workloads:[{workloadId:'PARTY_LEDGER',
          samples:Array.from({length:100},()=>({
            latencyMs:80,cpuMs:10,d1Queries:2,d1RowsRead:30
          }))}]}
    }
  };
};
function withFile(fn){
  const dir=mkdtempSync(join(tmpdir(),'m10-packet-test-'));
  try{
    const file=join(dir,'private-evidence.json');
    writeFileSync(file,JSON.stringify(evidence()),{mode:0o600});
    return fn(file,dir);
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const run=args=>spawnSync(process.execPath,[cli,...args],{
  encoding:'utf8',timeout:20000,maxBuffer:256*1024
});

test('offline complete synthetic packet prints only candidate report and does not mutate input file',()=>{
  withFile(file=>{
    const before=readFileSync(file,'utf8');
    const r=run([file]);
    assert.equal(r.status,0,r.stderr);
    assert.equal(r.stderr,'');
    const out=JSON.parse(r.stdout);
    assert.equal(out.candidateEvidenceComplete,true);
    assert.equal(out.authorizesImport,false);
    assert.equal(out.productionReady,false);
    assert.equal(readFileSync(file,'utf8'),before);
    assert.doesNotMatch(r.stdout,
      /25000|BACKUP-001|GROSS-SOURCE|SYNTH-PERF|legacyIdDigest|rowDigest|amountMinor|PRIVATE/);
  });
});
test('stale gross Party evidence reports only fixed blocker code, exit 2',()=>{
  withFile(file=>{
    const x=evidence();x.gross.d1.capturedAt='2026-11-17T06:12:00.000Z';
    writeFileSync(file,JSON.stringify(x));
    const r=run([file]);
    assert.equal(r.status,2);
    const out=JSON.parse(r.stdout);
    assert.equal(out.candidateEvidenceComplete,false);
    assert.equal(out.issues.find(v=>v.code==='PACKET_GROSS_CAPTURE_AFTER_BACKUP').count,1);
    assert.doesNotMatch(r.stdout,/06:12|25000|GROSS-D1|private-evidence.json/);
  });
});
test('invalid JSON never reveals source rows or absolute file path',()=>{
  withFile(file=>{
    writeFileSync(file,'{PRIVATE-CUSTOMER-SECRET\n');
    const r=run([file]);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
    assert.match(r.stderr,/M10 offline evidence packet rejected/);
    assert.doesNotMatch(r.stderr,/PRIVATE|CUSTOMER|SECRET|private-evidence.json|m10-packet-test/);
  });
});
test('private unexpected fields fail redacted without printing supplied customer PII',()=>{
  withFile(file=>{
    const x=evidence();x.gross.d1.accounts[0].customerPhone='PRIVATE-01700000000';
    writeFileSync(file,JSON.stringify(x));
    const r=run([file]);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
    assert.doesNotMatch(r.stderr,/PRIVATE|01700000000|private-evidence.json/);
  });
});
test('missing args, multiple args and flag-like args fail without reading any input',()=>{
  for(const args of [[],['--remote'],['--apply'],['a','b']]){
    const r=run(args);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
    assert.match(r.stderr,/M10 offline evidence packet rejected/);
  }
});
test('symlinks rejected by no-follow open even when target is valid',()=>{
  withFile((file,dir)=>{
    const link=join(dir,'evidence-link.json');
    symlinkSync(file,link);
    const r=run([link]);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
  });
});
test('nonexistent or directory paths do not leak filesystem locations',()=>{
  withFile((file,dir)=>{
    for(const path of [join(dir,'PRIVATE-CUSTOMER-SECRET.json'),dir]){
      const r=run([path]);
      assert.equal(r.status,2);
      assert.equal(r.stdout,'');
      assert.doesNotMatch(r.stderr,/PRIVATE|CUSTOMER|SECRET|m10-packet-test/);
    }
  });
});
