import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../src/party/party-import-plan.js';
import {reconcilePartyImportReadback} from '../src/party/import-readback-reconciliation.js';

const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));
const source=()=>fixture('party-import.synthetic.json');
const approval=()=>fixture('party-approved.synthetic.json');
const planned=(proof=approval())=>planPartyImport(source(),proof);

// D1-shaped synthetic readback. Present-day 0002_party_identity.sql has no
// approval_ref column: include it only to model a FUTURE reviewed schema.
function snapshot(plan,{approvalRef=false}={}){
  return {
    parties:plan.parties.map(p=>({
      party_id:p.partyId,display_name:p.displayName,phone:p.phone||null,
      party_kind:p.partyKind,status:p.status
    })),
    party_roles:plan.roles.map(r=>({party_id:r.partyId,role:r.role,status:r.status})),
    party_legacy_links:plan.links.map(link=>({
      party_id:link.partyId,source_group:link.sourceGroup,source_id:link.sourceId,
      legacy_sheet_row:link.legacySheetRow,link_basis:link.linkBasis,
      reviewed_by:link.reviewedBy,reviewed_at:link.reviewedAt,status:link.status,
      ...(approvalRef?{approval_ref:link.approvalRef}: {})
    }))
  };
}
const audit=(plan,readback)=>reconcilePartyImportReadback({plan,readback});
const codes=result=>result.issues.map(x=>x.code);

test('reviewed Party import compares every identity, role and legacy record without netting',()=>{
  const plan=planned(),readback=snapshot(plan,{approvalRef:true});
  const before=structuredClone({plan,readback});
  const result=audit(plan,readback);
  assert.equal(result.formatVersion,1);
  assert.equal(result.identityRowsMatch,true);
  assert.equal(result.approvalEvidencePersistent,true);
  assert.deepEqual(result.counts.expected,{parties:4,party_roles:7,party_legacy_links:5});
  assert.deepEqual(result.counts.actual,result.counts.expected);
  assert.deepEqual(result.issues,[]);
  assert.deepEqual({plan,readback},before,'reconciliation must not change original plans or D1 readback');
});

test('existing D1 Party schema loses approvalRef even though reviewer and timestamp survive',()=>{
  const plan=planned(),readback=snapshot(plan);
  const result=audit(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,false);
  assert.ok(codes(result).includes('APPROVAL_REF_NOT_PERSISTED'));
  assert.equal(result.counts.expected.parties,4);
  assert.equal(result.counts.actual.parties,4);
  assert.doesNotMatch(JSON.stringify(result),/Rahim|01700000000|REVIEW-001|admin-01|CUS-001|SUP-001/);
});

test('source IDs are authoritative: an unknown source ID cannot masquerade as an equal row count',()=>{
  const plan=planned(),readback=snapshot(plan,{approvalRef:true});
  readback.party_legacy_links[0].source_id='SUBSTITUTED-ID';
  const result=audit(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.ok(codes(result).includes('MISSING_ROW'));
  assert.ok(codes(result).includes('EXTRA_ROW'));
  assert.equal(result.counts.actual.party_legacy_links,5);
});

test('duplicate source links and duplicate Party-role membership fail closed',()=>{
  const plan=planned(),readback=snapshot(plan,{approvalRef:true});
  readback.party_legacy_links.push({...readback.party_legacy_links[0]});
  readback.party_roles.push({...readback.party_roles[0]});
  const result=audit(plan,readback);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(codes(result).filter(x=>x==='DUPLICATE_ROW').length,2);
});

test('altered physical row, identity attributes, reviewer or role status cause field mismatches',()=>{
  const plan=planned(),readback=snapshot(plan,{approvalRef:true});
  readback.parties[0].display_name='Changed name';
  readback.parties[0].phone='01999999999';
  readback.party_roles[0].status='INACTIVE';
  readback.party_legacy_links[0].legacy_sheet_row=999;
  const reviewed=readback.party_legacy_links.find(x=>x.link_basis==='HUMAN_VERIFIED');
  reviewed.reviewed_by='different-reviewer';
  const result=audit(plan,readback);
  const fields=result.issues.filter(x=>x.code==='FIELD_MISMATCH').map(x=>x.field);
  assert.deepEqual(fields.sort(),['display_name','legacy_sheet_row','phone','reviewed_by','status'].sort());
  assert.doesNotMatch(JSON.stringify(result),/Changed name|01999999999|different-reviewer/);
});

test('missing Party and extra role rows do not silently disappear',()=>{
  const plan=planned(),readback=snapshot(plan,{approvalRef:true});
  readback.parties.pop();
  readback.party_roles.push({party_id:'PT-UNEXPECTED',role:'Payee',status:'ACTIVE'});
  const result=audit(plan,readback);
  assert.ok(codes(result).includes('MISSING_ROW'));
  assert.ok(codes(result).includes('EXTRA_ROW'));
});

test('unreviewed same-name/phone source is still quarantined for identity review, not auto-merged',()=>{
  const plan=planned([]);
  assert.ok(plan.reviewItems.length>0);
  const report=audit(plan,snapshot(plan));
  assert.equal(report.identityRowsMatch,false);
  assert.ok(codes(report).includes('PENDING_IDENTITY_REVIEW'));
  assert.equal(report.approvalEvidencePersistent,true);
});

test('missing original IDs in source explicitly block parity even when readback matches proposal',()=>{
  const records=source();
  records.CUSTOMERS.push({'Customer ID':'','Customer Name':'unknown','_rowIndex':3});
  const plan=planPartyImport(records,[]);
  const report=audit(plan,snapshot(plan));
  assert.ok(codes(report).includes('QUARANTINED_SOURCE_ROWS'));
  assert.ok(codes(report).includes('PENDING_IDENTITY_REVIEW'));
});

test('order-independent strict comparison yields deterministic privacy-safe output',()=>{
  const plan=planned(),readback=snapshot(plan,{approvalRef:true});
  const a=audit(plan,readback);
  readback.party_roles.reverse();readback.parties.reverse();readback.party_legacy_links.reverse();
  assert.deepEqual(audit(plan,readback),a);
  assert.doesNotMatch(JSON.stringify(a),/Rahim|01700000000|CUS-001|SUP-001|REVIEW-001/);
});

test('tampered plan counts and malformed readback fail closed',()=>{
  const plan=planned(),readback=snapshot(plan,{approvalRef:true});
  plan.summary.legacyLinks=4;
  assert.ok(codes(audit(plan,readback)).includes('PLAN_COUNT_MISMATCH'));
  assert.throws(()=>audit(plan,{...readback,party_roles:null}),/invalid|array|readback/i);
  assert.throws(()=>reconcilePartyImportReadback({plan:null,readback}),/invalid|plan/i);
});
