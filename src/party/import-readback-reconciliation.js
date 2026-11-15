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
  const counts={expected:{},actual:{}};
  for(const table of tables){
    counts.expected[table]=expected[table].length;
    counts.actual[table]=readback[table].length;
  }

  if(plan.summary.proposedParties!==counts.expected.parties||
    plan.summary.roleMemberships!==counts.expected.party_roles||
    plan.summary.legacyLinks!==counts.expected.party_legacy_links||
    plan.summary.sourceRows!==plan.links.length+plan.summary.quarantinedRows||
    plan.summary.pendingIdentityReviews!==plan.reviewItems.length)
    issues.push({code:'PLAN_COUNT_MISMATCH',table:'plan'});
  if(plan.summary.quarantinedRows>0)
    issues.push({code:'QUARANTINED_SOURCE_ROWS',table:'plan'});
  if(plan.reviewItems.length>0)
    issues.push({code:'PENDING_IDENTITY_REVIEW',table:'plan'});

  let approvalEvidencePersistent=true;
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
              ['link_basis','reviewed_by','reviewed_at'].includes(field)))
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
