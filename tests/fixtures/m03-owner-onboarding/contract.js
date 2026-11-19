// Local D1 proof only. No request handlers, remote credentials or cloud provisioning.
import {hashOpaqueSessionToken} from '../../../src/auth/session-token.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const GOOGLE_ISSUER='https://accounts.google.com';
const INVITE_LIFETIME_MS=600_000;
const ID=/^[a-z0-9-]{1,64}$/;
const SUBJECT=/^[!-~]{1,255}$/;

function validGoogleIdentity(identity){
  return identity?.issuer===GOOGLE_ISSUER &&
    typeof identity.subject==='string' && SUBJECT.test(identity.subject);
}

export async function reserveShop(db,{shopId,operationId,recipient,inviteToken,sessionToken}){
  if(typeof shopId!=='string'||!ID.test(shopId)||typeof operationId!=='string'||!ID.test(operationId)||
     !validGoogleIdentity(recipient))return false;
  const [inviteHash,sessionHash]=await Promise.all([
    hashOpaqueSessionToken(inviteToken),hashOpaqueSessionToken(sessionToken),
  ]);
  if(!inviteHash||!sessionHash)return false;
  const result=await db.prepare(`INSERT INTO fixture_shops
    (shop_id,operation_id,inviter_subject,invite_hash,recipient_issuer,recipient_subject,expires_at_ms)
    SELECT ?,?,f.subject,?,?,?,${NOW}+?
    FROM platform_admin_sessions s JOIN platform_first_superadmin f ON f.singleton=s.singleton
    JOIN platform_admin_auth a ON a.singleton=s.singleton AND a.enabled=1 AND a.factor_version=s.factor_version
    WHERE s.token_hash=? AND s.issued_at_ms<=${NOW} AND s.expires_at_ms>${NOW} AND s.revoked_at_ms IS NULL
    ON CONFLICT DO NOTHING`)
    .bind(shopId,operationId,inviteHash,recipient.issuer,recipient.subject,INVITE_LIFETIME_MS,sessionHash).run();
  return result.success===true && result.meta?.changes===1;
}

// The caller supplies identity from trusted, already verified Google claims.
// The single first-Owner membership is also the durable invite consumption record.
export async function acceptOwnerInvite(db,{inviteToken,identity}){
  if(!validGoogleIdentity(identity))return false;
  const inviteHash=await hashOpaqueSessionToken(inviteToken);
  if(!inviteHash)return false;
  const result=await db.prepare(`INSERT INTO fixture_shop_memberships(shop_id,issuer,subject,role)
    SELECT shop_id,recipient_issuer,recipient_subject,'Owner'
    FROM fixture_shops
    WHERE invite_hash=? AND recipient_issuer=? AND recipient_subject=? AND ready=1 AND expires_at_ms>${NOW}
    ON CONFLICT(shop_id) DO NOTHING`)
    .bind(inviteHash,identity.issuer,identity.subject).run();
  return result.success===true && result.meta?.changes===1;
}
