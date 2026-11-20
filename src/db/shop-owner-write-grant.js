import {hashOpaqueSessionToken} from '../auth/session-token.js';
import {OWNER_SESSION_MAX_AGE_SECONDS} from '../auth/platform-owner-session-deadline.js';

// Scope and generation must come from a trusted Control D1 decision. This
// repository is a Shop D1 boundary, not an Owner authentication service.
const SHOP_MATCH=`EXISTS (SELECT 1 FROM shop_identity
  WHERE singleton=1 AND shop_id=? AND database_id=? AND database_marker=?)`;
const scopeValues=({shopId,databaseId,databaseMarker})=>[shopId,databaseId,databaseMarker];

// The expiry comes from a trusted Control D1 session. Shop SQL also bounds it.
export async function publishOwnerWriteGrant(DB,scope,token,generation,expiresAtMs){
  const digest=await hashOpaqueSessionToken(token);
  if(!digest||!Number.isSafeInteger(generation)||generation<1||
     !Number.isSafeInteger(expiresAtMs)||expiresAtMs<1)throw new Error('Invalid Owner write grant');
  const now="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
  const row=await DB.prepare(`UPDATE shop_owner_write_grant
    SET token_hash=?,generation=?,enabled=1,expires_at_ms=?
    WHERE singleton=1 AND
      (generation<? OR (generation=? AND token_hash=? AND enabled=1 AND expires_at_ms=?))
      AND ${SHOP_MATCH}
      AND ?>${now} AND ?<=${now}+${OWNER_SESSION_MAX_AGE_SECONDS*1000}
    RETURNING generation`).bind(digest,generation,expiresAtMs,
      generation,generation,digest,expiresAtMs,...scopeValues(scope),expiresAtMs,expiresAtMs).first();
  return row!==null;
}

export async function withdrawOwnerWriteGrant(DB,scope,token){
  const digest=await hashOpaqueSessionToken(token);
  if(!digest)return false;
  const row=await DB.prepare(`UPDATE shop_owner_write_grant SET enabled=0
    WHERE singleton=1 AND token_hash=? AND ${SHOP_MATCH}
    RETURNING generation`).bind(digest,...scopeValues(scope)).first();
  return row!==null;
}

// Fence the claimed generation even if its first publication hasn't arrived.
// A higher generation already excludes this session. Never lower it.
export async function fenceOwnerWriteGrant(DB,scope,digest,generation){
  if(!/^[a-f0-9]{64}$/.test(digest)||!Number.isSafeInteger(generation)||generation<1)return false;
  const [write,read]=await DB.batch([
    DB.prepare(`UPDATE shop_owner_write_grant SET generation=?,token_hash=?,enabled=0
      WHERE singleton=1 AND (generation<? OR (generation=? AND token_hash=?)) AND ${SHOP_MATCH}`)
      .bind(generation,digest,generation,generation,digest,...scopeValues(scope)),
    DB.prepare(`SELECT 1 FROM shop_owner_write_grant
      WHERE singleton=1 AND (generation>? OR (generation=? AND token_hash=? AND enabled=0)) AND ${SHOP_MATCH}`)
      .bind(generation,generation,digest,...scopeValues(scope)),
  ]);
  return write.success&&read.success&&read.results.length===1;
}
