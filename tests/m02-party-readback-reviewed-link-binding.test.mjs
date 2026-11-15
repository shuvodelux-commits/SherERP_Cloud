import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../src/party/party-import-plan.js';
import {reconcilePartyImportReadback} from '../src/party/import-readback-reconciliation.js';

const fixture=name=>JSON.parse(readFileSync(
  new URL('./fixtures/'+name,import.meta.url),'utf8'));
const reviewedPlan=()=>planPartyImport(fixture('party-import.synthetic.json'),
  fixture('party-approved.synthetic.json'));

function stored(plan){
  return {
    parties:plan.parties.map(p=>({
      party_id:p.partyId,display_name:p.displayName,phone:p.phone||null,
      party_kind:p.partyKind,status:p.status
    })),
    party_roles:plan.roles.map(r=>({party_id:r.partyId,role:r.role,status:r.status})),
    // A future approved schema can persist approval_ref; current D1 cannot.
    party_legacy_links:plan.links.map(link=>({
      party_id:link.partyId,source_group:link.sourceGroup,source_id:link.sourceId,
      legacy_sheet_row:link.legacySheetRow,link_basis:link.linkBasis,
      reviewed_by:link.reviewedBy,reviewed_at:link.reviewedAt,
      approval_ref:link.approvalRef,status:link.status
    }))
  };
}
const report=(plan,readback)=>reconcilePartyImportReadback({plan,readback});
const reviewedLink=readback=>readback.party_legacy_links.find(x=>
  x.link_basis==='HUMAN_VERIFIED');
const safe=output=>assert.doesNotMatch(JSON.stringify(output),
  /CUS-001|SUP-001|VEN-001|REVIEW-001|admin-01|Rahim|01700000000|PT-[A-Z0-9]+/);

test('valid reviewed Party readback keeps exact identity and approval-evidence flags',()=>{
  const plan=reviewedPlan(),readback=stored(plan);
  const original=structuredClone({plan,readback});
  const result=report(plan,readback);
  assert.equal(result.identityRowsMatch,true);
  assert.equal(result.approvalEvidencePersistent,true);
  assert.deepEqual(result.issues,[]);
  assert.deepEqual({plan,readback},original);
  safe(result);
});

test('reviewed source bound to a different stored Party cannot claim persisted approval evidence',()=>{
  const plan=reviewedPlan(),readback=stored(plan);
  reviewedLink(readback).party_id='PT-ANOTHER-PARTY';
  const original=structuredClone({plan,readback});
  const result=report(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,false,
    'same reviewer/ref on a different Party is not the reviewed identity link');
  assert.ok(result.issues.some(x=>x.code==='FIELD_MISMATCH' &&
    x.table==='party_legacy_links' && x.field==='party_id'));
  assert.deepEqual({plan,readback},original);
  safe(result);
});

test('reviewed source bound to a different physical sheet row invalidates approval evidence',()=>{
  const plan=reviewedPlan(),readback=stored(plan);
  reviewedLink(readback).legacy_sheet_row=47;
  const result=report(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,false,
    'a preserved approval must refer to the reviewed original sheet row');
  assert.ok(result.issues.some(x=>x.code==='FIELD_MISMATCH' &&
    x.table==='party_legacy_links' && x.field==='legacy_sheet_row'));
  safe(result);
});

test('unreviewed Party ID mismatch is identity drift, not loss of reviewed evidence',()=>{
  const plan=reviewedPlan(),readback=stored(plan);
  const original=readback.party_legacy_links.find(x=>
    x.link_basis==='ORIGINAL_RECORD');
  original.party_id='PT-ANOTHER-PARTY';
  const result=report(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,true);
  assert.ok(result.issues.some(x=>x.code==='FIELD_MISMATCH' &&
    x.table==='party_legacy_links' && x.field==='party_id'));
  safe(result);
});

test('retiring a reviewed legacy link changes row parity but not human approval provenance',()=>{
  const plan=reviewedPlan(),readback=stored(plan);
  reviewedLink(readback).status='RETIRED';
  const result=report(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,true);
  assert.ok(result.issues.some(x=>x.code==='FIELD_MISMATCH' &&
    x.table==='party_legacy_links' && x.field==='status'));
  safe(result);
});
