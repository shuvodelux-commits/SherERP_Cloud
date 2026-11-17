import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const exe=fileURLToPath(new URL('../scripts/m10-gross-party-check.mjs',import.meta.url));
const pin='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const hex=n=>n.toString(16).padStart(64,'0');
const domains=[
  {sourceGroup:'CUSTOMERS',basis:'SOURCE_CURRENT'},
  {sourceGroup:'CUSTOMERS',basis:'HISTORICAL_OPENING'},
  {sourceGroup:'SUPPLIERS',basis:'SOURCE_CURRENT'},
  {sourceGroup:'SUPPLIERS',basis:'HISTORICAL_OPENING'},
  {sourceGroup:'VENDORS',basis:'SOURCE_CURRENT'},
  {sourceGroup:'FINANCE_PERSONS',basis:'SOURCE_CURRENT'}
];
const accounts=()=>[{
  sourceGroup:'CUSTOMERS',legacyIdDigest:hex(1234),
  accountKind:'CUSTOMER_RECEIVABLE',sourceField:'Current Due',
  basis:'SOURCE_CURRENT',currency:'BDT',amountMinor:'12345'
}];
const evidence=()=>({
  sourcePlanReviewed:true,identityReviewsPending:0,
  source:{captureId:'SOURCE-LOCAL-001',capturedAt:'2026-11-17T07:00:00.000Z',
    sourceCommit:pin,domains:structuredClone(domains),accounts:accounts()},
  d1:{captureId:'D1-LOCAL-0001',capturedAt:'2026-11-17T07:30:00.000Z',
    sourceCommit:pin,domains:structuredClone(domains),accounts:accounts()}
});
function withFixture(fn){
  const root=mkdtempSync(join(tmpdir(),'m10-gross-cli-'));
  try{
    const file=join(root,'evidence.json');
    writeFileSync(file,JSON.stringify(evidence()),{mode:0o600});
    return fn(file,root);
  }finally{rmSync(root,{recursive:true,force:true});}
}
const run=(args)=>spawnSync(process.execPath,[exe,...args],{
  encoding:'utf8',timeout:15000,maxBuffer:256*1024
});
test('zero-write local synthetic evidence file yields only candidate report with unconditional release NO-GO',()=>{
  withFixture(file=>{
    const r=run([file]);
    assert.equal(r.status,0,r.stderr);
    const o=JSON.parse(r.stdout);
    assert.equal(o.candidateGrossParity,true);
    assert.equal(o.authorizesImport,false);
    assert.equal(o.authorizesPosting,false);
    assert.equal(o.authorizesSettlement,false);
    assert.equal(o.productionReady,false);
    assert.deepEqual(o.issues,[]);
    assert.equal(r.stderr,'');
    assert.doesNotMatch(r.stdout,/12345|SOURCE-LOCAL|D1-LOCAL|legacyIdDigest|customerPhone|amountMinor/);
  });
});
test('one-cent gross mismatch emits aggregate code only and exits with nonzero status',()=>{
  withFixture(file=>{
    const x=evidence();x.d1.accounts[0].amountMinor='12346';
    writeFileSync(file,JSON.stringify(x));
    const r=run([file]);
    assert.equal(r.status,2);
    const o=JSON.parse(r.stdout);
    assert.equal(o.candidateGrossParity,false);
    assert.equal(o.issues.find(x=>x.code==='GROSS_CURRENT_BALANCE_MISMATCH').count,1);
    assert.doesNotMatch(r.stdout,/12345|12346|SOURCE-LOCAL|D1-LOCAL|legacyIdDigest|amountMinor/);
  });
});
test('malformed JSON with secret-bearing input is rejected without showing file contents or path',()=>{
  withFixture(file=>{
    writeFileSync(file,'{PRIVATE-CUSTOMER-PHONE-01700000000');
    const r=run([file]);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
    assert.match(r.stderr,/M10 local gross Party evidence rejected/);
    assert.doesNotMatch(r.stderr,/PRIVATE|CUSTOMER|01700000000|evidence.json|m10-gross-cli/);
  });
});
test('invalid evidence fields fail redacted with no private data in stdout',()=>{
  withFixture(file=>{
    const x=evidence();x.d1.accounts[0].customerPhone='PRIVATE-PHONE-SECRET';
    writeFileSync(file,JSON.stringify(x));
    const r=run([file]);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
    assert.doesNotMatch(r.stderr,/PRIVATE|PHONE-SECRET|evidence.json/);
  });
});
test('missing or extraneous CLI arguments fail closed',()=>{
  const a=run([]),b=run(['--remote']),c=run(['a','b']);
  for(const r of [a,b,c]){
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
    assert.match(r.stderr,/M10 local gross Party evidence rejected/);
  }
});
test('missing explicit file path fails redacted',()=>{
  const r=run(['/nonexistent/m10-private-customer-secret.json']);
  assert.equal(r.status,2);
  assert.equal(r.stdout,'');
  assert.doesNotMatch(r.stderr,/nonexistent|customer-secret/);
});
test('symbolic links are not followed as evidence inputs',()=>{
  withFixture((file,root)=>{
    const link=join(root,'link.json');
    symlinkSync(file,link);
    const r=run([link]);
    assert.equal(r.status,2);
    assert.equal(r.stdout,'');
  });
});
