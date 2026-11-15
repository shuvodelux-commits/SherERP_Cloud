import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyExportCompleteness} from '../src/party/export-column-coverage.js';
import {rolesForLegacyRow} from '../src/party/legacy-contracts.js';

const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const fixture=JSON.parse(readFileSync(
  new URL('./fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
function source(){
  const sourceHeaders=Object.fromEntries(groups.map(group=>[
    group,[...inventory.tables.find(t=>t.sheetKey===group).columns]
  ]));
  const sourceRows=structuredClone(fixture);
  for(const group of groups){
    sourceRows[group]=sourceRows[group].map(row=>({
      ...Object.fromEntries(sourceHeaders[group].map(field=>[field,''])),...row
    }));
  }
  return {sourceRows,sourceHeaders};
}
const check=input=>validatePartyExportCompleteness(input);
const issue=report=>report.issues.find(x=>
  x.sourceGroup==='FINANCE_PERSONS'&&x.code==='UNSAFE_VALUE');

test('Finance Person Roles must not certify numbers or booleans as original source text',()=>{
  for(const invalid of [12,0,true,false,1.25]){
    const input=source(),before=structuredClone(input);
    input.sourceRows.FINANCE_PERSONS[0].Roles=invalid;
    const untouched=structuredClone(input);
    const report=check(input);
    assert.equal(report.schemaMatches,true);
    assert.equal(report.rowCoverageComplete,false,String(invalid));
    assert.equal(report.offlineExportComplete,false,String(invalid));
    assert.deepEqual(issue(report),{
      sourceGroup:'FINANCE_PERSONS',code:'UNSAFE_VALUE',count:1
    });
    assert.equal(report.counts.unsafeValues,1);
    assert.deepEqual(input,untouched);
    assert.notDeepEqual(input,before);
  }
});

test('Finance Person legacy Person Type must reject numeric and boolean fallback provenance',()=>{
  for(const invalid of [123,0,true,false]){
    const input=source();
    input.sourceRows.FINANCE_PERSONS[0].Roles='';
    input.sourceRows.FINANCE_PERSONS[0]['Person Type']=invalid;
    const report=check(input);
    assert.equal(report.offlineExportComplete,false,String(invalid));
    assert.deepEqual(issue(report),{
      sourceGroup:'FINANCE_PERSONS',code:'UNSAFE_VALUE',count:1
    });
  }
});

test('two malformed Finance role source fields count as two unsafe cells',()=>{
  const input=source();
  input.sourceRows.FINANCE_PERSONS[0].Roles=true;
  input.sourceRows.FINANCE_PERSONS[0]['Person Type']=42;
  const report=check(input);
  assert.equal(report.offlineExportComplete,false);
  assert.deepEqual(issue(report),{
    sourceGroup:'FINANCE_PERSONS',code:'UNSAFE_VALUE',count:2
  });
  assert.equal(report.counts.headerIssues,0);
  assert.equal(report.counts.missingFields,0);
  assert.equal(report.counts.unsafeValues,2);
});

test('canonical and historical blank/null role fields preserve original role fallback',()=>{
  for(const [roles,personType,wanted] of [
    ['Owner,Lender,Borrower','Owner',['Owner','Lender','Borrower']],
    ['','Borrower',['Borrower']],
    [null,'Lender',['Lender']],
    ['',null,['Owner']],
    [null,null,['Owner']]
  ]){
    const input=source(),before=structuredClone(input);
    const record=input.sourceRows.FINANCE_PERSONS[0];
    record.Roles=roles;
    record['Person Type']=personType;
    const unchanged=structuredClone(input);
    const report=check(input);
    assert.equal(report.offlineExportComplete,true,JSON.stringify([roles,personType]));
    assert.deepEqual(rolesForLegacyRow('FINANCE_PERSONS',record),wanted);
    assert.deepEqual(input,unchanged);
    assert.notDeepEqual(input,before);
  }
});

test('numeric source balances remain valid; diagnostics redact original role and identity values',()=>{
  const input=source();
  input.sourceRows.CUSTOMERS[0]['Current Due']=12.50;
  input.sourceRows.SUPPLIERS[0]['Opening Balance']=-18.75;
  input.sourceRows.VENDORS[0]['Current Receivable']=9.25;
  const before=structuredClone(input);
  assert.equal(check(input).offlineExportComplete,true,
    'financial balance numeric cells still use exact minor precision checks');
  input.sourceRows.FINANCE_PERSONS[0].Roles=true;
  const corrupted=structuredClone(input),report=check(input);
  assert.equal(report.offlineExportComplete,false);
  assert.deepEqual(input,corrupted);
  assert.notDeepEqual(input,before);
  assert.doesNotMatch(JSON.stringify(report),/FIN-001|Rahim|01700000000|Borrower|12\.5|18\.75|9\.25/);
  assert.ok(report.issues.every(x=>
    Object.keys(x).sort().join(',')==='code,count,sourceGroup'));
  assert.equal(report.counts.unsafeValues,1);
});
