/**
 * TEST-ONLY: synthetic gross checkpoint readback on ephemeral LOCAL Workerd D1.
 * Not a financial account schema, production adapter, RPC or deployment.
 * Frozen source Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 */
import {reconcileGrossPartyCheckpoints} from '../../src/party/gross-checkpoint-parity.js';

// Test fixture table only, NEVER created by production migrations.
// Only constant identifiers and basis filters; no caller SQL or write queries.
const selects=Object.freeze([
  `SELECT party_id AS partyId,source_group AS sourceGroup,
     source_id AS sourceId,account_kind AS kind,source_field AS sourceField,
     basis,amount_minor AS amountMinor
     FROM m02_test_checkpoints WHERE basis='SOURCE_CURRENT'
     ORDER BY party_id,source_group,source_id,account_kind,source_field`,
  `SELECT party_id AS partyId,source_group AS sourceGroup,
     source_id AS sourceId,account_kind AS kind,source_field AS sourceField,
     basis,amount_minor AS amountMinor
     FROM m02_test_checkpoints WHERE basis='HISTORICAL_OPENING'
     ORDER BY party_id,source_group,source_id,account_kind,source_field`
]);

/** Read-only local test harness; returns only pure comparator's redacted report. */
export async function reconcileSyntheticGrossCheckpointsD1(input={}){
  try{
    const {DB,preflight}=input;
    // Validate source plan before opening or reading any database binding.
    // Empty readback is a well-formed PRIVATE probe, not actual D1 evidence.
    const gate=reconcileGrossPartyCheckpoints({
      preflight,readback:{currentCheckpoints:[],openingCheckpoints:[]}
    });
    if(gate.sourcePlanValid!==true)return gate;
    if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
      throw new Error('Missing local test D1 binding');
    const batch=await DB.batch(selects.map(sql=>DB.prepare(sql)));
    if(!Array.isArray(batch)||batch.length!==2||
       batch.some(result=>!result||result.success!==true||
         !Array.isArray(result.results)))
      throw new Error('Invalid local D1 result envelope');
    return reconcileGrossPartyCheckpoints({
      preflight,
      readback:{
        currentCheckpoints:batch[0].results,
        openingCheckpoints:batch[1].results
      }
    });
  }catch{
    // Never return original account money, Party IDs, SQL or D1 error strings.
    throw new Error('Synthetic gross D1 parity unavailable');
  }
}
