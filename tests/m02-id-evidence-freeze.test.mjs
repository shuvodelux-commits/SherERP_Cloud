import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,readFileSync as read,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {M02_ID_FAMILIES} from '../scripts/dry-run-id-floor.mjs';
import {captureM02IdEvidenceFreeze,verifyM02IdEvidenceFreeze} from '../scripts/dry-run-id-evidence-freeze.mjs';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const salt='ab'.repeat(32);
const cli=new URL('../scripts/dry-run-id-evidence-freeze.mjs',import.meta.url).pathname;
function make(){
 const groups={},counters={},declaredSourceCounts={};
 for(const f of M02_ID_FAMILIES){groups[f.sourceGroup]=[];counters[f.sourceGroup]='0';declaredSourceCounts[f.sourceGroup]=0;}
 groups.SALES=[{sheetRow:2,id:'INV-000001'},{sheetRow:9,id:'INV-000016'}];
 counters.SALES='4';declaredSourceCounts.SALES=2;
 return {formatVersion:1,sourceCommit:pin,groups,counters,declaredSourceCounts};
}
function capture(evidence=make(),overrides={}){
 return captureM02IdEvidenceFreeze({schema,pinnedSourceCommit:pin,evidence,salt,...overrides});
}
function verify(manifest,evidence=make()){
 return verifyM02IdEvidenceFreeze({schema,pinnedSourceCommit:pin,manifest,evidence});
}
function mutate(data){return structuredClone(data);}
function codes(result){return result.issues.map(i=>i.code);}
function run(args){return spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});}

test('captures 38 original families as salted hashes without original IDs/counters',()=>{
 const manifest=capture();
 assert.equal(manifest.families.length,38);
 assert.equal(manifest.salt,salt);
 assert.match(manifest.rootDigest,/^[a-f0-9]{64}$/);
 assert.equal(manifest.sourceToD1Reconciled,false);
 assert.equal(manifest.idIssuanceAuthorized,false);
 assert.equal(manifest.productionReady,false);
 assert.equal(manifest.sourceApproved,false);
 assert.ok(!JSON.stringify(manifest).includes('INV-000016'));
 assert.ok(!JSON.stringify(manifest).includes('INV-000017'));
 assert.ok(!JSON.stringify(manifest).includes('"4"'));
});
test('identical input independently verified returns only nonproduction candidate',()=>{
 const report=verify(capture());
 assert.equal(report.exactMatch,true);
 assert.equal(report.issues.length,0);
 assert.equal(report.sourceFamilies,38);
 assert.equal(report.d1Verified,false);
 assert.equal(report.independentCaptureVerified,false);
 assert.equal(report.idIssuanceAuthorized,false);
});
test('input array reorder preserves physical row lineage',()=>{
 const copy=make();
 copy.groups.SALES.reverse();
 assert.equal(verify(capture(),copy).exactMatch,true);
});
test('changed original ID with same count raises redacted commitment mismatch',()=>{
 const value=make(); value.groups.SALES[1].id='INV-000017';
 const report=verify(capture(),value);
 assert.equal(report.exactMatch,false);
 assert.ok(codes(report).includes('ORIGINAL_ID_ROW_DIGEST_MISMATCH'));
 assert.ok(!JSON.stringify(report).includes('INV-000017'));
});
test('swapping physical original sheet rows is not equivalent',()=>{
 const value=make();
 [value.groups.SALES[0].sheetRow,value.groups.SALES[1].sheetRow]=[9,2];
 assert.ok(codes(verify(capture(),value)).includes('ORIGINAL_ID_ROW_DIGEST_MISMATCH'));
});
test('counter change is detected separately from original row content',()=>{
 const value=make();value.counters.SALES='30';
 const report=verify(capture(),value);
 assert.deepEqual(codes(report),['ORIGINAL_COUNTER_DIGEST_MISMATCH']);
});
test('independently declared original ID-row count changes fail closed',()=>{
 const value=make();value.groups.SALES.pop();value.declaredSourceCounts.SALES=1;
 const report=verify(capture(),value);
 assert.ok(codes(report).includes('ORIGINAL_ROW_COUNT_MISMATCH'));
});
test('duplicate, malformed or missing counter evidence never makes a capture candidate',()=>{
 for(const value of ['INV-000016','INV-000016junk']){
  const evidence=make(); evidence.groups.SALES[0].id=value;
  assert.throws(()=>capture(evidence),/M02 ID freeze rejected/);
 }
 const incomplete=make();incomplete.counters.SALES=null;
 assert.throws(()=>capture(incomplete),/M02 ID freeze rejected/);
});
test('invalid candidate is redacted and never accepted',()=>{
 const value=make();value.groups.SALES[0].id='INV-000016';
 const report=verify(capture(),value);
 assert.equal(report.exactMatch,false);
 assert.ok(codes(report).includes('DUPLICATE_OR_REUSED_ID'));
 assert.ok(!JSON.stringify(report).includes('INV-000016'));
});
test('corrupted hash, salt, group order and unauthorized status are rejected',()=>{
 const initial=capture();
 for(const change of [
  m=>{m.families[0].rowDigest='0'.repeat(64);},
  m=>{m.salt='f'.repeat(64);},
  m=>{m.families.reverse();},
  m=>{m.productionReady=true;},
  m=>{m.families.pop();},
  m=>{m.extra='anything';}
 ]){
  const changed=mutate(initial);change(changed);
  assert.throws(()=>verify(changed),/M02 ID freeze rejected/);
 }
});
test('frozen source commit and exact 38-family schema are mandatory',()=>{
 assert.throws(()=>capture(make(),{pinnedSourceCommit:'0'.repeat(40)}),/M02/);
 const value=make();delete value.groups.PURCHASES;
 assert.throws(()=>capture(value),/M02/);
});
test('salt is valid 32-byte hex and changing salt changes the commitment',()=>{
 assert.notEqual(capture(make(),{salt:'cd'.repeat(32)}).rootDigest,capture().rootDigest);
 assert.throws(()=>capture(make(),{salt:'salt'}),/M02 ID freeze rejected/);
});
test('capture CLI writes exclusive 0600 private manifest and never prints evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-freeze-'));
 try {
  const input=join(dir,'input.json'),output=join(dir,'manifest.json');
  writeFileSync(input,JSON.stringify(make()));
  const created=run(['--capture',input,output]);
  assert.equal(created.status,0,created.stderr);
  assert.equal(statSync(output).mode&0o777,0o600);
  const privateManifest=JSON.parse(read(output,'utf8'));
  assert.equal(privateManifest.families.length,38);
  assert.ok(!created.stdout.includes(privateManifest.rootDigest));
  assert.ok(!created.stdout.includes('INV-000016'));
  const again=run(['--capture',input,output]);
  assert.equal(again.status,2);
  assert.deepEqual(JSON.parse(read(output,'utf8')),privateManifest);
  const result=run(['--verify',output,input]);
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).exactMatch,true);
  const bad=make();bad.groups.SALES[1].id='INV-000017';
  writeFileSync(input,JSON.stringify(bad));
  const mismatch=run(['--verify',output,input]);
  assert.equal(mismatch.status,2);
  assert.ok(!mismatch.stdout.includes('INV-000017'));
  assert.ok(!mismatch.stdout.includes(privateManifest.rootDigest));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI refuses URL inputs and does not echo private path or malformed JSON',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-freeze-'));
 try {
  const missing=join(dir,'not-existing.json');
  const r=run(['--verify','https://example.invalid/private',missing]);
  assert.equal(r.status,2);
  assert.ok(!r.stderr.includes(missing));
  assert.ok(!r.stdout.includes('example.invalid'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
