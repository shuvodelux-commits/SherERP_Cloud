/**
 * M10 Run 7: only a PRIVATE, LOCAL Workerd/D1 synthetic migration audit.
 * This module never creates accounts, writes D1, authorizes a source merge,
 * opens RPC, or approves import, migration, activation or cutover.
 */
import {reconcilePartyImportReadback} from '../party/import-readback-reconciliation.js';
import {reconcileGrossPartyCheckpoints} from '../party/gross-checkpoint-parity.js';

const ERROR='M10 local Party gross gate unavailable';
const MODES=new Set(['BASE_SCHEMA','LOCAL_TEST_APPROVAL_COLUMN']);

// Exactly five fixed, SELECT-only statements. The test-only option is an
// explicit internal proof; the current production 0002 schema has NO
// approval_ref, and BASE_SCHEMA can never infer a human review from names.
const PARTIES=`SELECT party_id,display_name,phone,party_kind,status
  FROM parties ORDER BY party_id`;
const ROLES=`SELECT party_id,role,status
  FROM party_roles ORDER BY party_id,role`;
const LINKS=`SELECT source_group,source_id,party_id,legacy_sheet_row,
  link_basis,reviewed_by,reviewed_at,status
  FROM party_legacy_links ORDER BY source_group,source_id`;
const LINKS_TEST_APPROVAL=`SELECT source_group,source_id,party_id,
  legacy_sheet_row,link_basis,reviewed_by,reviewed_at,approval_ref,status
  FROM party_legacy_links ORDER BY source_group,source_id`;
const CURRENT=`SELECT party_id AS partyId,source_group AS sourceGroup,
  source_id AS sourceId,account_kind AS kind,source_field AS sourceField,
  basis,amount_minor AS amountMinor
  FROM m02_test_checkpoints WHERE basis='SOURCE_CURRENT'
  ORDER BY party_id,source_group,source_id,account_kind,source_field`;
const OPENING=`SELECT party_id AS partyId,source_group AS sourceGroup,
  source_id AS sourceId,account_kind AS kind,source_field AS sourceField,
  basis,amount_minor AS amountMinor
  FROM m02_test_checkpoints WHERE basis='HISTORICAL_OPENING'
  ORDER BY party_id,source_group,source_id,account_kind,source_field`;
const IDENTITY_TABLES=['parties','party_roles','party_legacy_links'];

function roleFor(kind){
  if(kind.startsWith('CUSTOMER_'))return 'Customer';
  if(kind.startsWith('SUPPLIER_'))return 'Supplier';
  if(kind.startsWith('VENDOR_'))return 'Vendor';
  if(kind.startsWith('OWNER_'))return 'Owner';
  if(kind.startsWith('LENDER_'))return 'Lender';
  if(kind.startsWith('BORROWER_'))return 'Borrower';
  return null;
}
function addIssue(counts,code,n=1){
  counts.set(code,(counts.get(code)||0)+n);
}
function summarize(issues){
  return [...issues].sort(([a],[b])=>a.localeCompare(b))
    .map(([code,count])=>({code,count}));
}
function basicReport({issues,readbackPerformed=false,sourcePlanValid=false,
  identityRowsMatch=false,approvalEvidencePersistent=false,
  grossCurrentMatch=false,grossOpeningMatch=false,
  grossCheckpointParity=false,crossSourceRoleLinksMatch=false}){
  const list=summarize(issues);
  return {
    formatVersion:1,phase:'M10_LOCAL_D1_PARTY_GROSS_JOINT_GATE',
    readbackPerformed,sourcePlanValid,
    identityRowsMatch,approvalEvidencePersistent,
    grossCurrentMatch,grossOpeningMatch,grossCheckpointParity,
    crossSourceRoleLinksMatch,
    candidateSyntheticCombinedParity:readbackPerformed&&sourcePlanValid&&
      identityRowsMatch&&approvalEvidencePersistent&&
      grossCurrentMatch&&grossOpeningMatch&&grossCheckpointParity&&
      crossSourceRoleLinksMatch&&list.length===0,
    authorizesRealImport:false,authorizesRemoteD1Write:false,
    authorizesCutover:false,productionReady:false,
    issues:list,
    limitations:'Only fabricated local D1 Party and test-only checkpoint parity; actual 0002 approval references, production financial accounts, 49-group historical import and cutover remain unverified'
  };
}
function sourceChecks(preflight,identityPlan,issues){
  // Validate accounting semantics through existing exact-minor-unit M02
  // comparator, not a second arithmetic implementation.
  const gross=reconcileGrossPartyCheckpoints({
    preflight,readback:{currentCheckpoints:[],openingCheckpoints:[]}
  });
  if(gross.sourcePlanValid!==true){
    addIssue(issues,'SOURCE_PLAN_BLOCKED');
    return false;
  }
  // Validates original source link review/anchor/role/physical-row graph
  // using the existing M02 pure comparator BEFORE opening a D1 connection.
  const probe=reconcilePartyImportReadback({
    plan:identityPlan,
    readback:{parties:[],party_roles:[],party_legacy_links:[]}
  });
  if(probe.issues.some(issue=>
    ['PLAN_LINKAGE_INVALID','PLAN_COUNT_MISMATCH',
      'QUARANTINED_SOURCE_ROWS','PENDING_IDENTITY_REVIEW'].includes(issue.code))){
    addIssue(issues,'SOURCE_IDENTITY_PLAN_BLOCKED');
    return false;
  }

  const links=new Map(identityPlan.links.map(link=>[
    JSON.stringify([link.sourceGroup,link.sourceId]),link.partyId
  ]));
  const roles=new Set(identityPlan.roles.map(row=>
    JSON.stringify([row.partyId,row.role])
  ));
  for(const row of [...preflight.currentCheckpoints,...preflight.openingCheckpoints]){
    const key=JSON.stringify([row.sourceGroup,row.sourceId]);
    if(links.get(key)!==row.partyId)
      addIssue(issues,'SOURCE_LINK_MISMATCH');
    const role=roleFor(row.kind);
    if(!role||!roles.has(JSON.stringify([row.partyId,role])))
      addIssue(issues,'SOURCE_ROLE_MISMATCH');
  }
  return issues.size===0;
}

/**
 * A combined independent read of actual local Workerd/D1 Party tables and
 * a disposable, TEST-ONLY gross checkpoint table. Never reads raw source
 * snapshots or performs any writing, and reports redacted issue totals only.
 *
 * LOCAL_TEST_APPROVAL_COLUMN is explicitly NONDEPLOYABLE and requires a
 * test-only ALTER on the ephemeral database, never on remote/production D1.
 */
export async function assessM10PartyGrossLocalD1({
  DB,preflight,identityPlan,mode='BASE_SCHEMA'
}={}){
  try{
    if(!MODES.has(mode))throw new Error(ERROR);
    const issues=new Map();
    const valid=sourceChecks(preflight,identityPlan,issues);
    if(!valid)return basicReport({issues,sourcePlanValid:false});
    if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
      throw new Error(ERROR);

    const sql=[PARTIES,ROLES,mode==='BASE_SCHEMA'?LINKS:LINKS_TEST_APPROVAL,
      CURRENT,OPENING];
    const result=await DB.batch(sql.map(query=>DB.prepare(query)));
    if(!Array.isArray(result)||result.length!==5||
       result.some(response=>!response||response.success!==true||
         !Array.isArray(response.results)))throw new Error(ERROR);
    const readback=Object.fromEntries(IDENTITY_TABLES.map(
      (table,index)=>[table,result[index].results]
    ));
    const identity=reconcilePartyImportReadback({plan:identityPlan,readback});
    const financial=reconcileGrossPartyCheckpoints({
      preflight,
      readback:{
        currentCheckpoints:result[3].results,
        openingCheckpoints:result[4].results
      }
    });
    for(const entry of identity.issues)
      addIssue(issues,'IDENTITY_'+entry.code);
    for(const entry of financial.issues)
      addIssue(issues,'GROSS_'+entry.stage+'_'+entry.code,entry.count);
    return basicReport({
      issues,readbackPerformed:true,
      sourcePlanValid:financial.sourcePlanValid===true,
      identityRowsMatch:identity.identityRowsMatch===true,
      approvalEvidencePersistent:identity.approvalEvidencePersistent===true,
      grossCurrentMatch:financial.currentMatch===true,
      grossOpeningMatch:financial.openingMatch===true,
      grossCheckpointParity:financial.offlineCheckpointParity===true,
      crossSourceRoleLinksMatch:true
    });
  }catch{
    // D1 errors and caller-supplied source IDs, names, phone, money and
    // human-review references must never appear in failures or reports.
    throw new Error(ERROR);
  }
}
