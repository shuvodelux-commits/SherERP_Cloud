import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePartyImportSnapshot} from '../src/party/import-snapshot-guard.js';

const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));
const source=()=>fixture('party-import.synthetic.json');
const approvals=()=>fixture('party-approved.synthetic.json');
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
const inspect=(reviewedSnapshot=source(),candidateSnapshot=source(),approvedGroups=approvals())=>
  validatePartyImportSnapshot({reviewedSnapshot,candidateSnapshot,approvedGroups});
const provenanceError=error=>error instanceof Error &&
  error.message==='Invalid Party source row provenance';

test('each original master group rejects a non-safe reviewed physical row before human review',()=>{
  for(const group of groups){
    const reviewed=source(),candidate=source();
    reviewed[group][0]._rowIndex=2**53;
    const unchanged=structuredClone({reviewed,candidate});
    assert.throws(()=>inspect(reviewed,candidate),provenanceError,group);
    assert.deepEqual({reviewed,candidate},unchanged);
  }
});

test('each candidate master group rejects 2**53 before source row drift or approval replay',()=>{
  for(const group of groups){
    const reviewed=source(),candidate=source();
    candidate[group][0]._rowIndex=2**53;
    assert.throws(()=>inspect(reviewed,candidate),provenanceError,group);
  }
});

test('huge finite source row numbers remain invalid even when reviewed and candidate match',()=>{
  for(const index of [Number.MAX_SAFE_INTEGER+1,1e30,Number.MAX_VALUE]){
    const reviewed=source(),candidate=source();
    reviewed.CUSTOMERS[0]._rowIndex=index;
    candidate.CUSTOMERS[0]._rowIndex=index;
    assert.throws(()=>inspect(reviewed,candidate),provenanceError);
  }
});

test('first data row and highest safe integer position retain stable source-row comparison',()=>{
  const reviewed=source(),candidate=source();
  reviewed.CUSTOMERS[0]._rowIndex=Number.MAX_SAFE_INTEGER;
  candidate.CUSTOMERS[0]._rowIndex=Number.MAX_SAFE_INTEGER;
  reviewed.SUPPLIERS[0]._rowIndex=2;
  candidate.SUPPLIERS[0]._rowIndex=2;
  const before=structuredClone({reviewed,candidate});
  const result=inspect(reviewed,candidate);
  assert.equal(result.sourceSnapshotMatches,true);
  assert.equal(result.offlineRehearsalClear,true);
  assert.equal(result.counts.changedRows,0);
  assert.equal(result.counts.addedRows,0);
  assert.equal(result.counts.removedRows,0);
  assert.deepEqual(result.issues,[]);
  assert.deepEqual({reviewed,candidate},before);
});

test('optional omitted row position remains valid when exact source ID is available',()=>{
  const reviewed=source(),candidate=source();
  delete reviewed.CUSTOMERS[0]._rowIndex;
  delete candidate.CUSTOMERS[0]._rowIndex;
  const before=structuredClone({reviewed,candidate});
  const result=inspect(reviewed,candidate);
  assert.equal(result.sourceSnapshotMatches,true);
  assert.equal(result.offlineRehearsalClear,true);
  assert.deepEqual({reviewed,candidate},before);
});

test('duplicate or invalid low original Sheet position still fails with redacted provenance error',()=>{
  const original=source(),candidate=source();
  candidate.VENDORS[0]._rowIndex=1;
  assert.throws(()=>inspect(original,candidate),provenanceError);
  candidate.VENDORS[0]._rowIndex=1.5;
  assert.throws(()=>inspect(original,candidate),provenanceError);
  candidate.VENDORS[0]._rowIndex='2';
  assert.throws(()=>inspect(original,candidate),provenanceError);
  candidate.VENDORS[0]._rowIndex=null;
  assert.throws(()=>inspect(original,candidate),provenanceError);
});

test('source-row provenance errors never disclose IDs, phone, balances or approval references',()=>{
  const original=source(),candidate=source();
  original.SUPPLIERS[0]._rowIndex=2**53;
  original.SUPPLIERS[0]['Current Due']='987654.32';
  let error;
  try{inspect(original,candidate);}catch(e){error=e;}
  assert.ok(error instanceof Error);
  assert.equal(error.message,'Invalid Party source row provenance');
  assert.doesNotMatch(String(error),/SUP-001|CUS-001|Rahim|01700000000|987654|REVIEW-001|9007199254740992/);
});
