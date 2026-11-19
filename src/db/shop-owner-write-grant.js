import {hashOpaqueSessionToken} from '../auth/session-token.js';

// Scope and generation must come from a trusted Control D1 decision. This
// repository is a Shop D1 boundary, not an Owner authentication service.
const SHOP_MATCH=`EXISTS (SELECT 1 FROM shop_identity
  WHERE singleton=1 AND shop_id=? AND database_id=? AND database_marker=?)`;
const scopeValues=({shopId,databaseId,databaseMarker})=>[shopId,databaseId,databaseMarker];

export async function publishOwnerWriteGrant(DB,scope,token,generation){
  const digest=await hashOpaqueSessionToken(token);
  if(!digest||!Number.isSafeInteger(generation)||generation<1)throw new Error('Invalid Owner write grant');
  const row=await DB.prepare(`UPDATE shop_owner_write_grant
    SET token_hash=?,generation=?,enabled=1
    WHERE singleton=1 AND generation<? AND ${SHOP_MATCH}
    RETURNING generation`).bind(digest,generation,generation,...scopeValues(scope)).first();
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
