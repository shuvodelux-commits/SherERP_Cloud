// Local D1 proof only. No request handlers, remote credentials or cloud provisioning.
import {hashOpaqueSessionToken} from '../../../src/auth/session-token.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const GOOGLE_ISSUER='https://accounts.google.com';
const INVITE_LIFETIME_MS=600_000;
const ID=/^[a-z0-9-]{1,64}$/;
const SUBJECT=/^[!-~]{1,255}$/;
const MARKER=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const CURRENT_ADMIN=`FROM platform_admin_sessions s
  JOIN platform_first_superadmin f ON f.singleton=s.singleton
  JOIN platform_admin_auth a ON a.singleton=s.singleton AND a.enabled=1 AND a.factor_version=s.factor_version
  WHERE s.token_hash=? AND s.issued_at_ms<=${NOW} AND s.expires_at_ms>${NOW} AND s.revoked_at_ms IS NULL`;

function validGoogleIdentity(identity){
  return identity?.issuer===GOOGLE_ISSUER &&
    typeof identity.subject==='string' && SUBJECT.test(identity.subject);
}

export async function reserveShop(db,{shopId,operationId,recipient,inviteToken,sessionToken,databaseMarker}){
  if(typeof shopId!=='string'||!ID.test(shopId)||typeof operationId!=='string'||!ID.test(operationId)||
     !validGoogleIdentity(recipient)||typeof databaseMarker!=='string'||!MARKER.test(databaseMarker))return false;
  const [inviteHash,sessionHash]=await Promise.all([
    hashOpaqueSessionToken(inviteToken),hashOpaqueSessionToken(sessionToken),
  ]);
  if(!inviteHash||!sessionHash)return false;
  const result=await db.prepare(`INSERT INTO fixture_shops
    (shop_id,operation_id,inviter_subject,invite_hash,recipient_issuer,recipient_subject,expires_at_ms,database_marker)
    SELECT ?,?,f.subject,?,?,?,${NOW}+?,? ${CURRENT_ADMIN}
    ON CONFLICT DO NOTHING`)
    .bind(shopId,operationId,inviteHash,recipient.issuer,recipient.subject,INVITE_LIFETIME_MS,databaseMarker,sessionHash).run();
  return result.success===true && result.meta?.changes===1;
}

// The provisioning caller chooses the Shop D1 binding from its trusted map.
// A marker is a local identity check. It does not attest a Cloudflare database UUID.
export async function recordShopReadiness(db,{shopDb,shopId,operationId,sessionToken}){
  const sessionHash=await hashOpaqueSessionToken(sessionToken);
  if(!sessionHash)return false;
  let marker;
  try{
    marker=await shopDb.prepare('SELECT shop_id,database_marker FROM shop_identity WHERE singleton=1').first();
  }catch{
    return false;
  }
  if(!marker||marker.shop_id!==shopId)return false;
  const result=await db.prepare(`UPDATE fixture_shops SET ready=1
    WHERE shop_id=? AND operation_id=? AND database_marker=? AND ready=0
    AND EXISTS(SELECT 1 ${CURRENT_ADMIN})`)
    .bind(shopId,operationId,marker.database_marker,sessionHash).run();
  return result.success===true && result.meta?.changes===1;
}

// The caller supplies identity from trusted, already verified Google claims.
// The membership insert trigger records invite consumption in the same statement.
export async function acceptOwnerInvite(db,{inviteToken,identity}){
  if(!validGoogleIdentity(identity))return false;
  const inviteHash=await hashOpaqueSessionToken(inviteToken);
  if(!inviteHash)return false;
  const result=await db.prepare(`INSERT INTO fixture_shop_memberships(shop_id,issuer,subject,role)
    SELECT shop_id,recipient_issuer,recipient_subject,'Owner'
    FROM fixture_shops
    WHERE invite_hash=? AND recipient_issuer=? AND recipient_subject=? AND ready=1 AND expires_at_ms>${NOW}
    AND NOT EXISTS(SELECT 1 FROM fixture_invite_consumptions c WHERE c.invite_hash=fixture_shops.invite_hash)
    ON CONFLICT(shop_id) DO NOTHING
    RETURNING shop_id`)
    .bind(inviteHash,identity.issuer,identity.subject).first();
  return result!==null;
}
