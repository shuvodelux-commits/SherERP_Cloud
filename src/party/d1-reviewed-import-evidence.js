/**
 * M02-P internal source-gated, read-only Party evidence on D1.
 * Frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * No public RPC, importer, approval, writes, or production cutover.
 */
import {validatePartyImportCandidate} from './import-validation-bundle.js';
import {reconcileReviewedPartyImport} from './import-evidence-gate.js';

// Current 0002 Party schema has NO approval_ref. Never infer that evidence.
// Queries are fixed identifiers, no user inputs or writable SQL.
const queries=Object.freeze([
  `SELECT party_id, display_name, phone, party_kind, status
     FROM parties ORDER BY party_id`,
  `SELECT party_id, role, status
     FROM party_roles ORDER BY party_id, role`,
  `SELECT source_group, source_id, party_id, legacy_sheet_row,
          link_basis, reviewed_by, reviewed_at, status
     FROM party_legacy_links ORDER BY source_group, source_id`
]);
const tables=Object.freeze(['parties','party_roles','party_legacy_links']);

/**
 * Read at most one D1 batch, and only after both reviewed source exports
 * and human-review claims pass existing offline provenance checks.
 * Always return the existing redacted report, never raw D1 records.
 */
export async function reconcileReviewedPartyIdentityD1({
  DB,reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,approvedGroups
}={}){
  try{
    const request={reviewedRows,reviewedHeaders,candidateRows,
      candidateHeaders,approvedGroups};
    const source=validatePartyImportCandidate(request);
    if(source.offlineValidationClear!==true){
      // No D1 access on incomplete, drifted or pending-review sources.
      return reconcileReviewedPartyImport(request);
    }
    if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
      throw new Error('Missing D1 binding');
    const results=await DB.batch(queries.map(sql=>DB.prepare(sql)));
    if(!Array.isArray(results) || results.length!==tables.length ||
       results.some(item=>!item || item.success!==true ||
         !Array.isArray(item.results)))
      throw new Error('Invalid D1 result envelope');
    const readback=Object.fromEntries(tables.map((table,index)=>[
      table,results[index].results
    ]));
    return reconcileReviewedPartyImport({...request,readback});
  }catch{
    // Never expose SQL, row/Party IDs, reviewed claims or arbitrary driver text.
    throw new Error('Party reviewed D1 evidence unavailable');
  }
}
