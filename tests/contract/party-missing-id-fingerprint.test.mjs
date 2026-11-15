import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../../src/party/party-import-plan.js';

const fixture=JSON.parse(readFileSync(
  new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const snapshot=()=>structuredClone(fixture);
const noId=()=>({'Customer ID':'','Customer Name':'Missing original reference',
  Phone:'01912345678',Status:'Active'});
const missingReview=plan=>plan.reviewItems.find(item=>
  item.sourceGroup==='CUSTOMERS'&&item.reason==='MISSING_ID');

test('no-ID fallback review reference ignores legacy export JSON column order',()=>{
  const before=snapshot(),after=snapshot();
  const row=noId();
  before.CUSTOMERS.push(row);
  after.CUSTOMERS.push(Object.fromEntries(Object.entries(row).reverse()));
  const baseline=structuredClone({before,after});
  const left=planPartyImport(before,[]);
  const right=planPartyImport(after,[]);
  assert.ok(missingReview(left));
  assert.ok(missingReview(right));
  assert.equal(missingReview(left).reviewId,missingReview(right).reviewId,
    'same missing-ID source field values must preserve review provenance');
  assert.equal(left.summary.quarantinedRows,1);
  assert.equal(right.summary.quarantinedRows,1);
  assert.equal(left.links.filter(x=>x.sourceGroup==='CUSTOMERS').length,1,
    'unknown original ID must never be imported as a Party legacy link');
  assert.deepEqual({before,after},baseline,'planning must not modify exports');
});

test('changing the value of a missing-ID export field changes its fallback review reference',()=>{
  const before=snapshot(),after=snapshot();
  before.CUSTOMERS.push(noId());
  after.CUSTOMERS.push({...noId(),Phone:'01987654321'});
  const a=missingReview(planPartyImport(before,[]));
  const b=missingReview(planPartyImport(after,[]));
  assert.notEqual(a.reviewId,b.reviewId);
  assert.equal(a.sourceId,null);
  assert.equal(b.sourceId,null);
});

test('physical legacy row index remains primary review provenance for missing source IDs',()=>{
  const before=snapshot(),after=snapshot();
  const row={...noId(),_rowIndex:7};
  before.CUSTOMERS.push(row);
  after.CUSTOMERS.push(Object.fromEntries(Object.entries({
    ...row,Phone:'01877777777',Status:'Inactive'
  }).reverse()));
  const a=missingReview(planPartyImport(before,[]));
  const b=missingReview(planPartyImport(after,[]));
  assert.equal(a.reviewId,b.reviewId,'physical row number wins over content');
  assert.equal(a.legacySheetRow,7);
  assert.equal(b.legacySheetRow,7);
});

test('two indistinguishable missing IDs without physical positions fail closed',()=>{
  const input=snapshot();
  input.CUSTOMERS.push(noId(),Object.fromEntries(Object.entries(noId()).reverse()));
  assert.throws(()=>planPartyImport(input,[]),/Duplicate review ID provenance/);
});

test('a missing-ID row does not become a human-approved source member',()=>{
  const input=snapshot();
  input.CUSTOMERS.push(noId());
  assert.throws(()=>planPartyImport(input,[{
    members:[
      {sourceGroup:'CUSTOMERS',sourceId:''},
      {sourceGroup:'SUPPLIERS',sourceId:'SUP-001'}
    ],reviewedBy:'admin-01',reviewedAt:'2026-11-14T12:00:00Z',
    approvalRef:'REVIEW-001'
  }]),/Unknown or quarantined Party identity/);
});
