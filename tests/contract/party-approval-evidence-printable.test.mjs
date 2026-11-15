import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../../src/party/party-import-plan.js';

const fixture=JSON.parse(readFileSync(
  new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const source=()=>structuredClone(fixture);
const members=[
  {sourceGroup:'CUSTOMERS',sourceId:'CUS-001'},
  {sourceGroup:'SUPPLIERS',sourceId:'SUP-001'}
];
function proof(approvalRef='REVIEW-001',reviewedBy='admin-01'){
  return {members:structuredClone(members),approvalRef,reviewedBy,
    reviewedAt:'2026-11-14T12:00:00Z'};
}
function assertReviewRejected(approval,expected){
  assert.throws(()=>planPartyImport(source(),[approval]),expected);
}

test('control characters cannot appear inside a reviewed approval reference',()=>{
  for(const value of [
    'REVIEW-001\nFORGED',
    'REVIEW-\u0000-001',
    'REVIEW-\u007f-001',
    'REVIEW-\u001b-001'
  ]){
    assertReviewRejected(proof(value),/approval.*(canonical|padding|whitespace|invalid)/i);
  }
});

test('zero-width and bidi formatting characters cannot visually spoof approval references',()=>{
  for(const value of [
    'REVIEW-\u200b001',
    'REVIEW-\u200d001',
    'REVIEW-\u202e001',
    'REVIEW-\u2066001',
    'REVIEW-\ufeff001'
  ]){
    assertReviewRejected(proof(value),/approval.*(canonical|padding|whitespace|invalid)/i);
  }
});

test('control and invisible characters cannot visually spoof the reviewer identity',()=>{
  for(const value of [
    'admin-01\nother',
    'admin-\u000001',
    'admin-\u200b01',
    'admin-\u202e01',
    'admin-\u206901'
  ]){
    assertReviewRejected(proof('REVIEW-001',value),/review.*(canonical|evidence|identity)/i);
  }
});

test('visible text, inner ordinary spaces and original Party IDs remain unchanged',()=>{
  const input=source();
  const approved=proof('REVIEW 001','review team-01');
  const unchanged=structuredClone({input,approved});
  const result=planPartyImport(input,[approved]);
  assert.equal(result.summary.reviewedGroups,1);
  assert.equal(result.summary.pendingIdentityReviews,0);
  const link=result.links.find(item=>item.linkBasis==='HUMAN_VERIFIED');
  assert.equal(link.approvalRef,'REVIEW 001');
  assert.equal(link.reviewedBy,'review team-01');
  assert.deepEqual(
    new Set(result.links.map(item=>item.sourceGroup+':'+item.sourceId)),
    new Set([
      'CUSTOMERS:CUS-001','SUPPLIERS:SUP-001','VENDORS:VEN-001',
      'FINANCE_PERSONS:FIN-001','EXPENSE_PAYEES:PAY-001'
    ])
  );
  assert.deepEqual({input,approved},unchanged);
});

test('independent reviewed groups still require distinct exact evidence references',()=>{
  const another={
    members:[
      {sourceGroup:'VENDORS',sourceId:'VEN-001'},
      {sourceGroup:'EXPENSE_PAYEES',sourceId:'PAY-001'}
    ],
    approvalRef:'REVIEW-001',reviewedBy:'review team-02',
    reviewedAt:'2026-11-14T12:00:00Z'
  };
  assertReviewRejected(proof('REVIEW-001'),/approval.*(reus|duplic)|(?:reus|duplic).*approval/i);
  assert.throws(()=>planPartyImport(source(),[proof(),another]),
    /approval.*(reus|duplic)|(?:reus|duplic).*approval/i);
});
