import {requireD1Binding} from './d1-binding.js';
import {createAtomicSourceIdIssuer} from './atomic-source-id-issuer.js';

/**
 * M03 isolated synthetic Workerd/D1 posting proof — NOT live financial code.
 *
 * The locally installed SQL schema, not JavaScript, owns one INSERT whose
 * nested triggers increment the source SALES counter, stamp its ID receipt,
 * conditionally deduct a test stock unit, and insert an immutable journal.
 * A late journal or stock failure ABORTs that entire original INSERT.
 *
 * This adapter verifies readback AFTER the source ID claim. The caller must
 * supply trusted tenant identity and a stable immutable operation/hash.
 * Never attach it to public RPC or production D1 without M04/M05/M06 review.
 */
const POSTED=`SELECT source_id,sku,units FROM synthetic_m03_post_journal
  WHERE tenant_id=? AND operation_id=?`;

export function createAtomicSourceIdPostingProof(env,tenantId){
  const DB=requireD1Binding(env);
  const issuer=createAtomicSourceIdIssuer(env,tenantId);
  return Object.freeze({
    async postSale_({operationId,intentHash}={}){
      // Fixed original family; never derive SQL identifiers or an actor from
      // an HTTP body. The SQL triggers make ID/stock/journal one transaction.
      const issued=await issuer.allocate_({
        idKey:'SALES',operationId,intentHash
      });
      const journal=await DB.prepare(POSTED)
        .bind(tenantId,operationId).first();
      if(!journal||journal.source_id!==issued.id ||
         journal.sku!=='PIPE-1'||journal.units!==1){
        throw new Error('Missing or mismatched synthetic D1 posted journal');
      }
      return {...issued,posted:true};
    }
  });
}
