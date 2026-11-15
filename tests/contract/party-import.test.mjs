import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {planPartyImport} from '../../src/party/party-import-plan.js';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const snapshot=()=>structuredClone(fixture);
const linkTo=(plan,group,id)=>plan.links.find(x=>x.sourceGroup===group&&x.sourceId===id);

test('by default every original master row is a separate Party, even when phone and name are identical',()=>{
  const source=snapshot(),initial=JSON.stringify(source);
  const plan=planPartyImport(source);
  assert.equal(JSON.stringify(source),initial,'import must never mutate source');
  assert.equal(plan.summary.sourceRows,5);
  assert.equal(plan.summary.proposedParties,5);
  assert.equal(plan.summary.legacyLinks,5);
  assert.equal(plan.summary.roleMemberships,7);
  assert.notEqual(linkTo(plan,'CUSTOMERS','CUS-001').partyId,linkTo(plan,'SUPPLIERS','SUP-001').partyId);
  assert.ok(plan.reviewItems.some(x=>x.reason==='SHARED_PHONE'));
  assert.ok(plan.reviewItems.some(x=>x.reason==='SAME_NAME'));
  assert.deepEqual(plan.roles.filter(x=>x.partyId===linkTo(plan,'FINANCE_PERSONS','FIN-001').partyId).map(x=>x.role),['Owner','Lender','Borrower']);
  assert.equal(plan.roles.find(x=>x.role==='Payee').status,'INACTIVE');
  assert.ok(!plan.accounts, 'the importer must not create a generic balance');
});

test('reviewed explicit merge joins two original IDs into one Party without netting accounts',()=>{
  const approvedGroups=[{
    members:[{sourceGroup:'SUPPLIERS',sourceId:'SUP-001'},{sourceGroup:'CUSTOMERS',sourceId:'CUS-001'}],
    reviewedBy:'admin-01',reviewedAt:'2026-11-14T12:00:00Z',approvalRef:'REVIEW-001'
  }];
  const plan=planPartyImport(snapshot(),approvedGroups);
  assert.equal(plan.summary.proposedParties,4);
  assert.equal(plan.summary.reviewedGroups,1);
  const customer=linkTo(plan,'CUSTOMERS','CUS-001');
  const supplier=linkTo(plan,'SUPPLIERS','SUP-001');
  assert.equal(customer.partyId,supplier.partyId);
  assert.deepEqual([customer.linkBasis,supplier.linkBasis],['ORIGINAL_RECORD','HUMAN_VERIFIED']);
  assert.equal(supplier.reviewedBy,'admin-01');
  assert.equal(supplier.reviewedAt,'2026-11-14T12:00:00Z');
  assert.deepEqual(plan.roles.filter(x=>x.partyId===customer.partyId).map(x=>x.role),['Customer','Supplier']);
  assert.ok(!plan.reviewItems.some(x=>['SHARED_PHONE','SAME_NAME'].includes(x.reason)));
  assert.ok(!plan.settlements);
});

test('missing and duplicated source IDs are quarantined rather than guessed or skipped as success',()=>{
  const source=snapshot();
  source.CUSTOMERS.push({'Customer ID':'','Customer Name':'No ID','Phone':'01777777777','_rowIndex':3});
  source.VENDORS.push({...source.VENDORS[0],_rowIndex:3});
  const plan=planPartyImport(source);
  assert.equal(plan.summary.sourceRows,7);
  assert.equal(plan.summary.quarantinedRows,3);
  assert.equal(plan.summary.legacyLinks,4);
  assert.equal(plan.summary.proposedParties,4);
  assert.ok(plan.reviewItems.some(x=>x.reason==='MISSING_ID'));
  assert.ok(plan.reviewItems.some(x=>x.reason==='DUPLICATE_ID'));
  assert.ok(!linkTo(plan,'VENDORS','VEN-001'));
});

test('source groups, approved links, and review evidence fail closed',()=>{
  const missing=snapshot();delete missing.CUSTOMERS;
  assert.throws(()=>planPartyImport(missing),/missing.*CUSTOMERS/i);
  const extra=snapshot();extra.PAYMENTS=[];
  assert.throws(()=>planPartyImport(extra),/unknown.*PAYMENTS/i);
  const pair=[{sourceGroup:'CUSTOMERS',sourceId:'CUS-001'},{sourceGroup:'SUPPLIERS',sourceId:'SUP-001'}];
  assert.throws(()=>planPartyImport(snapshot(),[{members:pair,reviewedBy:'',reviewedAt:'2026-11-14T12:00:00Z'}]),/review|evidence/i);
  assert.throws(()=>planPartyImport(snapshot(),[{members:pair,reviewedBy:'u1',reviewedAt:'2026-11-14T12:00:00Z',approvalRef:'r1'},{members:pair,reviewedBy:'u2',reviewedAt:'2026-11-14T12:00:00Z',approvalRef:'r2'}]),/overlap|duplicate/i);
  assert.throws(()=>planPartyImport(snapshot(),[{members:[pair[0],{sourceGroup:'SUPPLIERS',sourceId:'unknown'}],reviewedBy:'u1',reviewedAt:'2026-11-14T12:00:00Z',approvalRef:'r1'}]),/unknown|missing/i);
});

test('plan IDs and output are deterministic across input source row order and group-member order',()=>{
  const a=snapshot();
  a.CUSTOMERS.push({'Customer ID':'CUS-002','Customer Name':'B','Phone':'','Status':'Active','_rowIndex':3});
  const b=structuredClone(a);b.CUSTOMERS.reverse();
  assert.deepEqual(planPartyImport(a),planPartyImport(b));
});

test('missing-ID review identities are stable when exported source row order changes',()=>{
  const a=snapshot();
  a.CUSTOMERS.push({'Customer ID':'','Customer Name':'Unknown','Phone':'01777777777','_rowIndex':3});
  const b=structuredClone(a);b.CUSTOMERS.reverse();
  const onlyMissing=(plan)=>plan.reviewItems.filter(x=>x.reason==='MISSING_ID');
  assert.deepEqual(onlyMissing(planPartyImport(a)),onlyMissing(planPartyImport(b)));
});
