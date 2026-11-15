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


test('tampered reviewer and approval IDs cannot pass a mirrored future D1 readback',()=>{
  const cases=[
    {field:'reviewedBy',value:' admin-01 '},
    {field:'reviewedBy',value:'admin\u202E01'},
    {field:'reviewedBy',value:'admin\u000701'},
    {field:'approvalRef',value:' REVIEW-001 '},
    {field:'approvalRef',value:'REVIEW\u200B-001'},
    {field:'approvalRef',value:'REVIEW\u2066-001'}
  ];
  for(const {field,value} of cases){
    const plan=planned(),verified=plan.links.find(x=>x.linkBasis==='HUMAN_VERIFIED');
    verified[field]=value;
    const readback=snapshot(plan,{approvalRef:true});
    const before=structuredClone({plan,readback});
    const report=audit(plan,readback);
    assert.deepEqual(report.counts.expected,report.counts.actual);
    assert.equal(report.identityRowsMatch,false,field+' noncanonical evidence');
    assert.equal(report.approvalEvidencePersistent,false,field+' must not be trusted');
    assert.ok(codes(report).includes('PLAN_LINKAGE_INVALID'),field+' must reject');
    assert.doesNotMatch(JSON.stringify(report),
      /admin-01|REVIEW-001|CUS-001|SUP-001|01700000000/);
    assert.deepEqual({plan,readback},before,'readback must never mutate evidence');
  }
});

test('tampered impossible or non-UTC review instants fail despite matching future readback',()=>{
  for(const reviewedAt of [
    '2026-02-30T12:00:00Z','2026-11-14T12:00:00+06:00',
    '2026-11-14T12:00:00','2026-11-14T12:00:00.1234Z',
    '2026-11-14T25:00:00Z','2026-11-14T12:00:00z'
  ]){
    const plan=planned(),verified=plan.links.find(x=>x.linkBasis==='HUMAN_VERIFIED');
    verified.reviewedAt=reviewedAt;
    const report=audit(plan,snapshot(plan,{approvalRef:true}));
    assert.equal(report.identityRowsMatch,false,reviewedAt);
    assert.equal(report.approvalEvidencePersistent,false,reviewedAt);
    assert.ok(codes(report).includes('PLAN_LINKAGE_INVALID'),reviewedAt);
    assert.doesNotMatch(JSON.stringify(report),
      /CUS-001|SUP-001|REVIEW-001|admin-01/);
  }
});

test('real UTC review millisecond evidence remains valid in future-schema readback',()=>{
  const plan=planned();
  const verified=plan.links.find(x=>x.linkBasis==='HUMAN_VERIFIED');
  verified.reviewedAt='2026-11-14T12:00:00.123Z';
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,true);
  assert.equal(report.approvalEvidencePersistent,true);
  assert.deepEqual(report.issues,[]);
});


test('negative quarantined count cannot cancel source row count in a mirrored future D1 readback',()=>{
  const plan=planned();
  const original=structuredClone(plan);
  assert.equal(plan.summary.quarantinedRows,0);
  assert.equal(plan.summary.sourceRows,plan.links.length);
  plan.summary.quarantinedRows=-1;
  plan.summary.sourceRows=plan.links.length-1;
  const readback=snapshot(plan,{approvalRef:true});
  const before=structuredClone({plan,readback});
  const report=audit(plan,readback);
  assert.deepEqual(report.counts.expected,report.counts.actual);
  assert.equal(report.identityRowsMatch,false,'invalid summary cannot certify identity parity');
  assert.ok(codes(report).includes('PLAN_COUNT_MISMATCH'));
  assert.deepEqual(report.issues,[{code:'PLAN_COUNT_MISMATCH',table:'plan'}]);
  assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|REVIEW-001|admin-01|01700000000/);
  assert.deepEqual({plan,readback},before,'readback must not mutate input plans or D1-shaped rows');
  assert.equal(original.summary.quarantinedRows,0);
});

test('fractional or unsafe source/quarantined counts are rejected even when arithmetic balances',()=>{
  const pairs=[
    {quarantinedRows:-0.5,sourceRows:4.5},
    {quarantinedRows:0.5,sourceRows:5.5},
    {quarantinedRows:Number.MAX_SAFE_INTEGER+1,sourceRows:Number.MAX_SAFE_INTEGER+1+5}
  ];
  for(const pair of pairs){
    const plan=planned();
    Object.assign(plan.summary,pair);
    const report=audit(plan,snapshot(plan,{approvalRef:true}));
    assert.equal(report.identityRowsMatch,false,JSON.stringify(pair));
    assert.ok(codes(report).includes('PLAN_COUNT_MISMATCH'),JSON.stringify(pair));
    assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|REVIEW-001|admin-01/);
  }
});

test('source count audit continues to accept zero quarantined rows and flag positive quarantines',()=>{
  const clean=planned();
  const good=audit(clean,snapshot(clean,{approvalRef:true}));
  assert.equal(good.identityRowsMatch,true);
  assert.ok(!codes(good).includes('PLAN_COUNT_MISMATCH'));
  const rows=source();
  rows.CUSTOMERS.push({'Customer ID':'','Customer Name':'Unknown customer','_rowIndex':3});
  const quarantined=planPartyImport(rows,[]);
  assert.equal(quarantined.summary.quarantinedRows,1);
  const flagged=audit(quarantined,snapshot(quarantined));
  assert.ok(codes(flagged).includes('QUARANTINED_SOURCE_ROWS'));
  assert.ok(!codes(flagged).includes('PLAN_COUNT_MISMATCH'));
});

test('a Finance-only source Party cannot claim a Supplier role in mirrored D1 parity',()=>{
  const plan=planned();
  const finance=plan.links.find(link=>link.sourceGroup==='FINANCE_PERSONS');
  const forged=plan.roles.find(role=>role.partyId===finance.partyId&&role.role==='Owner');
  assert.ok(forged);
  forged.role='Supplier';
  const readback=snapshot(plan,{approvalRef:true});
  const before=structuredClone({plan,readback});
  const report=audit(plan,readback);
  assert.deepEqual(report.counts.expected,report.counts.actual);
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.deepEqual(report.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
  assert.doesNotMatch(JSON.stringify(report),/FIN-001|REVIEW-001|CUS-001|admin-01|01900000000/);
  assert.deepEqual({plan,readback},before);
});

test('source Customer role cannot be removed or replaced by a Payee-only role',()=>{
  const plan=planned();
  const customer=plan.links.find(link=>link.sourceGroup==='CUSTOMERS');
  const role=plan.roles.find(x=>x.partyId===customer.partyId&&x.role==='Customer');
  assert.ok(role);
  role.role='Payee';
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.deepEqual(report.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
  assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|REVIEW-001|admin-01/);
});

test('unknown legacy source groups cannot be approved by self-consistent D1-shaped rows',()=>{
  const plan=planned();
  const link=plan.links.find(x=>x.sourceGroup==='FINANCE_PERSONS');
  assert.ok(link);
  link.sourceGroup='UNRECOGNIZED_LEGACY_TABLE';
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.deepEqual(report.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
  assert.doesNotMatch(JSON.stringify(report),/FIN-001|CUS-001|SUP-001|REVIEW-001|admin-01/);
});

test('source-backed Customer+Supplier review and original Finance 3-role plan remain valid',()=>{
  const plan=planned();
  const rolesFor=id=>plan.roles.filter(role=>role.partyId===id).map(role=>role.role);
  const reviewed=plan.links.find(x=>x.sourceGroup==='CUSTOMERS');
  const finance=plan.links.find(x=>x.sourceGroup==='FINANCE_PERSONS');
  assert.deepEqual(rolesFor(reviewed.partyId),['Customer','Supplier']);
  assert.deepEqual(rolesFor(finance.partyId),['Owner','Lender','Borrower']);
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,true);
  assert.equal(report.approvalEvidencePersistent,true);
  assert.deepEqual(report.issues,[]);
});


test('a source-backed ACTIVE Party cannot claim INACTIVE in a mirrored D1 snapshot',()=>{
  const plan=planned();
  const customer=plan.links.find(x=>x.sourceGroup==='CUSTOMERS');
  const party=plan.parties.find(x=>x.partyId===customer.partyId);
  assert.equal(customer.status,'ACTIVE');
  assert.equal(party.status,'ACTIVE');
  party.status='INACTIVE';
  const readback=snapshot(plan,{approvalRef:true});
  const before=structuredClone({plan,readback});
  const report=audit(plan,readback);
  assert.deepEqual(report.counts.expected,report.counts.actual);
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.deepEqual(report.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
  assert.doesNotMatch(JSON.stringify(report),/CUS-001|SUP-001|REVIEW-001|admin-01|01700000000/);
  assert.deepEqual({plan,readback},before,'status readback does not mutate evidence');
});

test('all-RETIRED original Payee Party cannot claim ACTIVE in matching readback',()=>{
  const plan=planned();
  const payee=plan.links.find(x=>x.sourceGroup==='EXPENSE_PAYEES');
  const party=plan.parties.find(x=>x.partyId===payee.partyId);
  assert.equal(payee.status,'RETIRED');
  assert.equal(party.status,'INACTIVE');
  party.status='ACTIVE';
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.deepEqual(report.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
  assert.doesNotMatch(JSON.stringify(report),/PAY-001|REVIEW-001|admin-01|01600000000/);
});

test('fabricated legacy link, Party and role status labels fail closed on matching rows',()=>{
  for(const [table,source,status] of [
    ['links','CUSTOMERS','INACTIVE'],
    ['links','EXPENSE_PAYEES','DELETED'],
    ['roles','Owner','RETIRED'],
    ['parties','FINANCE_PERSONS','RETIRED']
  ]){
    const plan=planned();
    let target;
    if(table==='links')target=plan.links.find(x=>x.sourceGroup===source);
    if(table==='roles')target=plan.roles.find(x=>x.role===source);
    if(table==='parties'){
      const finance=plan.links.find(x=>x.sourceGroup===source);
      target=plan.parties.find(x=>x.partyId===finance.partyId);
    }
    assert.ok(target);
    target.status=status;
    const report=audit(plan,snapshot(plan,{approvalRef:true}));
    assert.equal(report.identityRowsMatch,false,table+' status '+status);
    assert.equal(report.approvalEvidencePersistent,false,table+' status '+status);
    assert.deepEqual(report.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
    assert.doesNotMatch(JSON.stringify(report),/CUS-001|FIN-001|PAY-001|REVIEW-001|admin-01/);
  }
});

test('valid mixed ACTIVE and RETIRED original Party links keep source-derived status',()=>{
  const plan=planned();
  const payee=plan.links.find(x=>x.sourceGroup==='EXPENSE_PAYEES');
  const retiredParty=plan.parties.find(x=>x.partyId===payee.partyId);
  const activeParties=plan.parties.filter(x=>x.partyId!==payee.partyId);
  assert.equal(retiredParty.status,'INACTIVE');
  assert.equal(activeParties.every(x=>x.status==='ACTIVE'),true);
  assert.equal(plan.roles.find(x=>x.partyId===payee.partyId).status,'INACTIVE');
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,true);
  assert.equal(report.approvalEvidencePersistent,true);
  assert.deepEqual(report.issues,[]);
});


test('mirrored future D1 cannot certify INACTIVE Customer role with an ACTIVE original Customer link',()=>{
  const plan=planned();
  const customer=plan.links.find(link=>link.sourceGroup==='CUSTOMERS');
  const role=plan.roles.find(x=>x.partyId===customer.partyId && x.role==='Customer');
  const party=plan.parties.find(x=>x.partyId===customer.partyId);
  assert.equal(customer.status,'ACTIVE');
  assert.equal(party.status,'ACTIVE');
  assert.equal(role.status,'ACTIVE');
  role.status='INACTIVE';
  const readback=snapshot(plan,{approvalRef:true});
  const frozen=structuredClone({plan,readback});
  const result=audit(plan,readback);
  assert.deepEqual(result.counts.expected,result.counts.actual);
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,false);
  assert.deepEqual(result.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
  assert.doesNotMatch(JSON.stringify(result),/CUS-001|SUP-001|REVIEW-001|admin-01|01700000000/);
  assert.deepEqual({plan,readback},frozen,'read-only validation does not mutate inputs');
});

test('mirrored future D1 cannot certify ACTIVE Payee role when its original source link is RETIRED',()=>{
  const plan=planned();
  const payee=plan.links.find(link=>link.sourceGroup==='EXPENSE_PAYEES');
  const role=plan.roles.find(x=>x.partyId===payee.partyId && x.role==='Payee');
  assert.equal(payee.status,'RETIRED');
  assert.equal(role.status,'INACTIVE');
  role.status='ACTIVE';
  const result=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(result.identityRowsMatch,false);
  assert.equal(result.approvalEvidencePersistent,false);
  assert.deepEqual(result.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
  assert.doesNotMatch(JSON.stringify(result),/PAY-001|REVIEW-001|admin-01|01600000000/);
});

test('approved inactive Customer and active Supplier retain separate correct role statuses',()=>{
  const rows=source();
  rows.CUSTOMERS[0].Status='Inactive';
  const plan=planPartyImport(rows,approval());
  const customer=plan.links.find(link=>link.sourceGroup==='CUSTOMERS');
  const supplier=plan.links.find(link=>link.sourceGroup==='SUPPLIERS');
  assert.equal(customer.partyId,supplier.partyId);
  assert.equal(customer.status,'RETIRED');
  assert.equal(supplier.status,'ACTIVE');
  const roleByName=role=>plan.roles.find(x=>x.partyId===customer.partyId&&x.role===role);
  assert.equal(roleByName('Customer').status,'INACTIVE');
  assert.equal(roleByName('Supplier').status,'ACTIVE');
  assert.equal(plan.parties.find(x=>x.partyId===customer.partyId).status,'ACTIVE');
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,true);
  assert.equal(report.approvalEvidencePersistent,true);
  assert.deepEqual(report.issues,[]);
});


test('mirrored future D1 cannot certify invalid source physical-row positions',()=>{
  const values=[-1,1,2.5,'2',Number.MAX_SAFE_INTEGER+1,undefined];
  for(const physicalRow of values){
    const plan=planned();
    const customer=plan.links.find(x=>x.sourceGroup==='CUSTOMERS');
    assert.equal(customer.legacySheetRow,2);
    customer.legacySheetRow=physicalRow;
    const readback=snapshot(plan,{approvalRef:true});
    const prior=structuredClone({plan,readback});
    const report=audit(plan,readback);
    assert.deepEqual(report.counts.expected,report.counts.actual);
    assert.equal(report.identityRowsMatch,false,String(physicalRow));
    assert.equal(report.approvalEvidencePersistent,false,String(physicalRow));
    assert.deepEqual(report.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
    assert.doesNotMatch(JSON.stringify(report),
      /CUS-001|SUP-001|REVIEW-001|admin-01|01700000000/);
    assert.deepEqual({plan,readback},prior,'readback must never alter evidence');
  }
});

test('same original physical row cannot belong to two source IDs in the same group',()=>{
  const rows=source();
  rows.CUSTOMERS.push({
    'Customer ID':'CUS-002','Customer Name':'Distinct Other Shop',
    'Phone':'01500000003','Status':'Active','_rowIndex':3
  });
  const plan=planPartyImport(rows,approval());
  assert.equal(plan.summary.pendingIdentityReviews,0);
  const linked=plan.links.filter(x=>x.sourceGroup==='CUSTOMERS');
  assert.deepEqual(linked.map(x=>x.legacySheetRow),[2,3]);
  const clean=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(clean.identityRowsMatch,true);
  linked[1].legacySheetRow=2;
  const readback=snapshot(plan,{approvalRef:true});
  const prior=structuredClone({plan,readback});
  const report=audit(plan,readback);
  assert.deepEqual(report.counts.expected,report.counts.actual);
  assert.equal(report.identityRowsMatch,false);
  assert.equal(report.approvalEvidencePersistent,false);
  assert.deepEqual(report.issues,[{code:'PLAN_LINKAGE_INVALID',table:'plan'}]);
  assert.doesNotMatch(JSON.stringify(report),/CUS-001|CUS-002|REVIEW-001|admin-01|01500000003/);
  assert.deepEqual({plan,readback},prior);
});

test('null source positions and equal row numbers across distinct source groups remain valid',()=>{
  const records=source();
  delete records.CUSTOMERS[0]._rowIndex;
  delete records.FINANCE_PERSONS[0]._rowIndex;
  const plan=planPartyImport(records,approval());
  assert.equal(plan.links.find(x=>x.sourceGroup==='CUSTOMERS').legacySheetRow,null);
  assert.equal(plan.links.find(x=>x.sourceGroup==='FINANCE_PERSONS').legacySheetRow,null);
  assert.equal(plan.links.find(x=>x.sourceGroup==='SUPPLIERS').legacySheetRow,2);
  assert.equal(plan.links.find(x=>x.sourceGroup==='VENDORS').legacySheetRow,2);
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,true);
  assert.equal(report.approvalEvidencePersistent,true);
  assert.deepEqual(report.issues,[]);
});


test('mirrored future D1 cannot certify malformed or fabricated per-group source counts',()=>{
  const cases=[
    ['missing-sourceGroups',plan=>{delete plan.summary.sourceGroups;}],
    ['missing-group',plan=>{plan.summary.sourceGroups.pop();}],
    ['invented-group',plan=>{plan.summary.sourceGroups[0].sourceGroup='UNKNOWN_GROUP';}],
    ['duplicate-group',plan=>{plan.summary.sourceGroups[1].sourceGroup='CUSTOMERS';}],
    ['missing-rows',plan=>{delete plan.summary.sourceGroups[0].rows;}],
    ['negative-rows',plan=>{
      plan.summary.sourceGroups[0].rows=-1;
      plan.summary.sourceGroups[1].rows=3;
    }],
    ['fractional-rows',plan=>{
      plan.summary.sourceGroups[0].rows=1.5;
      plan.summary.sourceGroups[1].rows=0.5;
    }],
    ['string-rows',plan=>{plan.summary.sourceGroups[0].rows='1';}],
    ['unsafe-rows',plan=>{plan.summary.sourceGroups[0].rows=Number.MAX_SAFE_INTEGER+1;}],
    ['group-total-mismatch',plan=>{plan.summary.sourceGroups[0].rows=2;}],
    ['less-than-linked-rows',plan=>{
      // Keep the total unchanged; a Customer source group cannot contain
      // zero source rows when a Customer legacy link exists.
      plan.summary.sourceGroups[0].rows=0;
      plan.summary.sourceGroups[1].rows=2;
    }]
  ];
  for(const [name,change] of cases){
    const plan=planned();
    change(plan);
    const readback=snapshot(plan,{approvalRef:true});
    const before=structuredClone({plan,readback});
    const report=audit(plan,readback);
    assert.deepEqual(report.counts.expected,report.counts.actual,name);
    assert.equal(report.identityRowsMatch,false,name);
    assert.equal(report.approvalEvidencePersistent,true,name+' proof persistence stays separate');
    assert.deepEqual(report.issues,[{code:'PLAN_COUNT_MISMATCH',table:'plan'}],name);
    assert.doesNotMatch(JSON.stringify(report),
      /CUS-001|SUP-001|VEN-001|FIN-001|PAY-001|REVIEW-001|admin-01/);
    assert.deepEqual({plan,readback},before,'readback does not mutate '+name);
  }
});

test('source group counts are independent of entry order and allow real zero groups',()=>{
  const records=source();
  records.VENDORS=[];
  const plan=planPartyImport(records,approval());
  plan.summary.sourceGroups.reverse();
  assert.equal(plan.summary.sourceGroups.find(x=>x.sourceGroup==='VENDORS').rows,0);
  const report=audit(plan,snapshot(plan,{approvalRef:true}));
  assert.equal(report.identityRowsMatch,true);
  assert.equal(report.approvalEvidencePersistent,true);
  assert.deepEqual(report.issues,[]);
});

test('legitimate source quarantines retain correct per-group counts without false count mismatches',()=>{
  const records=source();
  records.CUSTOMERS.push({'Customer ID':'','Customer Name':'missing source ID','_rowIndex':3});
  const plan=planPartyImport(records,[]);
  assert.equal(plan.summary.quarantinedRows,1);
  assert.equal(plan.summary.sourceGroups.find(x=>x.sourceGroup==='CUSTOMERS').rows,2);
  const report=audit(plan,snapshot(plan));
  assert.equal(report.identityRowsMatch,false,'quarantine still blocks import parity');
  assert.ok(codes(report).includes('QUARANTINED_SOURCE_ROWS'));
  assert.ok(codes(report).includes('PENDING_IDENTITY_REVIEW'));
  assert.ok(!codes(report).includes('PLAN_COUNT_MISMATCH'),
    'valid snapshot inventory remains consistent despite quarantine');
});
