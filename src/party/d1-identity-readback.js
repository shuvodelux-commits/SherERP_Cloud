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
const tables=Object.freeze(['parties','party_roles','party_legacy_links']);

/**
 * @param {{DB: object, plan: object}} input
 * @returns {Promise<object>} Redacted parity report, never database rows.
 */
export async function reconcilePartyIdentityD1({DB,plan}={}){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new Error('Party D1 binding unavailable');

  let readback;
  try{
    const prepared=reads.map(sql=>DB.prepare(sql));
    const results=await DB.batch(prepared);
    if(!Array.isArray(results) || results.length!==tables.length ||
      results.some(row=>!row || row.success===false || !Array.isArray(row.results)))
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
