import {partyLegacyContracts} from './legacy-contracts.js';

/**
 * M02-P offline, read-only identity import readback reconciliation.
 * Compares a reviewed proposal with supplied D1-shaped table snapshots.
 * Never writes SQL, joins people by name/phone, or authorizes import/cutover.
 *
 * Report issues contain NO record IDs, names, phone numbers or source values.
 * Keep underlying plans and readback private: they can contain sensitive data.
 * Original source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 */

const tables=['parties','party_roles','party_legacy_links'];
const validObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const validCount=value=>Number.isSafeInteger(value)&&value>=0;
const validMemberStatus=value=>value==='ACTIVE'||value==='INACTIVE';
const validLegacyStatus=value=>value==='ACTIVE'||value==='RETIRED';
const rowKey=(row,columns)=>{
  const values=columns.map(column=>row[column]);
  return values.every(value=>typeof value==='string'&&value.length>0)
    ?JSON.stringify(values):null;
};
const expectedRows=plan=>({
  parties:plan.parties.map(p=>({
    party_id:p.partyId,display_name:p.displayName,phone:p.phone||null,
    party_kind:p.partyKind,status:p.status
  })),
  party_roles:plan.roles.map(r=>({
    party_id:r.partyId,role:r.role,status:r.status
  })),
  party_legacy_links:plan.links.map(link=>({
    party_id:link.partyId,source_group:link.sourceGroup,
    source_id:link.sourceId,legacy_sheet_row:link.legacySheetRow,
    link_basis:link.linkBasis,reviewed_by:link.reviewedBy,
    reviewed_at:link.reviewedAt,status:link.status,
    approval_ref:link.approvalRef
  }))
});
const descriptions={
  parties:{
    key:['party_id'],fields:['display_name','phone','party_kind','status']
  },
  party_roles:{
    key:['party_id','role'],fields:['status']
  },
  party_legacy_links:{
    key:['source_group','source_id'],
    fields:['party_id','legacy_sheet_row','link_basis',
      'reviewed_by','reviewed_at','status','approval_ref']
  }
};

// Validate imported review claims as strictly as the source-only planner.
// These are data-quality checks, never proof of authenticated reviewer authority.
const canonicalReviewEvidence=value=>typeof value==='string' &&
  value.length>0 && value.trim()===value &&
  !/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u.test(value);
const utcReviewEvidence=value=>{
  if(typeof value!=='string' ||
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value))
    return false;
  const parsed=new Date(value);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0,19)===value.slice(0,19);
};

// A matching D1-shaped snapshot must not certify an internally impossible
// Party graph. This checks only structural lineage, never names or phone data.
function validPlanLinkage(plan){
  const ids=new Set(plan.parties.map(p=>p.partyId));
  const anchors=new Map([...ids].map(id=>[id,0]));
  const activeSources=new Set();
  const activeStaticRoles=new Set();
  const observedRoles=new Map([...ids].map(id=>[id,new Set()]));
  const allowedRoles=new Map([...ids].map(id=>[id,new Set()]));
  const requiredRoles=new Map([...ids].map(id=>[id,new Set()]));
  const financeLinked=new Set();
  const proofsByParty=new Map(),ownersByApprovalRef=new Map();
  for(const role of plan.roles){
    if(!ids.has(role.partyId)||!validMemberStatus(role.status))return false;
    observedRoles.get(role.partyId).add(role.role);
  }
  for(const link of plan.links){
    if(!ids.has(link.partyId) || !validLegacyStatus(link.status) ||
       !Object.hasOwn(partyLegacyContracts,link.sourceGroup))return false;
    if(link.status==='ACTIVE')activeSources.add(link.partyId);
    const spec=partyLegacyContracts[link.sourceGroup];
    for(const role of spec.roles){
      requiredRoles.get(link.partyId).add(role);
      allowedRoles.get(link.partyId).add(role);
      if(link.status==='ACTIVE')
        activeStaticRoles.add(JSON.stringify([link.partyId,role]));
    }
    if(link.sourceGroup==='FINANCE_PERSONS'){
      financeLinked.add(link.partyId);
      for(const role of spec.financeRoles)allowedRoles.get(link.partyId).add(role);
    }
    if(link.linkBasis==='ORIGINAL_RECORD'){
      if(link.reviewedBy!==null || link.reviewedAt!==null ||
         link.approvalRef!==null)return false;
      anchors.set(link.partyId,anchors.get(link.partyId)+1);
    }else if(link.linkBasis==='HUMAN_VERIFIED'){
      if(!canonicalReviewEvidence(link.reviewedBy) ||
         !canonicalReviewEvidence(link.approvalRef) ||
         !utcReviewEvidence(link.reviewedAt))return false;
      const earlier=proofsByParty.get(link.partyId);
      if(earlier){
        if(earlier.reviewedBy!==link.reviewedBy ||
           earlier.reviewedAt!==link.reviewedAt ||
           earlier.approvalRef!==link.approvalRef)return false;
      }else{
        if(ownersByApprovalRef.has(link.approvalRef))return false;
        proofsByParty.set(link.partyId,{
          reviewedBy:link.reviewedBy,reviewedAt:link.reviewedAt,
          approvalRef:link.approvalRef
        });
        ownersByApprovalRef.set(link.approvalRef,link.partyId);
      }
    }else return false;
  }
  for(const id of ids){
    const actual=observedRoles.get(id);
    if(!actual.size ||
       [...actual].some(role=>!allowedRoles.get(id).has(role)) ||
       [...requiredRoles.get(id)].some(role=>!actual.has(role)) ||
       (financeLinked.has(id) &&
        !partyLegacyContracts.FINANCE_PERSONS.financeRoles.some(role=>actual.has(role))))
      return false;
  }
  // Static role statuses are derived from the original links supplying each
  // role. Finance per-role status needs original row-level role membership.
  for(const role of plan.roles){
    if(requiredRoles.get(role.partyId).has(role.role) &&
       (role.status==='ACTIVE')!==
         activeStaticRoles.has(JSON.stringify([role.partyId,role.role])))
      return false;
  }
  // Source-only planner derives Party ACTIVE iff any original link is ACTIVE.
  for(const party of plan.parties){
    if(!validMemberStatus(party.status) ||
       (party.status==='ACTIVE')!==activeSources.has(party.partyId))
      return false;
  }
  return [...anchors.values()].every(count=>count===1) &&
    plan.summary.reviewedGroups===proofsByParty.size;
}

function indexRows(rows,table,keys,issues){
  const result=new Map();
  for(const row of rows){
    if(!validObject(row))throw new Error('Invalid Party import readback row');
    const key=rowKey(row,keys);
    if(key===null){
      issues.push({code:'INVALID_KEY',table});
      continue;
    }
    if(result.has(key)){
      issues.push({code:'DUPLICATE_ROW',table});
      continue;
    }
    result.set(key,row);
  }
  return result;
}

/**
 * @param {{plan: object, readback: object}} input
 * @returns {object} identity parity result; NOT production import readiness.
 */
export function reconcilePartyImportReadback({plan,readback}={}){
  if(!validObject(plan)||!validObject(plan.summary)||
    !Array.isArray(plan.parties)||!Array.isArray(plan.roles)||
    !Array.isArray(plan.links)||!Array.isArray(plan.reviewItems))
    throw new Error('Invalid Party import plan');
  if(!validObject(readback)||tables.some(table=>!Array.isArray(readback[table])))
    throw new Error('Invalid Party import readback');

  const expected=expectedRows(plan);
  const issues=[];
  const planLinkageValid=validPlanLinkage(plan);
  if(!planLinkageValid)
    issues.push({code:'PLAN_LINKAGE_INVALID',table:'plan'});
  const counts={expected:{},actual:{}};
  for(const table of tables){
    counts.expected[table]=expected[table].length;
    counts.actual[table]=readback[table].length;
  }

  if(!validCount(plan.summary.sourceRows)||
    !validCount(plan.summary.quarantinedRows)||
    plan.summary.proposedParties!==counts.expected.parties||
    plan.summary.roleMemberships!==counts.expected.party_roles||
    plan.summary.legacyLinks!==counts.expected.party_legacy_links||
    plan.summary.sourceRows!==plan.links.length+plan.summary.quarantinedRows||
    plan.summary.pendingIdentityReviews!==plan.reviewItems.length)
    issues.push({code:'PLAN_COUNT_MISMATCH',table:'plan'});
  if(plan.summary.quarantinedRows>0)
    issues.push({code:'QUARANTINED_SOURCE_ROWS',table:'plan'});
  if(plan.reviewItems.length>0)
    issues.push({code:'PENDING_IDENTITY_REVIEW',table:'plan'});

  let approvalEvidencePersistent=planLinkageValid;
  for(const table of tables){
    const {key,fields}=descriptions[table];
    const proposed=indexRows(expected[table],table,key,issues);
    const stored=indexRows(readback[table],table,key,issues);
    for(const [identity,row] of proposed){
      const actual=stored.get(identity);
      if(!actual){
        issues.push({code:'MISSING_ROW',table});
        if(table==='party_legacy_links'&&row.link_basis==='HUMAN_VERIFIED')
          approvalEvidencePersistent=false;
        continue;
      }
      for(const field of fields){
        const hasField=Object.hasOwn(actual,field);
        if(field==='approval_ref'&&row.link_basis==='HUMAN_VERIFIED'){
          if(!hasField||actual[field]===null||actual[field]===''){
            issues.push({code:'APPROVAL_REF_NOT_PERSISTED',table,field});
            approvalEvidencePersistent=false;
            continue;
          }
        }else if(field==='approval_ref'&&!hasField&&row[field]===null){
          // Original (nonmerged) source records need no approval reference.
          continue;
        }
        if(!hasField||actual[field]!==row[field]){
          issues.push({code:'FIELD_MISMATCH',table,field});
          // Human-reviewed links require the entire persisted proof tuple.
          // A changed reviewer, timestamp or basis is also lost approval evidence.
          if(field==='approval_ref' ||
             (table==='party_legacy_links' && row.link_basis==='HUMAN_VERIFIED' &&
              ['party_id','legacy_sheet_row','link_basis','reviewed_by','reviewed_at'].includes(field)))
            approvalEvidencePersistent=false;
        }
      }
    }
    for(const identity of stored.keys()){
      if(!proposed.has(identity))issues.push({code:'EXTRA_ROW',table});
    }
  }

  // Fixed-vocabulary diagnostics only. No source or D1 cell values in output.
  issues.sort((a,b)=>
    a.table.localeCompare(b.table)||
    a.code.localeCompare(b.code)||
    (a.field||'').localeCompare(b.field||'')
  );
  return {
    formatVersion:1,
    identityRowsMatch:issues.length===0,
    approvalEvidencePersistent,
    counts,
    issues
  };
}
