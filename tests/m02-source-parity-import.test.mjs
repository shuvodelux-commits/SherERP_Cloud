import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {reviewOfflineSourceParity} from '../scripts/dry-run-source-parity.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/m02-source-parity.synthetic.json',import.meta.url),'utf8'));
const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const frozen=new Map(schema.tables.map(t=>[t.sheetKey,t.columns]));
function makeExport(){
 const groups=Object.fromEntries(schema.tables.map(t=>[t.sheetKey,{headers:[...t.columns],rows:[]}]));
 for(const item of fixture.rows){
  assert.ok(frozen.has(item.group));
  const headers=frozen.get(item.group);
  for(const field of Object.keys(item.values))assert.ok(headers.includes(field),
   'Unexpected synthetic fixture column for '+item.group);
  const values=headers.map(name=>Object.hasOwn(item.values,name)?item.values[name]:'');
  groups[item.group].rows.push({sheetRow:item.sheetRow,cells:values});
 }
 return {formatVersion:1,sourceCommit:pin,groups};
}
function compare(src=makeExport(),candidate=structuredClone(src)){
 return reviewOfflineSourceParity({schema,pinnedSourceCommit:pin,sourceExport:src,candidateExport:candidate});
}
function row(obj,group,index=0){return obj.groups[group].rows[index];}
function cell(obj,group,name,index=0){
 const groupData=obj.groups[group];
 return {record:groupData.rows[index],index:groupData.headers.indexOf(name)};
}
const issue=(report,group,code)=>report.issues.find(x=>x.sourceGroup===group&&x.code===code);
const sensitive=/01700000000|01900000000|Synthetic Rahim|synthetic-password-secret|synthetic-hash|synthetic-sensitive-text|000-P1|000-S1|000-V1|000-F1|000-E1|secret-not-printed/;

test('rehearses exact-text parity for all 49 frozen groups, including explicitly empty groups',()=>{
 const report=compare();
 assert.equal(report.formatVersion,1);
 assert.equal(report.sourceGroups,49);
 assert.equal(report.sourceRows,fixture.rows.length);
 assert.equal(report.candidateRows,fixture.rows.length);
 assert.equal(report.exactTextParity,true);
 assert.equal(report.d1Verified,false);
 assert.equal(report.productionReady,false);
 assert.equal(report.groups.length,49);
 assert.deepEqual(report.issues,[]);
 const products=report.groups.find(g=>g.sourceGroup==='PRODUCTS');
 assert.equal(products.sourceRows,1);
 assert.equal(products.candidateRows,1);
 assert.match(products.sourceDigest,/^[a-f0-9]{64}$/);
 assert.equal(products.candidateDigest,products.sourceDigest);
 assert.equal(report.groups.find(g=>g.sourceGroup==='DELETE_LOG').sourceRows,0);
 assert.doesNotMatch(JSON.stringify(report),sensitive);
});
test('a second replay is deterministic; transport row order does not redefine physical row identity',()=>{
 const source=makeExport(),candidate=structuredClone(source);
 candidate.groups.PURCHASE_ITEMS.rows.reverse();
 candidate.groups.SALE_ITEMS.rows.reverse();
 const a=compare(source,candidate),b=compare(structuredClone(source),structuredClone(candidate));
 assert.equal(a.exactTextParity,true);
 assert.deepEqual(a,b);
 assert.deepEqual(source,makeExport());
});
test('changing amount precision or leading zeros fails despite numerical equivalence',()=>{
 const source=makeExport(),candidate=structuredClone(source);
 const c=cell(candidate,'PRODUCTS','Purchase Price');c.record.cells[c.index]='4.375';
 const r=compare(source,candidate);
 assert.equal(r.exactTextParity,false);
 assert.equal(issue(r,'PRODUCTS','CELL_MISMATCH').count,1);
 assert.notEqual(r.groups.find(g=>g.sourceGroup==='PRODUCTS').sourceDigest,
                 r.groups.find(g=>g.sourceGroup==='PRODUCTS').candidateDigest);
});
test('Vendor payable and receivable remain separate; no net balance comparison',()=>{
 const source=makeExport(),candidate=structuredClone(source);
 let due=cell(candidate,'VENDORS','Current Due'),receivable=cell(candidate,'VENDORS','Current Receivable');
 due.record.cells[due.index]='006.00';
 receivable.record.cells[receivable.index]='004.00';
 assert.equal(compare(source,candidate).exactTextParity,false);
 assert.equal(issue(compare(source,candidate),'VENDORS','CELL_MISMATCH').count,1);
});
test('same Party name and phone in five distinct role groups never auto-merges identities',()=>{
 const report=compare(),src=makeExport();
 for(const key of ['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'])
  assert.equal(src.groups[key].rows.length,1);
 assert.equal(report.exactTextParity,true);
 const candidate=structuredClone(src);
 candidate.groups.SUPPLIERS.rows[0].cells[candidate.groups.SUPPLIERS.headers.indexOf('Supplier ID')]='000-P1';
 assert.equal(issue(compare(src,candidate),'SUPPLIERS','CELL_MISMATCH').count,1);
});
test('source physical row cannot be omitted, moved, duplicated, fractional, stringified or unsafe',()=>{
 for(const index of [undefined,1,1.5,'2',Number.MAX_SAFE_INTEGER+1]){
  const candidate=makeExport();
  candidate.groups.CUSTOMERS.rows[0].sheetRow=index;
  assert.throws(()=>compare(makeExport(),candidate),/rejected|INVALID_ROW_PROVENANCE/i);
 }
 const candidate=makeExport();
 candidate.groups.PURCHASE_ITEMS.rows[1].sheetRow=2;
 assert.throws(()=>compare(makeExport(),candidate),/rejected|DUPLICATE_ROW/i);
 const moved=makeExport();moved.groups.CUSTOMERS.rows[0].sheetRow=99;
 assert.equal(issue(compare(makeExport(),moved),'CUSTOMERS','ROW_PROVENANCE_MISMATCH').count,2);
});
test('silent row deletion or addition is detected with counts and exact provenance',()=>{
 const original=makeExport(),deleted=structuredClone(original);
 deleted.groups.SALE_ITEMS.rows.pop();
 const bad=compare(original,deleted);
 assert.equal(bad.exactTextParity,false);
 assert.equal(issue(bad,'SALE_ITEMS','ROW_COUNT_MISMATCH').count,1);
 assert.equal(issue(bad,'SALE_ITEMS','ROW_PROVENANCE_MISMATCH').count,1);
 const appended=structuredClone(original);
 appended.groups.LOGS.rows.push({sheetRow:9,cells:[...appended.groups.LOGS.rows[0].cells]});
 assert.equal(issue(compare(original,appended),'LOGS','ROW_COUNT_MISMATCH').count,1);
});
test('master and operation IDs must remain unique per source group, not across Party roles',()=>{
 const invalid=makeExport();
 invalid.groups.CUSTOMERS.rows.push({sheetRow:9,cells:[...invalid.groups.CUSTOMERS.rows[0].cells]});
 assert.throws(()=>compare(invalid),/rejected|DUPLICATE_RECORD_ID/i);
 const blank=makeExport();
 blank.groups.PRODUCTS.rows[0].cells[0]='';
 assert.throws(()=>compare(blank),/rejected|MISSING_RECORD_ID/i);
 const allowed=makeExport();
 assert.equal(allowed.groups.PURCHASE_ITEMS.rows.length,2);
 assert.equal(allowed.groups.SALE_ITEMS.rows.length,2);
 assert.equal(compare(allowed).exactTextParity,true);
});
test('frozen original columns and all 49 groups are mandatory on both sides',()=>{
 const source=makeExport(),candidate=makeExport();
 candidate.groups.CUSTOMERS.headers.reverse();
 assert.throws(()=>compare(source,candidate),/rejected|HEADER_MISMATCH/i);
 const bad=makeExport();delete bad.groups.CUSTOMERS;
 assert.throws(()=>compare(source,bad),/rejected|GROUP_COVERAGE/i);
 const extra=makeExport();extra.groups.UNAPPROVED={headers:[],rows:[]};
 assert.throws(()=>compare(extra),/rejected|GROUP_COVERAGE/i);
 const shortened=makeExport();shortened.groups.VENDORS.headers.pop();
 assert.throws(()=>compare(source,shortened),/rejected|HEADER_MISMATCH/i);
});
test('frozen original source commit cannot be replaced by older or supplementary repo identity',()=>{
 const source=makeExport();
 source.sourceCommit='590adfad128fe7155bfb7b608a2ed5665b202a9c';
 assert.throws(()=>compare(source),/rejected|SOURCE_COMMIT/i);
 const candidate=makeExport();candidate.sourceCommit='0000000000000000000000000000000000000000';
 assert.throws(()=>compare(makeExport(),candidate),/rejected|SOURCE_COMMIT/i);
});
test('no implicit numeric, date, boolean, object, undefined or NULL conversions are allowed',()=>{
 for(const value of [0,17.25,NaN,Infinity,false,null,undefined,{value:'secret'},['hello']]){
  const candidate=makeExport();
  const c=cell(candidate,'CUSTOMERS','Phone');
  c.record.cells[c.index]=value;
  assert.throws(()=>compare(makeExport(),candidate),/rejected|UNSAFE_TEXT/i);
 }
 const holes=makeExport();
 holes.groups.CUSTOMERS.rows[0].cells.pop();
 assert.throws(()=>compare(makeExport(),holes),/rejected|ROW_WIDTH/i);
});
test('Bengali text, ISO date/time text, initial zeros, barcode and money are byte-sensitive',()=>{
 const original=makeExport();
 for(const [group,col,value] of [
  ['PRODUCTS','Product Name','তারের রোল '],
  ['SALES','Time','9:00:00'],
  ['PURCHASES','Date','2026-1-1'],
  ['PRODUCTS','Barcode','88'],
  ['USERS','Mobile Number','1900000000'],
  ['SALES_DRAFTS','Items JSON','[{"p": "000P-001"}]']
 ]){
  const modified=structuredClone(original);
  const c=cell(modified,group,col);c.record.cells[c.index]=value;
  assert.equal(issue(compare(original,modified),group,'CELL_MISMATCH').count,1);
 }
});
test('source and candidate objects remain unchanged; no data is written',()=>{
 const source=makeExport(),candidate=structuredClone(source);
 const before=[structuredClone(source),structuredClone(candidate)];
 compare(source,candidate);
 assert.deepEqual([source,candidate],before);
});
test('malformed rows, versions and non-object groups are denied without leaking their values',()=>{
 const cases=[
  x=>{x.formatVersion=2;},
  x=>{x.groups.CUSTOMERS.rows[0]=null;},
  x=>{x.groups.CUSTOMERS.rows[0].leak='PRIVATE';},
  x=>{x.groups.CUSTOMERS={rows:[]};},
  x=>{x.groups.CUSTOMERS.rows='PRIVATE';}
 ];
 for(const mutate of cases){
  const data=makeExport();mutate(data);
  assert.throws(()=>compare(makeExport(),data),err=>
   !sensitive.test(err.message)&&/rejected|invalid|missing/i.test(err.message));
 }
});
test('CLI emits only group counts, hashes and safe issue codes; mismatches exit nonzero',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-parity-'));
 try{
  const path1=join(dir,'source.json'),path2=join(dir,'candidate.json');
  writeFileSync(path1,JSON.stringify(makeExport()));
  writeFileSync(path2,JSON.stringify(makeExport()));
  const cli=new URL('../scripts/dry-run-source-parity.mjs',import.meta.url).pathname;
  const good=spawnSync(process.execPath,[cli,path1,path2],{encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(good.stdout).exactTextParity,true);
  assert.doesNotMatch(good.stdout+good.stderr,sensitive);
  const candidate=makeExport();
  const c=cell(candidate,'SETTINGS','Value');c.record.cells[c.index]='changed-synthetic-password-secret-MUST-NOT-PRINT';
  writeFileSync(path2,JSON.stringify(candidate));
  const bad=spawnSync(process.execPath,[cli,path1,path2],{encoding:'utf8'});
  assert.equal(bad.status,1);
  assert.equal(JSON.parse(bad.stdout).exactTextParity,false);
  assert.equal(issue(JSON.parse(bad.stdout),'SETTINGS','CELL_MISMATCH').count,1);
  assert.doesNotMatch(bad.stdout+bad.stderr,sensitive);
  const rejected=spawnSync(process.execPath,[cli,path1],{encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.doesNotMatch(rejected.stderr,sensitive);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('source review cannot falsely assert D1, bank, stock, Party or production approval',()=>{
 const summary=compare();
 for(const status of ['d1Verified','productionReady'])assert.equal(summary[status],false);
 assert.equal(Object.hasOwn(summary,'stockBalance'),false);
 assert.equal(Object.hasOwn(summary,'partyNetBalance'),false);
 assert.equal(Object.hasOwn(summary,'authorizedToMigrate'),false);
});
