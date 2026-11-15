import {requireD1Binding} from './d1-binding.js';

/**
 * M03 synthetic D1 counter proof, not registered on live RPC or production DB.
 * The SQL trigger in the separately reviewed schema must atomically increment
 * the counter and stamp an immutable receipt on each successful INSERT.
 */
const CLAIM=`INSERT INTO synthetic_m03_id_receipts
  (tenant_id,id_key,operation_id,intent_hash) VALUES (?,?,?,?)
  ON CONFLICT(tenant_id,id_key,operation_id) DO NOTHING`;
const RECEIPT=`SELECT receipt.intent_hash,receipt.issued_sequence,counter.prefix
  FROM synthetic_m03_id_receipts AS receipt
  JOIN synthetic_m03_id_counters AS counter
    ON counter.tenant_id=receipt.tenant_id AND counter.id_key=receipt.id_key
  WHERE receipt.tenant_id=? AND receipt.id_key=? AND receipt.operation_id=?`;

const TENANT=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const FAMILY=/^[A-Z][A-Z0-9_]{0,63}$/;
const OPERATION=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const HASH=/^[a-f0-9]{64}$/;
const PREFIX=/^[A-Z][A-Z0-9]{0,15}$/;

/**
 * Require a trusted server-derived tenant ID. These methods are not public
 * and never infer authorization from client-supplied tenant or Party roles.
 */
export function createAtomicSourceIdIssuer(env,tenantId){
  const DB=requireD1Binding(env);
  if(typeof tenantId!=='string'||!TENANT.test(tenantId))
    throw new TypeError('Invalid trusted tenant ID');

  return Object.freeze({
    async allocate_({idKey,operationId,intentHash}={}){
      if(typeof idKey!=='string'||!FAMILY.test(idKey) ||
         typeof operationId!=='string'||!OPERATION.test(operationId) ||
         typeof intentHash!=='string'||!HASH.test(intentHash)){
        throw new TypeError('Invalid source ID family, operation ID or intent hash');
      }

      // The AFTER INSERT SQL trigger runs counter increment + receipt stamp
      // in the SAME SQLite statement. ON CONFLICT does not fire the trigger
      // for a stable replay, so the sequence is not consumed twice.
      const write=await DB.prepare(CLAIM)
        .bind(tenantId,idKey,operationId,intentHash).run();
      if(write?.success!==true)
        throw new Error('Unknown D1 source ID claim outcome; retry same operation ID');

      // SQLite RETURNING cannot observe changes made by AFTER triggers.
      // Read the committed exact-scope immutable receipt after the write.
      // If readback fails after commit, a stable retry reconciles safely.
      const row=await DB.prepare(RECEIPT).bind(tenantId,idKey,operationId).first();
      if(!row||row.intent_hash!==intentHash)
        throw new Error('Source ID intent collision or missing D1 receipt');
      if(!Number.isSafeInteger(row.issued_sequence)||row.issued_sequence<1 ||
         typeof row.prefix!=='string'||!PREFIX.test(row.prefix)){
        throw new Error('Invalid D1 source ID receipt sequence or prefix');
      }
      return {
        id:row.prefix+'-'+String(row.issued_sequence).padStart(6,'0'),
        sequence:row.issued_sequence
      };
    }
  });
}
