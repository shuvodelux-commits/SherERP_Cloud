import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,symlinkSync,truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {captureOfflineSourceFreeze,verifyOfflineSourceFreeze} from '../scripts/dry-run-source-freeze.mjs';
import {readLocalJsonFile} from '../scripts/dry-run-safe-input.mjs';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const fixture=JSON.parse(readFileSync(new URL('./fixtures/m02-source-parity.synthetic.json',import.meta.url),'utf8'));
function exportOf(){
 const groups=Object.fromEntries(inventory.tables.map(group=>[group.sheetKey,{headers:[...group.columns],rows:[]}]));
 for(const {group,sheetRow,values} of fixture.rows){
  const list=groups[group].headers;
  assert.ok(Object.keys(values).every(k=>list.includes(k)));
  groups[group].rows.push({sheetRow,cells:list.map(k=>values[k]??'')});
 }
 return {formatVersion:1,sourceCommit:pin,groups};
}
const countsOf=source=>Object.fromEntries(inventory.tables.map(g=>[g.sheetKey,source.groups[g.sheetKey].rows.length]));
const capture=(source=exportOf(),counts=countsOf(source))=>
 captureOfflineSourceFreeze({schema:inventory,pinnedSourceCommit:pin,sourceExport:source,declaredSourceCounts:counts});
const verify=(manifest,source=exportOf())=>verifyOfflineSourceFreeze({
 schema:inventory,pinnedSourceCommit:pin,candidateExport:source,freezeManifest:manifest
});
const code=(result,group,type)=>result.issues.find(x=>x.sourceGroup===group&&x.code===type);
const sensitive=/Synthetic Rahim|01700000000|01900000000|synthetic-password-secret|synthetic-hash|000-P1|000-S1|000-V1|secret-not-printed/;

test('independently supplied 49-group counts and source-shaped text create stable sealed digest evidence',()=>{
 const src=exportOf(),counts=countsOf(src);
 const original=[structuredClone(src),structuredClone(counts)];
 const manifest=capture(src,counts);
 assert.equal(manifest.formatVersion,1);
 assert.equal(manifest.sourceCommit,pin);
 assert.equal(manifest.scope,'offline-source-shaped');
 assert.equal(manifest.fullyCoveredGroups,49);
 assert.equal(manifest.totalRows,fixture.rows.length);
 assert.equal(manifest.groups.length,49);
 assert.equal(manifest.groups.find(x=>x.sourceGroup==='PRODUCTS').declaredRows,1);
 assert.equal(manifest.groups.find(x=>x.sourceGroup==='DELETE_LOG').declaredRows,0);
 assert.match(manifest.fingerprint,/^[a-f0-9]{64}$/);
 assert.deepEqual(original,[src,counts]);
 assert.doesNotMatch(JSON.stringify(manifest),sensitive);
 assert.equal(manifest.sourceApproved,false);
 assert.equal(manifest.d1Verified,false);
 assert.equal(manifest.productionReady,false);
 assert.deepEqual(verify(manifest).issues,[]);
 assert.equal(verify(manifest).freezeExactMatch,true);
});
test('transport order changes do not change the frozen group-level source fingerprint',()=>{
 const src=exportOf(),captureA=capture(src);
 src.groups.PURCHASE_ITEMS.rows.reverse();
 src.groups.SALE_ITEMS.rows.reverse();
 const captureB=capture(src);
 assert.deepEqual(captureA,captureB);
});
test('independent declared row count mismatch stops evidence capture, not silently accepted',()=>{
 const source=exportOf(),declared=countsOf(source);
 declared.PRODUCTS=2;
 assert.throws(()=>capture(source,declared),/DECLARED_SOURCE_COUNT_MISMATCH/i);
 const empty=countsOf(source);empty.LOGS=0;
 assert.throws(()=>capture(source,empty),/DECLARED_SOURCE_COUNT_MISMATCH/i);
});
test('every group needs a declared count; missing, extras and unsafe count inputs are blocked',()=>{
 const src=exportOf();
 for(const mod of [
  d=>{delete d.PRODUCTS;}, d=>{d.UNKNOWN=0;}, d=>{d.PRODUCTS=-1;},
  d=>{d.PRODUCTS=1.5;},d=>{d.PRODUCTS='1';},d=>{d.PRODUCTS=Number.MAX_SAFE_INTEGER+1;}
 ]){
  const counts=countsOf(src);mod(counts);
  assert.throws(()=>capture(src,counts),/DECLARED_SOURCE_COUNTS_INVALID/i);
 }
});
test('same-count but changed money or ID is detected by digest comparison and redacted status',()=>{
 const manifest=capture();
 const altered=exportOf();
 const headers=altered.groups.VENDORS.headers;
 const i=headers.indexOf('Current Receivable');
 altered.groups.VENDORS.rows[0].cells[i]='004.00';
 const verdict=verify(manifest,altered);
 assert.equal(verdict.freezeExactMatch,false);
 assert.equal(code(verdict,'VENDORS','SOURCE_DIGEST_MISMATCH').count,1);
 assert.equal(code(verdict,'VENDORS','SOURCE_ROW_COUNT_MISMATCH'),undefined);
 assert.equal(verdict.sourceApproved,false);
 assert.equal(verdict.d1Verified,false);
 assert.doesNotMatch(JSON.stringify(verdict),sensitive);
});
test('row loss and invented row fail by independently frozen counts and fingerprint',()=>{
 const manifest=capture(),missing=exportOf();
 missing.groups.SALE_ITEMS.rows.pop();
 const verdict=verify(manifest,missing);
 assert.equal(verdict.freezeExactMatch,false);
 assert.equal(code(verdict,'SALE_ITEMS','SOURCE_ROW_COUNT_MISMATCH').count,1);
 const padded=exportOf();
 padded.groups.LOGS.rows.push({sheetRow:3,cells:[...padded.groups.LOGS.rows[0].cells]});
 assert.equal(code(verify(manifest,padded),'LOGS','SOURCE_ROW_COUNT_MISMATCH').count,1);
});
test('tampered evidence metadata or baseline fingerprint is invalid, not verified',()=>{
 for(const mutate of [
  x=>{x.sourceCommit='0000000000000000000000000000000000000000';},
  x=>{x.fingerprint='a'.repeat(64);},
  x=>{x.groups[0].sourceDigest='a'.repeat(64);},
  x=>{x.groups[0].declaredRows=4;},
  x=>{x.groups.pop();},
  x=>{x.groups.reverse();},
  x=>{x.sourceApproved=true;},
  x=>{x.d1Verified=true;},
  x=>{x.groups[0].rawValues=['secret'];},
 ]){
  const manifest=structuredClone(capture());mutate(manifest);
  assert.throws(()=>verify(manifest),/INVALID_FREEZE_EVIDENCE|SOURCE_COMMIT/i);
 }
});
test('wrong original source commit and missing required column fail closed',()=>{
 const src=exportOf();
 src.sourceCommit='590adfad128fe7155bfb7b608a2ed5665b202a9c';
 assert.throws(()=>capture(src,countsOf(src)),/INVALID_EXPORT_OR_SOURCE_COMMIT/i);
 const valid=exportOf();valid.groups.PRODUCTS.headers.pop();
 assert.throws(()=>capture(valid,countsOf(valid)),/HEADER_MISMATCH/i);
});
test('existing source comparison and new evidence share the same canonical row/column digest',()=>{
 const src=exportOf(),manifest=capture(src);
 const verdict=verify(manifest,src);
 assert.equal(manifest.groups.find(x=>x.sourceGroup==='CUSTOMERS').sourceDigest,
  verdict.groups.find(x=>x.sourceGroup==='CUSTOMERS').candidateDigest);
});
test('local JSON reader accepts explicit regular file, rejects symlink and non-file paths',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-freeze-input-'));
 try{
  const p=join(dir,'source.json');
  writeFileSync(p,JSON.stringify({hello:'synthetic'}));
  assert.deepEqual(await readLocalJsonFile(p),{hello:'synthetic'});
  symlinkSync(p,join(dir,'source-link.json'));
  await assert.rejects(()=>readLocalJsonFile(join(dir,'source-link.json')));
  await assert.rejects(()=>readLocalJsonFile(dir));
  await assert.rejects(()=>readLocalJsonFile('/dev/null'));
  await assert.rejects(()=>readLocalJsonFile('https://example.com/private.json'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('oversize local JSON file rejected before its contents can be read',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-freeze-size-'));
 try{
  const p=join(dir,'large.json');
  writeFileSync(p,'{}');
  truncateSync(p,64*1024*1024+1);
  await assert.rejects(()=>readLocalJsonFile(p));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('capture and verification CLIs output metadata only; drift exits nonzero',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-freeze-cli-'));
 try{
  const src=exportOf(),sourcePath=join(dir,'private.json'),countsPath=join(dir,'counts.json'),
   manifestPath=join(dir,'manifest.json'),candidatePath=join(dir,'candidate.json');
  writeFileSync(sourcePath,JSON.stringify(src));
  writeFileSync(countsPath,JSON.stringify(countsOf(src)));
  const cli=new URL('../scripts/dry-run-source-freeze.mjs',import.meta.url).pathname;
  const cap=spawnSync(process.execPath,[cli,'--capture',sourcePath,countsPath],{encoding:'utf8'});
  assert.equal(cap.status,0,cap.stderr);
  const manifest=JSON.parse(cap.stdout);
  writeFileSync(manifestPath,cap.stdout);
  writeFileSync(candidatePath,JSON.stringify(src));
  const exact=spawnSync(process.execPath,[cli,'--verify',manifestPath,candidatePath],{encoding:'utf8'});
  assert.equal(exact.status,0,exact.stderr);
  assert.equal(JSON.parse(exact.stdout).freezeExactMatch,true);
  const altered=exportOf(),headers=altered.groups.SETTINGS.headers;
  altered.groups.SETTINGS.rows[0].cells[headers.indexOf('Value')]='privateChanged-SYNTHETIC-PASSWORD';
  writeFileSync(candidatePath,JSON.stringify(altered));
  const drift=spawnSync(process.execPath,[cli,'--verify',manifestPath,candidatePath],{encoding:'utf8'});
  assert.equal(drift.status,2);
  assert.equal(JSON.parse(drift.stdout).freezeExactMatch,false);
  assert.doesNotMatch(cap.stdout+exact.stdout+drift.stdout+drift.stderr,sensitive);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('both CLIs reject symlink input with fixed redactable error and no JSON data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-freeze-links-'));
 try{
  const source=exportOf(),a=join(dir,'source.json'),b=join(dir,'counts.json'),link=join(dir,'source-link.json');
  writeFileSync(a,JSON.stringify(source));writeFileSync(b,JSON.stringify(countsOf(source)));
  symlinkSync(a,link);
  const freeze=new URL('../scripts/dry-run-source-freeze.mjs',import.meta.url).pathname;
  const parity=new URL('../scripts/dry-run-source-parity.mjs',import.meta.url).pathname;
  for(const args of [[freeze,'--capture',link,b],[parity,link,a],[parity,'--references',link]]){
   const v=spawnSync(process.execPath,args,{encoding:'utf8'});
   assert.notEqual(v.status,0);
   assert.equal(v.stdout,'');
   assert.match(v.stderr,/rejected|invalid/i);
   assert.doesNotMatch(v.stderr,sensitive);
   assert.equal(v.stderr.includes(dir),false);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('snapshot evidence does not authorize money, role offset, staging or remote D1',()=>{
 const evidence=capture(),check=verify(evidence);
 for(const x of [evidence,check]){
  assert.equal(x.sourceApproved,false);
  assert.equal(x.productionReady,false);
  assert.equal(x.d1Verified,false);
  assert.equal(Object.hasOwn(x,'cashMovementMinor'),false);
  assert.equal(Object.hasOwn(x,'partyNetBalance'),false);
  assert.equal(Object.hasOwn(x,'remoteD1Writes'),false);
 }
});
