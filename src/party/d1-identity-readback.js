/**
 * Internal M02-P Party identity D1 readback for OFFLINE migration review.
 * The original-source identity plan is compared against one D1 read-only batch.
 *
 * Never expose raw rows, implement a public Worker/RPC endpoint, authorize
 * identity approvals, or use this as a production-scale import/export utility.
 * The current 0002 Party schema cannot persist approval_ref. Reviewed joins
 * must therefore remain blocked by reconcilePartyImportReadback().
 *
 * Original Mohim_ERP source:
 * 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 */
import {reconcilePartyImportReadback} from './import-readback-reconciliation.js';

// Fixed table and column names: no user-controlled SQL identifiers or args.
const reads=Object.freeze([
  `SELECT party_id, display_name, phone, party_kind, status
     FROM parties ORDER BY party_id`,
  `SELECT party_id, role, status
     FROM party_roles ORDER BY party_id, role`,
  `SELECT source_group, source_id, party_id, legacy_sheet_row,
          link_basis, reviewed_by, reviewed_at, status
     FROM party_legacy_links ORDER BY source_group, source_id`
]);
// Explicit future-schema path; NEVER auto-select it on the current 0002 schema.
// Schema and reviewer authorization remain owned by M03/M04 respectively.
const readsWithApproval=Object.freeze([
  reads[0],reads[1],
  `SELECT source_group, source_id, party_id, legacy_sheet_row,
          link_basis, reviewed_by, reviewed_at, approval_ref, status
     FROM party_legacy_links ORDER BY source_group, source_id`
]);
const tables=Object.freeze(['parties','party_roles','party_legacy_links']);

/**
 * @param {{DB: object, plan: object}} input
 * @returns {Promise<object>} Redacted parity report, never database rows.
 */
async function readAndReconcilePartyIdentity(DB,plan,statements){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new Error('Party D1 binding unavailable');

  let readback;
  try{
    const prepared=statements.map(sql=>DB.prepare(sql));
    const results=await DB.batch(prepared);
    if(!Array.isArray(results) || results.length!==tables.length ||
      results.some(row=>!row || row.success!==true || !Array.isArray(row.results)))
      throw new Error('Invalid D1 batch results');

    readback=Object.fromEntries(tables.map((table,index)=>[
      table,results[index].results
    ]));
  }catch{
    // Cloudflare exceptions can include SQL or database values. Do not echo.
    throw new Error('Party D1 identity readback unavailable');
  }
  return reconcilePartyImportReadback({plan,readback});
}

/** Current 0002 Party schema: original links remain approval-ref unverified. */
export async function reconcilePartyIdentityD1({DB,plan}={}){
  return readAndReconcilePartyIdentity(DB,plan,reads);
}

/**
 * Strict opt-in for a FUTURE owner-approved schema that stores approval_ref.
 * Missing column or ambiguous D1 result fails closed; no fallback to 0002.
 * The result is a read-only parity report, NOT authorization to import/merge.
 */
export async function reconcilePartyIdentityApprovalD1({DB,plan}={}){
  return readAndReconcilePartyIdentity(DB,plan,readsWithApproval);
}
