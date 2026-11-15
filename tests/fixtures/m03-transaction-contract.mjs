/**
 * Test-only M03 D1 transaction/idempotency proof. NEVER import into a public
 * Worker or mistake these synthetic tables for approved ERP financial schema.
 * Uses the real D1 batch transaction semantics under workerd integration.
 */
const ID=/^[A-Z0-9_-]{1,64}$/;
const HASH=/^[a-f0-9]{64}$/;

const SQL=Object.freeze([
  `INSERT INTO synthetic_operations(operation_id,payload_hash,units,state)
   SELECT ?, ?, ?, 'COMMITTED'
   WHERE EXISTS (SELECT 1 FROM synthetic_stock
                 WHERE account_id='counter' AND available>=?)
   ON CONFLICT(operation_id) DO NOTHING
   RETURNING operation_id`,
  `UPDATE synthetic_stock SET available=available-?
   WHERE account_id='counter' AND available>=? AND changes()=1
     AND EXISTS (SELECT 1 FROM synthetic_operations
                 WHERE operation_id=? AND payload_hash=? AND units=? AND state='COMMITTED')
   RETURNING available`,
  `INSERT INTO synthetic_movements(operation_id,units)
   SELECT ?,? WHERE changes()=1
   RETURNING operation_id`,
  `SELECT payload_hash,units,state FROM synthetic_operations
   WHERE operation_id=?`
]);

function validate(input) {
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     (Object.getPrototypeOf(input)!==Object.prototype && Object.getPrototypeOf(input)!==null) ||
     Object.keys(input).sort().join(',')!=='operationId,payloadHash,units' ||
     typeof input.operationId!=='string' || !ID.test(input.operationId) ||
     typeof input.payloadHash!=='string' || !HASH.test(input.payloadHash) ||
     !Number.isSafeInteger(input.units) || input.units<1 || input.units>1_000_000) {
    throw new TypeError('Invalid synthetic operation ID, units or payload hash');
  }
}

function resultRows(part) {
  if(part?.success!==true || !Array.isArray(part.results)) {
    throw new Error('NEEDS_REVIEW: invalid D1 posting contract result; reconcile operation ID');
  }
  return part.results;
}

export function createSyntheticD1PostingContract(DB) {
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new Error('D1 transactional batch binding unavailable');
  return Object.freeze({
    async post(input) {
      validate(input);
      const {operationId,payloadHash,units}=input;
      // One transaction: do not interleave statement terminals with JS reads.
      // The changes() guard stops a replay from reapplying child writes.
      const batch=await DB.batch([
        DB.prepare(SQL[0]).bind(operationId,payloadHash,units,units),
        DB.prepare(SQL[1]).bind(units,units,operationId,payloadHash,units),
        DB.prepare(SQL[2]).bind(operationId,units),
        DB.prepare(SQL[3]).bind(operationId)
      ]);
      if(!Array.isArray(batch) || batch.length!==4)
        throw new Error('NEEDS_REVIEW: malformed D1 posting batch; reconcile operation ID');
      const [claimed,stock,movement,lookup]=batch.map(resultRows);
      const existing=lookup.length===1?lookup[0]:null;
      if(claimed.length===1 && stock.length===1 && movement.length===1 &&
         claimed[0]?.operation_id===operationId &&
         movement[0]?.operation_id===operationId &&
         existing?.payload_hash===payloadHash && existing.units===units &&
         existing.state==='COMMITTED') {
        return {status:'COMMITTED',operationId};
      }
      if(claimed.length===0 && stock.length===0 && movement.length===0) {
        if(existing===null && lookup.length===0) return {status:'DECLINED',operationId};
        if(existing?.state==='COMMITTED') {
          return {status:existing.payload_hash===payloadHash && existing.units===units
            ? 'REPLAY':'CONFLICT',operationId};
        }
      }
      throw new Error('NEEDS_REVIEW: ambiguous D1 posting result; reconcile by stable operation ID');
    }
  });
}
