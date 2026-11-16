import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFinanceTransactionExport} from '../src/party/finance-export-coverage.js';

const inventory=JSON.parse(readFileSync(
  new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const columns=inventory.tables.find(x=>x.sheetKey==='FINANCE_TRANSACTIONS').columns;
const row=(id,index,flag='FALSE',amount='17.40')=>({
  ...Object.fromEntries(columns.map(name=>[name,''])),
  'Finance ID':id,'Person ID':'SYN-PER-001',
  'Transaction Type':'Owner Investment',Person:'Synthetic Confidential Party',
  Amount:amount,'Is Deleted':flag,_rowIndex:index
});
function example(){
  return {
    sourceHeaders:[...columns],
    sourceRows:[row('SYN-FIN-001',2)],
    declaredRowCount:1
  };
}
const inspect=data=>validateFinanceTransactionExport(data);
const unsafe=report=>report.issues.find(i=>i.code==='UNSAFE_VALUE');

test('numeric Finance deletion markers cannot silently certify an active transaction',()=>{
  for(const flag of [0,1,2,1.5,Number.MAX_SAFE_INTEGER]){
    const input=example(),before=structuredClone(input);
    input.sourceRows[0]['Is Deleted']=flag;
    const original=structuredClone(input);
    const result=inspect(input);
    assert.equal(result.offlineExportComplete,false,String(flag));
    assert.deepEqual(unsafe(result),{code:'UNSAFE_VALUE',count:1});
    assert.equal(result.counts.unsafeValues,1);
    assert.deepEqual(input,original,'export validation must not change source flags');
    assert.notDeepEqual(input,before);
  }
});

test('unknown textual deletion aliases must not become assumed live Finance rows',()=>{
  for(const flag of ['1','0','YES','No','DELETED','TRUE-ish']){
    const input=example();
    input.sourceRows[0]['Is Deleted']=flag;
    const result=inspect(input);
    assert.equal(result.offlineExportComplete,false,flag);
    assert.deepEqual(unsafe(result),{code:'UNSAFE_VALUE',count:1},flag);
    assert.equal(result.counts.invalidActiveAmounts,0,
      'invalid soft-delete provenance is independent of a valid positive Amount');
  }
});

test('two ambiguous Finance deletion flags are counted without revealing source IDs',()=>{
  const input=example();
  input.sourceRows.push(row('SYN-FIN-002',3,'DELETED','25.55'));
  input.sourceRows[0]['Is Deleted']=1;
  input.declaredRowCount=2;
  const before=structuredClone(input);
  const result=inspect(input);
  assert.equal(result.offlineExportComplete,false);
  assert.deepEqual(unsafe(result),{code:'UNSAFE_VALUE',count:2});
  assert.equal(result.counts.observedRows,2);
  assert.equal(result.counts.declaredRows,2);
  assert.deepEqual(input,before);
  const serialized=JSON.stringify(result);
  assert.doesNotMatch(serialized,/SYN-FIN-001|SYN-FIN-002|SYN-PER-001|Synthetic Confidential Party|17\.40|25\.55|DELETED/);
  assert.ok(result.issues.every(issue=>
    Object.keys(issue).sort().join(',')==='code,count'));
});

test('original blank/boolean/TRUE/FALSE soft-delete markers remain valid',()=>{
  for(const flag of ['', ' ', null, false, true,
    'TRUE',' true ','\tTrue\n','FALSE',' false ','\tfalse\n']){
    const input=example();
    input.sourceRows[0]['Is Deleted']=flag;
    const original=structuredClone(input);
    const result=inspect(input);
    assert.equal(result.offlineExportComplete,true,JSON.stringify(flag));
    assert.deepEqual(result.issues,[]);
    assert.equal(result.counts.unsafeValues,0);
    assert.deepEqual(input,original);
  }
});

test('valid soft-deleted source row still permits blank Amount and original Finance ID',()=>{
  for(const flag of [true,'TRUE',' true ','\ttrue\n']){
    const input=example();
    input.sourceRows[0]['Is Deleted']=flag;
    input.sourceRows[0].Amount='';
    const before=structuredClone(input);
    const result=inspect(input);
    assert.equal(result.offlineExportComplete,true,String(flag));
    assert.equal(result.counts.invalidActiveAmounts,0);
    assert.equal(result.counts.missingIds,0);
    assert.deepEqual(input,before);
  }
});

test('valid active Finance record still requires positive exact-cent Amount',()=>{
  for(const flag of ['',null,false,'FALSE',' false ']){
    const input=example();
    input.sourceRows[0]['Is Deleted']=flag;
    input.sourceRows[0].Amount='0';
    const result=inspect(input);
    assert.equal(result.offlineExportComplete,false,String(flag));
    assert.deepEqual(result.issues.find(i=>i.code==='INVALID_ACTIVE_AMOUNT'),
      {code:'INVALID_ACTIVE_AMOUNT',count:1});
    assert.equal(unsafe(result),undefined);
  }
});
