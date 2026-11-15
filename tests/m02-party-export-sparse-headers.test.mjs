import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyExportCompleteness} from '../src/party/export-column-coverage.js';

const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const baseline=JSON.parse(readFileSync(
  new URL('./fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
const manifest=Object.fromEntries(groups.map(group=>[
  group,inventory.tables.find(t=>t.sheetKey===group).columns
]));
function fixture(){
  const sourceRows=structuredClone(baseline),sourceHeaders={};
  for(const group of groups){
    sourceHeaders[group]=[...manifest[group]];
    sourceRows[group]=sourceRows[group].map(row=>({
      ...Object.fromEntries(manifest[group].map(name=>[name,''])),...row
    }));
  }
  return {sourceRows,sourceHeaders};
}
const issue=(report,group)=>report.issues.find(x=>
  x.sourceGroup===group&&x.code==='HEADER_MISMATCH');

test('holes at first, middle or final original header cannot pass any Party master group',()=>{
  for(const group of groups){
    const expected=manifest[group];
    for(const index of [0,Math.floor(expected.length/2),expected.length-1]){
      const input=fixture();
      delete input.sourceHeaders[group][index];
      assert.equal(input.sourceHeaders[group].length,expected.length);
      assert.equal(Object.hasOwn(input.sourceHeaders[group],index),false);
      assert.equal(Object.hasOwn(input.sourceRows[group][0],expected[index]),true);
      const before=structuredClone(input);
      const report=validatePartyExportCompleteness(input);
      assert.equal(report.schemaMatches,false,group+' missing header at '+index);
      assert.equal(report.offlineExportComplete,false,group+' must not pass source coverage');
      assert.deepEqual(issue(report,group),{
        sourceGroup:group,code:'HEADER_MISMATCH',count:1
      });
      assert.equal(report.counts.headerIssues,1);
      assert.equal(report.counts.missingFields,0);
      assert.deepEqual(input,before,'validation must not fill sparse original metadata');
      assert.doesNotMatch(JSON.stringify(report),
        /CUS-001|SUP-001|VEN-001|FIN-001|PAY-001|Rahim|01700000000/);
    }
  }
});

test('sparse source financial and identity header evidence fails even with complete source cells',()=>{
  const sourceHeaders=fixture().sourceHeaders;
  const input=fixture();
  const named={
    CUSTOMERS:'Current Due',SUPPLIERS:'Opening Balance',
    VENDORS:'Current Receivable',
    FINANCE_PERSONS:'Roles',EXPENSE_PAYEES:'Payee ID'
  };
  for(const [group,name] of Object.entries(named)){
    const index=sourceHeaders[group].indexOf(name);
    assert.ok(index>=0,name);
    delete input.sourceHeaders[group][index];
    assert.equal(Object.hasOwn(input.sourceRows[group][0],name),true);
  }
  const report=validatePartyExportCompleteness(input);
  assert.equal(report.schemaMatches,false);
  assert.equal(report.offlineExportComplete,false);
  assert.equal(report.rowCoverageComplete,true,
    'row field completeness alone cannot certify missing source sheet headers');
  assert.equal(report.counts.headerIssues,5);
  assert.deepEqual(report.issues,groups.map(group=>({
    sourceGroup:group,code:'HEADER_MISMATCH',count:1
  })).sort((a,b)=>a.sourceGroup.localeCompare(b.sourceGroup)));
});

test('five fully dense original header lists and all source rows remain valid',()=>{
  const input=fixture(),before=structuredClone(input);
  const report=validatePartyExportCompleteness(input);
  assert.equal(report.offlineExportComplete,true);
  assert.equal(report.schemaMatches,true);
  assert.equal(report.rowCoverageComplete,true);
  assert.deepEqual(report.issues,[]);
  assert.equal(report.counts.sourceRows,5);
  assert.deepEqual(input,before);
});

test('explicit undefined, swapped, extra and missing-column arrays remain rejected',()=>{
  for(const kind of ['undefined','swap','extra','short']){
    const input=fixture();
    const arr=input.sourceHeaders.CUSTOMERS;
    if(kind==='undefined')arr[2]=undefined;
    if(kind==='swap')[arr[1],arr[2]]=[arr[2],arr[1]];
    if(kind==='extra')arr.push('SENSITIVE_UNKNOWN');
    if(kind==='short')arr.pop();
    const report=validatePartyExportCompleteness(input);
    assert.equal(report.offlineExportComplete,false,kind);
    assert.deepEqual(issue(report,'CUSTOMERS'),{
      sourceGroup:'CUSTOMERS',code:'HEADER_MISMATCH',count:1
    });
    assert.doesNotMatch(JSON.stringify(report),/SENSITIVE_UNKNOWN/);
  }
});

test('header audit report is metadata only and has no identity merge or money posting',()=>{
  const input=fixture();
  delete input.sourceHeaders.EXPENSE_PAYEES[1];
  const report=validatePartyExportCompleteness(input);
  assert.ok(report.issues.every(x=>
    groups.includes(x.sourceGroup)&&
    Object.keys(x).sort().join(',')==='code,count,sourceGroup'));
  for(const key of ['partyLinks','approvedGroups','grossCurrentTotalsMinor',
    'cashMovementMinor','postedLedgerRows','sourceRows']){
    assert.equal(Object.hasOwn(report,key),false,key);
  }
});
