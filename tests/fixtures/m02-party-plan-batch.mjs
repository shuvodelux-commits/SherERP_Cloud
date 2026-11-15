/**
 * TEST-ONLY: compile reviewed synthetic M02 identity proposals to prepared
 * statements for one bounded LOCAL workerd/D1 batch.
 *
 * This is NOT a production importer; approval claims are not authenticated.
 * Do not use with real data, staging/prod, or caller-supplied SQL identifiers.
 */
import {planPartyImport} from '../../src/party/party-import-plan.js';

const approvedTimestamp=x=>typeof x==='string' &&
  /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(x);

export function compileSyntheticPartyImport({DB,sourceRows,approvedGroups=[],createdAt}={}){
  if(!DB || typeof DB.prepare!=='function')
    throw new Error('Local D1 prepared-statement binding required');
  if(!approvedTimestamp(createdAt))
    throw new Error('Synthetic import timestamp must be a fixed UTC time');
  const plan=planPartyImport(sourceRows,approvedGroups);
  if(plan.summary.quarantinedRows>0 || plan.reviewItems.length>0)
    throw new Error('Unresolved or quarantined source identities require review before any D1 import');
  if(plan.summary.sourceRows>20)
    throw new Error('Test-only synthetic fixture row limit exceeded');
  if(plan.links.length!==plan.summary.sourceRows)
    throw new Error('Source link coverage mismatch');

  // Existing schema deliberately has no approvalRef. This test compiler
  // retains the evidence ONLY in the returned in-memory proposal.
  const statements=[];
  for(const party of plan.parties){
    statements.push(DB.prepare(`INSERT INTO parties
      (party_id,display_name,phone,party_kind,status,created_at)
      VALUES(?,?,?,?,?,?)`).bind(
      party.partyId,party.displayName,party.phone||null,
      party.partyKind,party.status,createdAt
    ));
  }
  for(const role of plan.roles){
    statements.push(DB.prepare(`INSERT INTO party_roles
      (party_id,role,status,created_at) VALUES(?,?,?,?)`).bind(
      role.partyId,role.role,role.status,createdAt
    ));
  }

  // The original dry-run sorts links by source group for audit readability.
  // D1's cross-source trigger needs the ORIGINAL_RECORD to be inserted first
  // for each Party, regardless of source-group sort order.
  const rank=link=>link.linkBasis==='ORIGINAL_RECORD'?0:1;
  const orderedLinks=[...plan.links].sort((a,b)=>
    a.partyId.localeCompare(b.partyId)||
    rank(a)-rank(b)||
    a.sourceGroup.localeCompare(b.sourceGroup)||
    a.sourceId.localeCompare(b.sourceId)
  );
  const initialized=new Set();
  for(const link of orderedLinks){
    if(!initialized.has(link.partyId)){
      if(link.linkBasis!=='ORIGINAL_RECORD')
        throw new Error('Missing ORIGINAL_RECORD anchor before verified links');
      initialized.add(link.partyId);
    }else if(link.linkBasis!=='HUMAN_VERIFIED'){
      throw new Error('Second Party source link requires human verification');
    }
    statements.push(DB.prepare(`INSERT INTO party_legacy_links
      (party_id,source_group,source_id,legacy_sheet_row,link_basis,
       reviewed_by,reviewed_at,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(
      link.partyId,link.sourceGroup,link.sourceId,link.legacySheetRow,
      link.linkBasis,link.reviewedBy,link.reviewedAt,link.status,createdAt
    ));
  }
  return {plan,statements};
}