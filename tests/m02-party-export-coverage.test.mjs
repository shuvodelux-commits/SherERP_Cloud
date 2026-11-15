import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyExportCompleteness} from '../src/party/export-column-coverage.js';

const src=JSON.parse(readFileSync(new URL('./fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
const headers=()=>Object.fromEntries(groups.map(g=>[
  g,[...inventory.tables.find(t=>t.sheetKey===g).columns]
]));
function complete(){
  const sourceRows=structuredClone(src);
  const sourceHeaders=headers();
  for(const group of groups){
    sourceRows[group]=sourceRows[group].map(row=>({
      ...Object.fromEntries(sourceHeaders[group].map(col=>[col,''])),
      ...row
    }));
  }
  return {sourceRows,sourceHeaders};
}
const codes=r=>r.issues.map(x=>x.code);
const issue=(r,group,code)=>r.issues.find(x=>x.sourceGroup===group&&x.code===code);
const inspect=(data=complete())=>validatePartyExportCompleteness(data);

test('all five pinned GAS master headers and complete raw source rows pass offline coverage',()=>{
  const report=inspect();
  assert.equal(report.formatVersion,1);
  assert.equal(report.schemaMatches,true);
  assert.equal(report.rowCoverageComplete,true);
  assert.equal(report.offlineExportComplete,true);
  assert.deepEqual(report.issues,[]);
  assert.equal(report.counts.sourceRows,5);
  assert.equal(report.counts.missingFields,0);
  assert.equal(report.counts.unexpectedFields,0);
  assert.equal(report.counts.unsafeValues,0);
  assert.equal(report.counts.headerIssues,0);
});
test('export row order and JSON object key order do not affect validation',()=>{
  const input=complete();
  for(const group of groups){
    input.sourceRows[group].reverse();
    input.sourceRows[group]=input.sourceRows[group].map(row=>
      Object.fromEntries(Object.entries(row).reverse()));
  }
  assert.equal(inspect(input).offlineExportComplete,true);
});
test('source header order matters even if all names are present',()=>{
  const input=complete();
  input.sourceHeaders.CUSTOMERS.reverse();
  const report=inspect(input);
  assert.equal(report.schemaMatches,false);
  assert.equal(report.offlineExportComplete,false);
  assert.equal(issue(report,'CUSTOMERS','HEADER_MISMATCH').count,1);
});
test('missing Vendor Current Receivable header is blocked despite identical rows',()=>{
  const input=complete();
  input.sourceHeaders.VENDORS=input.sourceHeaders.VENDORS.filter(x=>x!=='Current Receivable');
  const report=inspect(input);
  assert.equal(report.schemaMatches,false);
  assert.equal(issue(report,'VENDORS','HEADER_MISMATCH').count,1);
});
test('duplicate original header cannot be hidden by a row object',()=>{
  const input=complete();
  input.sourceHeaders.SUPPLIERS.push('Current Due');
  assert.equal(issue(inspect(input),'SUPPLIERS','HEADER_MISMATCH').count,1);
});
test('unexpected column in a sheet export blocks source-schema compatibility',()=>{
  const input=complete();
  input.sourceHeaders.EXPENSE_PAYEES.push('Future Column');
  assert.equal(inspect(input).offlineExportComplete,false);
});
test('original Customer Opening Balance and Current Due must have fields even if blank',()=>{
  for(const name of ['Opening Balance','Current Due']){
    const input=complete();
    delete input.sourceRows.CUSTOMERS[0][name];
    const report=inspect(input);
    assert.equal(report.schemaMatches,true);
    assert.equal(report.rowCoverageComplete,false);
    assert.equal(issue(report,'CUSTOMERS','MISSING_FIELD').count,1);
  }
});
test('original Supplier Opening Balance and Current Due must both be present',()=>{
  const input=complete();
  delete input.sourceRows.SUPPLIERS[0]['Opening Balance'];
  delete input.sourceRows.SUPPLIERS[0]['Current Due'];
  const r=inspect(input);
  assert.equal(issue(r,'SUPPLIERS','MISSING_FIELD').count,2);
});
test('Vendor payable and receivable must stay separate required export fields',()=>{
  const input=complete();
  delete input.sourceRows.VENDORS[0]['Current Due'];
  delete input.sourceRows.VENDORS[0]['Current Receivable'];
  assert.equal(issue(inspect(input),'VENDORS','MISSING_FIELD').count,2);
});
test('FINANCE_PERSONS Roles and Person Type source fields cannot disappear',()=>{
  const input=complete();
  delete input.sourceRows.FINANCE_PERSONS[0].Roles;
  delete input.sourceRows.FINANCE_PERSONS[0]['Person Type'];
  assert.equal(issue(inspect(input),'FINANCE_PERSONS','MISSING_FIELD').count,2);
});
test('original source ID, phone, status and deletion metadata must be present as fields',()=>{
  const input=complete();
  for(const name of ['Customer ID','Phone','Status','Is Deleted']){
    delete input.sourceRows.CUSTOMERS[0][name];
  }
  assert.equal(issue(inspect(input),'CUSTOMERS','MISSING_FIELD').count,4);
});
test('blank nullable original fields are allowed; no false requirement for positive money',()=>{
  const input=complete();
  input.sourceRows.CUSTOMERS[0]['Opening Balance']='';
  input.sourceRows.CUSTOMERS[0]['Current Due']=-25;
  input.sourceRows.VENDORS[0]['Current Receivable']=0;
  input.sourceRows.FINANCE_PERSONS[0].Roles='';
  assert.equal(inspect(input).offlineExportComplete,true);
});
test('numeric legacy ID is unsafe because zero-padded textual identity may be lost',()=>{
  const input=complete();
  input.sourceRows.CUSTOMERS[0]['Customer ID']=123;
  const r=inspect(input);
  assert.equal(r.offlineExportComplete,false);
  assert.equal(issue(r,'CUSTOMERS','UNSAFE_ID_OR_PHONE').count,1);
});
test('numeric legacy phone is unsafe because leading zero may be lost',()=>{
  const input=complete();
  input.sourceRows.SUPPLIERS[0].Phone=1700000000;
  const r=inspect(input);
  assert.equal(issue(r,'SUPPLIERS','UNSAFE_ID_OR_PHONE').count,1);
});
test('textual original ID and phone retain exact zero prefixes',()=>{
  const input=complete();
  input.sourceRows.CUSTOMERS[0]['Customer ID']='000123';
  input.sourceRows.CUSTOMERS[0].Phone='001700000000';
  assert.equal(inspect(input).offlineExportComplete,true);
});
test('unexpected row property is blocked unless it is allowed row provenance',()=>{
  const input=complete();
  input.sourceRows.CUSTOMERS[0]['Unknown Extra']='some value';
  assert.equal(issue(inspect(input),'CUSTOMERS','UNEXPECTED_FIELD').count,1);
});
test('synthetic _rowIndex provenance is allowed but invalid positions are not',()=>{
  const good=complete();
  assert.equal(inspect(good).offlineExportComplete,true);
  const bad=complete();bad.sourceRows.CUSTOMERS[0]._rowIndex=1.5;
  assert.equal(issue(inspect(bad),'CUSTOMERS','UNSAFE_VALUE').count,1);
});
test('NaN, Infinity, undefined and nested objects fail closed without leaking values',()=>{
  for(const invalid of [NaN,Infinity,undefined,{secret:'private'},['PRIVATE']]){
    const input=complete();input.sourceRows.CUSTOMERS[0]['Current Due']=invalid;
    const r=inspect(input);
    assert.equal(r.offlineExportComplete,false);
    assert.equal(issue(r,'CUSTOMERS','UNSAFE_VALUE').count,1);
  }
});
test('the five master groups are mandatory even when a source group has zero rows',()=>{
  const input=complete();
  input.sourceRows.VENDORS=[];
  assert.equal(inspect(input).offlineExportComplete,true);
  const missing=complete();delete missing.sourceHeaders.VENDORS;
  assert.throws(()=>inspect(missing),/Invalid Party export metadata/);
});
test('missing or extra source groups and malformed rows fail closed',()=>{
  const a=complete();delete a.sourceRows.CUSTOMERS;
  assert.throws(()=>inspect(a),/Invalid Party export snapshot/);
  const b=complete();b.sourceRows.UNKNOWN=[];
  assert.throws(()=>inspect(b),/Invalid Party export snapshot/);
  const c=complete();c.sourceRows.CUSTOMERS=[null];
  assert.throws(()=>inspect(c),/Invalid Party export snapshot/);
});
test('Party export coverage reports only group-coded counts and never PII or amounts',()=>{
  const input=complete();
  input.sourceRows.CUSTOMERS[0]['Opening Balance']={name:'Rahim',phone:'01700000000',amount:'99999'};
  input.sourceRows.SUPPLIERS[0].Phone=1700000000;
  const report=inspect(input);
  const output=JSON.stringify(report);
  assert.doesNotMatch(output,/Rahim|01700000000|CUS-001|SUP-001|REVIEW-001|99999|1700000000|Opening Balance/);
  assert.ok(report.issues.every(x=>groups.includes(x.sourceGroup)&&
    Object.keys(x).sort().join(',')==='code,count,sourceGroup'));
});
test('source rows and captured headers are immutable after completeness review',()=>{
  const input=complete(),before=structuredClone(input);
  inspect(input);
  assert.deepEqual(input,before);
});
test('frozen header list is source-pinned; no user-supplied partial schema can bypass it',()=>{
  const input=complete();
  input.sourceHeaders.CUSTOMERS=['Customer ID','Customer Name','Phone'];
  assert.equal(inspect(input).offlineExportComplete,false);
});
