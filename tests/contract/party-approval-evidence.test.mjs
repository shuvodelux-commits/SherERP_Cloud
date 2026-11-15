import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../../src/party/party-import-plan.js';

const baseline=JSON.parse(readFileSync(
  new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const source=()=>structuredClone(baseline);
const customerSupplier=[
  {sourceGroup:'CUSTOMERS',sourceId:'CUS-001'},
  {sourceGroup:'SUPPLIERS',sourceId:'SUP-001'}
];
const vendorPayee=[
  {sourceGroup:'VENDORS',sourceId:'VEN-001'},
  {sourceGroup:'EXPENSE_PAYEES',sourceId:'PAY-001'}
];
function proof(members,approvalRef,reviewedAt='2026-11-14T12:00:00Z',reviewedBy='admin-01'){
  return {members,approvalRef,reviewedAt,reviewedBy};
}
const pair=(left='REVIEW-001',right='REVIEW-002')=>[
  proof(customerSupplier,left),proof(vendorPayee,right)
];

test('two independent human-reviewed groups require distinct evidence references',()=>{
  const input=source(),approvals=pair(),unchanged=structuredClone({input,approvals});
  const out=planPartyImport(input,approvals);
  assert.equal(out.summary.sourceRows,5);
  assert.equal(out.summary.reviewedGroups,2);
  assert.equal(out.summary.proposedParties,3);
  assert.equal(out.summary.legacyLinks,5);
  assert.equal(out.summary.pendingIdentityReviews,0);
  assert.deepEqual(out.links.filter(x=>x.linkBasis==='HUMAN_VERIFIED')
    .map(x=>x.approvalRef).sort(),['REVIEW-001','REVIEW-002']);
  assert.equal(out.accounts,undefined);
  assert.equal(out.settlements,undefined);
  assert.deepEqual({input,approvals},unchanged);
});

test('an approval reference cannot be reused for distinct legacy identity groups',()=>{
  assert.throws(()=>planPartyImport(source(),pair('REVIEW-001','REVIEW-001')),
    /approval.*(reus|duplic)|(?:reus|duplic).*approval/i);
});

test('whitespace-padded approval references are ambiguous and rejected',()=>{
  for(const text of [' REVIEW-001','REVIEW-001 ','  REVIEW-001  ']){
    assert.throws(()=>planPartyImport(source(),[proof(customerSupplier,text)]),
      /approval.*(canonical|padding|whitespace|invalid)/i);
  }
});

test('review timestamp must be valid calendar UTC, not offset, local, or guessed',()=>{
  const invalid=[
    'now','2026-02-30T12:00:00Z','2026-11-14T25:00:00Z',
    '2026-11-14T12:00:00+06:00','2026-11-14T12:00:00',
    '2026-11-14T12:00:00.1234Z','2026-11-14T12:00:00z'
  ];
  for(const time of invalid){
    assert.throws(()=>planPartyImport(source(),[proof(customerSupplier,'REVIEW-001',time)]),
      /review.*(timestamp|utc|invalid)/i,JSON.stringify(time));
  }
});

test('valid UTC millisecond timestamp and separate reviewer attribution remain unchanged',()=>{
  const time='2026-11-14T12:00:00.123Z';
  const out=planPartyImport(source(),[proof(customerSupplier,'REVIEW-001',time,'admin-02')]);
  const reviewed=out.links.find(x=>x.linkBasis==='HUMAN_VERIFIED');
  assert.equal(reviewed.reviewedAt,time);
  assert.equal(reviewed.reviewedBy,'admin-02');
  assert.equal(reviewed.approvalRef,'REVIEW-001');
});

test('blank or padded reviewer identity is not a reliable provenance field',()=>{
  for(const actor of ['',' admin-01','admin-01 ','  ']){
    assert.throws(()=>planPartyImport(source(),[proof(customerSupplier,'REVIEW-001','2026-11-14T12:00:00Z',actor)]),
      /review|evidence/i);
  }
});

test('reviewed groups cannot change preserved original legacy source IDs',()=>{
  const original=planPartyImport(source(),pair());
  const idPairs=original.links.map(x=>[x.sourceGroup,x.sourceId]);
  assert.equal(new Set(idPairs.map(JSON.stringify)).size,5);
  assert.deepEqual(idPairs.map(x=>x[0]).sort(),[
    'CUSTOMERS','EXPENSE_PAYEES','FINANCE_PERSONS','SUPPLIERS','VENDORS'
  ]);
});


test('source row provenance rejects unsafe JS integers rather than silently rounding physical sheet positions',()=>{
  const original=source(),before=structuredClone(original);
  const safe=source();
  safe.CUSTOMERS[0]._rowIndex=Number.MAX_SAFE_INTEGER;
  assert.equal(planPartyImport(safe,pair()).links.find(x=>
    x.sourceGroup==='CUSTOMERS').legacySheetRow,Number.MAX_SAFE_INTEGER);
  for(const invalid of [Number.MAX_SAFE_INTEGER+1,Number.MAX_SAFE_INTEGER+2]){
    assert.equal(Number.isInteger(invalid),true,'old validation allowed unsafe row');
    assert.equal(Number.isSafeInteger(invalid),false);
    const records=source();
    records.CUSTOMERS[0]._rowIndex=invalid;
    assert.throws(()=>planPartyImport(records,pair()),
      /invalid legacy row position/i);
  }
  assert.equal(planPartyImport(original,pair()).links.find(x=>
    x.sourceGroup==='CUSTOMERS').legacySheetRow,2);
  assert.deepEqual(original,before,'source row metadata must never be rewritten');
});
