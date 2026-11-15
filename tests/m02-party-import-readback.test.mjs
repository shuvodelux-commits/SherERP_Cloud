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


test('self-consistent readback cannot certify two ORIGINAL_RECORD anchors on one Party',()=>{
  const plan=planned();
  const verified=plan.links.find(x=>x.linkBasis==='HUMAN_VERIFIED');
  assert.ok(verified);
  verified.linkBasis='ORIGINAL_RECORD';
  verified.reviewedBy=null;
  verified.reviewedAt=null;
  verified.approvalRef=null;
  const readback=snapshot(plan,{approvalRef:true});
  const before=structuredClone({plan,readback});
  const result=audit(plan,readback);
  assert.deepEqual(result.counts.expected,result.counts.actual,
    'plan/readback row counts are deliberately equal');
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,false);
  assert.ok(result.issues.some(issue=>issue.code==='PLAN_LINKAGE_INVALID'&&issue.table==='plan'));
  assert.doesNotMatch(JSON.stringify(result),/CUS-001|SUP-001|REVIEW-001|admin-01|01700000000/);
  assert.deepEqual({plan,readback},before,'graph audit must not mutate evidence');
});

test('readback rejects Party role and legacy link orphan references even with matching rows',()=>{
  for(const table of ['roles','links']){
    const plan=planned();
    plan[table][0].partyId='PT-ORPHAN-SYNTHETIC';
    const report=audit(plan,snapshot(plan,{approvalRef:true}));
    assert.equal(report.identityRowsMatch,false,table+' orphan cannot be reconciled');
    assert.equal(report.approvalEvidencePersistent,false);
    assert.ok(codes(report).includes('PLAN_LINKAGE_INVALID'));
    assert.doesNotMatch(JSON.stringify(report),/PT-ORPHAN-SYNTHETIC|CUS-001|SUP-001/);
  }
});

test('Party with only HUMAN_VERIFIED links cannot certify an absent original source anchor',()=>{
  const plan=planned();
  const original=plan.links.find(link=>link.linkBasis==='ORIGINAL_RECORD' &&
    plan.links.filter(other=>other.partyId===link.partyId).length===1);
  assert.ok(original,'fixture must contain a single-source Party');
  original.linkBasis='HUMAN_VERIFIED';
  original.reviewedBy='synthetic-reviewer';
  original.reviewedAt='2026-11-15T00:00:00Z';
  original.approvalRef='SYNTHETIC-ANCHOR-REVIEW';
  const result=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,false);
  assert.ok(codes(result).includes('PLAN_LINKAGE_INVALID'));
});


const threeMemberSource=()=>{
  const rows=source();
  rows.CUSTOMERS.push({
    ...rows.CUSTOMERS[0],
    'Customer ID':'CUS-002',
    'Customer Name':'Distinct branch',
    'Phone':'01512345678',
    _rowIndex:3
  });
  return rows;
};
const threeMemberApproval=()=>[{
  members:[
    {sourceGroup:'CUSTOMERS',sourceId:'CUS-001'},
    {sourceGroup:'SUPPLIERS',sourceId:'SUP-001'},
    {sourceGroup:'CUSTOMERS',sourceId:'CUS-002'}
  ],
  reviewedBy:'admin-01',reviewedAt:'2026-11-14T12:00:00Z',approvalRef:'REVIEW-001'
}];

test('two separate reviewed Parties may not reuse one approval reference in a mirrored readback',()=>{
  const groups=approval();
  groups.push({
    members:[
      {sourceGroup:'VENDORS',sourceId:'VEN-001'},
      {sourceGroup:'EXPENSE_PAYEES',sourceId:'PAY-001'}
    ],
    reviewedBy:'admin-02',reviewedAt:'2026-11-14T13:00:00Z',
    approvalRef:'REVIEW-002'
  });
  const plan=planned(groups);
  assert.equal(plan.summary.reviewedGroups,2);
  const links=plan.links.filter(x=>x.linkBasis==='HUMAN_VERIFIED');
  assert.equal(links.length,2);
  assert.notEqual(links[0].partyId,links[1].partyId);
  links[1].approvalRef=links[0].approvalRef;
  const readback=snapshot(plan,{approvalRef:true});
  const prior=structuredClone({plan,readback});
  const report=audit(plan,readback);
  assert.deepEqual(report.counts.expected,report.counts.actual);
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.ok(codes(report).includes('PLAN_LINKAGE_INVALID'));
  assert.doesNotMatch(JSON.stringify(report),
    /REVIEW-001|admin-01|CUS-001|SUP-001|VEN-001|PAY-001/);
  assert.deepEqual({plan,readback},prior);
});

test('one three-member reviewed Party must retain one consistent reviewer and time tuple',()=>{
  const plan=planPartyImport(threeMemberSource(),threeMemberApproval());
  assert.equal(plan.summary.reviewedGroups,1);
  const verified=plan.links.filter(x=>x.linkBasis==='HUMAN_VERIFIED');
  assert.equal(verified.length,2);
  assert.equal(new Set(verified.map(x=>x.partyId)).size,1);
  assert.equal(new Set(verified.map(x=>x.approvalRef)).size,1);
  assert.deepEqual(audit(plan,snapshot(plan,{approvalRef:true})).issues,
    [],'all members with original shared review proof reconcile successfully');
  verified[1].reviewedAt='2026-11-14T14:00:00Z';
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.ok(codes(report).includes('PLAN_LINKAGE_INVALID'));
  assert.doesNotMatch(JSON.stringify(report),/2026-11-14T14:00:00Z|CUS-002|SUP-001/);
});

test('reviewed group summary cannot contradict the number of source-backed reviewed Parties',()=>{
  const plan=planned();
  assert.equal(plan.summary.reviewedGroups,1);
  plan.summary.reviewedGroups=0;
  const readback=snapshot(plan,{approvalRef:true});
  const report=audit(plan,readback);
  assert.deepEqual(report.counts.expected,report.counts.actual);
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.ok(codes(report).includes('PLAN_LINKAGE_INVALID'));
  assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|REVIEW-001|admin-01/);
});
