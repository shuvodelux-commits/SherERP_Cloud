import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../src/party/party-import-plan.js';
import {reconcilePartyImportReadback} from '../src/party/import-readback-reconciliation.js';

const fixture=name=>JSON.parse(readFileSync(
  new URL('./fixtures/'+name,import.meta.url),'utf8'));

function reviewedPlan(){
  return planPartyImport(fixture('party-import.synthetic.json'),
    fixture('party-approved.synthetic.json'));
}
function stored(plan){
  return {
    parties:plan.parties.map(p=>({
      party_id:p.partyId,display_name:p.displayName,phone:p.phone||null,
      party_kind:p.partyKind,status:p.status
    })),
    party_roles:plan.roles.map(role=>({
      party_id:role.partyId,role:role.role,status:role.status
    })),
    party_legacy_links:plan.links.map(link=>({
      party_id:link.partyId,source_group:link.sourceGroup,source_id:link.sourceId,
      legacy_sheet_row:link.legacySheetRow,link_basis:link.linkBasis,
      reviewed_by:link.reviewedBy,reviewed_at:link.reviewedAt,
      approval_ref:link.approvalRef,status:link.status
    }))
  };
}
function actual(plan,readback){
  return reconcilePartyImportReadback({plan,readback});
}
function reviewedLink(readback){
  const link=readback.party_legacy_links.find(x=>x.link_basis==='HUMAN_VERIFIED');
  assert.ok(link,'synthetic reviewed link exists');
  return link;
}
function safeReport(result){
  assert.doesNotMatch(JSON.stringify(result),
    /CUS-001|SUP-001|REVIEW-001|admin-01|Rahim|01700000000/);
}

test('unchanged human-reviewed source-link provenance reports persisted evidence',()=>{
  const plan=reviewedPlan(),readback=stored(plan);
  const before=structuredClone({plan,readback});
  const result=actual(plan,readback);
  assert.equal(result.identityRowsMatch,true);
  assert.equal(result.approvalEvidencePersistent,true);
  assert.deepEqual(result.issues,[]);
  assert.deepEqual({plan,readback},before);
  safeReport(result);
});

for(const [field,changed] of [
  ['reviewed_by','different-reviewer'],
  ['reviewed_at','2026-11-14T12:00:01Z'],
  ['link_basis','ORIGINAL_RECORD']
]){
  test('human-reviewed '+field+' mismatch cannot claim approval evidence persisted',()=>{
    const plan=reviewedPlan(),readback=stored(plan);
    const original=structuredClone(plan);
    reviewedLink(readback)[field]=changed;
    const storedSnapshot=structuredClone(readback);
    const result=actual(plan,readback);
    assert.equal(result.identityRowsMatch,false);
    assert.equal(result.approvalEvidencePersistent,false,
      'altered human approval evidence must not be reported as persisted');
    assert.ok(result.issues.some(x=>x.code==='FIELD_MISMATCH' &&
      x.table==='party_legacy_links' && x.field===field));
    assert.deepEqual(plan,original);
    assert.deepEqual(readback,storedSnapshot);
    safeReport(result);
  });
}

test('missing reviewed_by or reviewed_at also invalidates approval evidence persistence',()=>{
  for(const field of ['reviewed_by','reviewed_at']){
    const plan=reviewedPlan(),readback=stored(plan);
    delete reviewedLink(readback)[field];
    const result=actual(plan,readback);
    assert.equal(result.identityRowsMatch,false);
    assert.equal(result.approvalEvidencePersistent,false);
    assert.ok(result.issues.some(x=>x.code==='FIELD_MISMATCH' &&
      x.table==='party_legacy_links' && x.field===field));
    safeReport(result);
  }
});

test('missing approval_ref retains its existing fail-closed diagnostic',()=>{
  const plan=reviewedPlan(),readback=stored(plan);
  delete reviewedLink(readback).approval_ref;
  const result=actual(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,false);
  assert.ok(result.issues.some(x=>x.code==='APPROVAL_REF_NOT_PERSISTED' &&
    x.table==='party_legacy_links' && x.field==='approval_ref'));
  safeReport(result);
});

test('unrelated original-record mismatch cannot falsely claim a reviewed approval was lost',()=>{
  const plan=reviewedPlan(),readback=stored(plan);
  readback.parties[0].display_name='Corrected identity';
  const result=actual(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,true);
  assert.ok(result.issues.some(x=>x.code==='FIELD_MISMATCH' &&
    x.table==='parties' && x.field==='display_name'));
  safeReport(result);
});

test('unreviewed import with a mismatched original status retains separate evidence flag semantics',()=>{
  const plan=planPartyImport(fixture('party-import.synthetic.json'),[]);
  const readback=stored(plan);
  readback.party_legacy_links[0].status='RETIRED';
  const result=actual(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,true);
  safeReport(result);
});
