/**
 * Synthetic M04 D1 session authority and revocation preflight.
 *
 * TEST-ONLY. Not a real login/session API, user database, expiry policy, or
 * production schema. Trusted backend callers pass digest, userId and clock;
 * never pass raw bearer tokens, client actor IDs or request timestamps here.
 */
const HASH=/^[0-9a-f]{64}$/;
const SOURCE_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SQL=Object.freeze({
  issue:`INSERT INTO synthetic_sessions
    (token_hash,user_id,user_version,role_id,role_version,created_at,expires_at)
    SELECT ?,u.user_id,u.auth_version,r.role_id,r.auth_version,?,?
    FROM synthetic_users u JOIN synthetic_roles r ON r.role_id=u.role_id
    WHERE u.user_id=? AND u.status='Active' AND r.status='Active'
    RETURNING user_id,role_id`,
  resolve:`SELECT s.user_id,s.role_id FROM synthetic_sessions s
    JOIN synthetic_users u ON u.user_id=s.user_id
    JOIN synthetic_roles r ON r.role_id=s.role_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND u.status='Active' AND r.status='Active'
      AND u.role_id=s.role_id
      AND u.auth_version=s.user_version AND r.auth_version=s.role_version`,
  revoke:`UPDATE synthetic_sessions SET revoked_at=?
    WHERE token_hash=? AND revoked_at IS NULL
    RETURNING token_hash`
});
function hasExactKeys(value,keys) {
  if(value===null || typeof value!=='object' || Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype && proto!==null)return false;
  const all=Reflect.ownKeys(value);
  return all.length===keys.length && all.every(key=>{
    if(typeof key!=='string'||!keys.includes(key))return false;
    const desc=Object.getOwnPropertyDescriptor(value,key);
    return !!desc && Object.hasOwn(desc,'value');
  });
}
function instant(value){return Number.isSafeInteger(value) && value>=0;}
function checkTokenClock(input) {
  if(!hasExactKeys(input,['tokenHash','now']) ||
     typeof input.tokenHash!=='string' || !HASH.test(input.tokenHash) || !instant(input.now)) {
    throw new TypeError('Invalid synthetic session token digest/time');
  }
}
function checkIssue(input) {
  if(!hasExactKeys(input,['tokenHash','userId','now','expiresAt']) ||
    typeof input.tokenHash!=='string' || !HASH.test(input.tokenHash) ||
    typeof input.userId!=='string' || !SOURCE_ID.test(input.userId) ||
    !instant(input.now) || !instant(input.expiresAt) || input.expiresAt<=input.now) {
    throw new TypeError('Invalid synthetic session digest, user ID or expiration time');
  }
}
function parseIdentity(result) {
  if(result===null)return null;
  if(!result || typeof result.user_id!=='string' || !result.user_id ||
      typeof result.role_id!=='string' || !result.role_id) {
    throw new Error('Invalid D1 synthetic session identity result');
  }
  return {userId:result.user_id,roleId:result.role_id};
}
/**
 * Tests enforce source-shaped, immediately revocable authority snapshots.
 * Future financial writes must check actual authority inside the posting
 * transaction as applicable; a separate preflight read can race a disable.
 */
export function createSyntheticD1SessionRepository(DB){
  if(!DB || typeof DB.prepare!=='function')
    throw new Error('D1 session test binding unavailable');
  return Object.freeze({
    async issue(input){
      checkIssue(input);
      const result=await DB.prepare(SQL.issue)
        .bind(input.tokenHash,input.now,input.expiresAt,input.userId).first();
      if(parseIdentity(result)===null){
        throw new Error('Inactive or missing synthetic user/role; session issuance refused');
      }
      return {created:true};
    },
    async resolve(input){
      checkTokenClock(input);
      const result=await DB.prepare(SQL.resolve).bind(input.tokenHash,input.now).first();
      return parseIdentity(result);
    },
    async revoke(input){
      checkTokenClock(input);
      const result=await DB.prepare(SQL.revoke).bind(input.now,input.tokenHash).first();
      if(result===null)return false;
      if(!result || result.token_hash!==input.tokenHash){
        throw new Error('Invalid D1 synthetic session revocation result');
      }
      return true;
    }
  });
}
