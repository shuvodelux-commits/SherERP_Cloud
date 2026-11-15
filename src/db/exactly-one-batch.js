import {requireD1Binding} from './d1-binding.js';

// The SQLite json_extract() call deliberately fails only when changes()!=1.
// A zero-row CAS update is otherwise successful SQL and D1.batch would commit
// later statements. This guard raises a SQLite error *inside the batch*
// transaction, so D1 rolls back earlier DML.
//
// The caller must supply pre-bound, reviewed DML with stable operation IDs.
// This low-level helper does NOT implement business idempotency or permissions.
const ASSERT_EXACTLY_ONE=`SELECT CASE
  WHEN changes()=1 THEN 1
  ELSE json_extract('M03_ASSERTION_FAILURE_NOT_JSON', '$')
  END AS changed_one`;

function validPrepared(statement){
  return statement!==null && typeof statement==='object' &&
    typeof statement.all==='function';
}

/**
 * Execute reviewed, already-bound D1 write statements under one D1.batch()
 * transaction. Each statement must affect exactly one row. A mismatch raises
 * a SQLite error inside the batch, not a post-commit JavaScript exception.
 *
 * Never expose to public RPC or supply arbitrary client SQL / table names.
 * An unknown result can represent a committed transaction; reconcile by
 * stable operationId rather than retry with a new ID.
 */
export function createD1ExactlyOneBatchGuard(env){
  const DB=requireD1Binding(env);
  if(typeof DB.batch!=='function'){
    throw new TypeError('D1 transactional batch binding unavailable');
  }
  return Object.freeze({
    async execute_(statements){
      if(!Array.isArray(statements) || statements.length===0 ||
          statements.some(step=>!validPrepared(step))){
        throw new TypeError('Invalid nonempty array of pre-bound D1 statements');
      }
      const batched=[];
      for(const statement of statements){
        batched.push(statement,DB.prepare(ASSERT_EXACTLY_ONE));
      }
      const result=await DB.batch(batched);
      if(!Array.isArray(result) || result.length!==batched.length ||
          result.some(item=>item?.success!==true) ||
          result.some((item,index)=>index%2===1 &&
            (item.results?.length!==1 || item.results[0]?.changed_one!==1))){
        throw new Error('Unknown D1 guarded batch outcome; reconcile by stable operation ID');
      }
    }
  });
}
