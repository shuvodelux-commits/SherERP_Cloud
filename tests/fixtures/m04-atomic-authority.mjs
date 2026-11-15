/**
 * Synthetic M04 same-statement authorization boundary for local D1 testing.
 *
 * TEST-ONLY. This is not an ERP posting endpoint or authorization service.
 * Token digest, tenant scope and current epoch are supplied by trusted test
 * context, not accepted from a browser identity or clock.
 */
const HEX=/^[0-9a-f]{64}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const SQL=`UPDATE synthetic_auth_resources AS target
  SET available=available-?
  WHERE target.tenant_id=? AND target.item_id=? AND target.available>=?
    AND EXISTS (
      SELECT 1 FROM synthetic_auth_sessions AS s
      JOIN synthetic_auth_users AS u
        ON u.tenant_id=s.tenant_id AND u.user_id=s.user_id
      JOIN synthetic_auth_roles AS r
        ON r.tenant_id=s.tenant_id AND r.role_id=s.role_id
      WHERE s.token_hash=? AND s.tenant_id=? AND s.tenant_id=target.tenant_id
        AND s.revoked_at IS NULL AND s.expires_at>?
        AND u.status='Active' AND r.status='Active' AND r.can_edit=1
        AND u.role_id=s.role_id
        AND u.auth_version=s.user_version AND r.auth_version=s.role_version
    )
  RETURNING available`;

function validated(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
    (Object.getPrototypeOf(input)!==Object.prototype && Object.getPrototypeOf(input)!==null)) {
    throw new TypeError('Invalid synthetic authorization input');
  }
  const keys=Reflect.ownKeys(input);
  const wanted=['itemId','now','quantity','tenantId','tokenHash'];
  if(keys.length!==wanted.length || keys.some(key=>typeof key!=='string'||!wanted.includes(key))) {
    throw new TypeError('Invalid synthetic authorization input keys');
  }
  for(const key of wanted){
    const desc=Object.getOwnPropertyDescriptor(input,key);
    if(!desc || !Object.hasOwn(desc,'value') || !desc.enumerable)
      throw new TypeError('Invalid synthetic authorization input descriptor');
  }
  if(typeof input.tokenHash!=='string' || !HEX.test(input.tokenHash) ||
    typeof input.tenantId!=='string' || !KEY.test(input.tenantId) ||
    typeof input.itemId!=='string' || !KEY.test(input.itemId) ||
    !Number.isSafeInteger(input.quantity) || input.quantity<1 || input.quantity>10000 ||
    !Number.isSafeInteger(input.now) || input.now<0) {
    throw new TypeError('Invalid synthetic session digest, scope, quantity or time');
  }
  return input;
}

/**
 * The session join and resource mutation are one SQL statement; there is no
 * JS read-before-write authority that can become stale before execution.
 * Refusal is intentionally indistinguishable across authorization and stock.
 */
export function createSyntheticAuthorizedD1Mutation(DB){
  if(!DB || typeof DB.prepare!=='function')
    throw new Error('D1 synthetic authorization binding unavailable');
  return Object.freeze({
    async decrement_(request){
      const {tokenHash,tenantId,itemId,quantity,now}=validated(request);
      const result=await DB.prepare(SQL)
        .bind(quantity,tenantId,itemId,quantity,tokenHash,tenantId,now).first();
      if(result===null)throw new Error('Denied: synthetic authorized mutation refused');
      if(!result || !Number.isSafeInteger(result.available) || result.available<0) {
        throw new Error('Invalid D1 authorized mutation result; reconcile synthetic state');
      }
      return {available:result.available};
    }
  });
}
