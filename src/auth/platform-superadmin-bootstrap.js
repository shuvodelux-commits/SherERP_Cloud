import {verifyGoogleLoginIdToken} from './google-id-token.js';
import {hashOpaqueSessionToken} from './session-token.js';

const D1_NOW_MS="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const ACTIVE_TICKET=`token_hash=? AND issued_at_ms<=${D1_NOW_MS} AND expires_at_ms>${D1_NOW_MS}
  AND revoked_at_ms IS NULL
  AND NOT EXISTS(SELECT 1 FROM platform_first_superadmin WHERE singleton=1)`;

/**
 * Consume a pre-approved first-admin ticket on the trusted Control D1 binding.
 * The trusted caller supplies the OAuth client ID. No platform session or shop
 * membership is issued here. No public Worker imports this bootstrap.
 */
export async function bootstrapPlatformSuperAdmin({controlDb,clientId,setupToken,credential}){
  const ticketHash=await hashOpaqueSessionToken(setupToken);
  if(!ticketHash)return false;
  const ticket=await controlDb.prepare(`SELECT nonce,issuer,subject FROM platform_setup_tickets
    WHERE ${ACTIVE_TICKET}`).bind(ticketHash).first();
  if(!ticket)return false;

  const identity=await verifyGoogleLoginIdToken({token:credential,clientId,expectedNonce:ticket.nonce});
  if(!identity || identity.issuer!==ticket.issuer || identity.subject!==ticket.subject)return false;

  // Recheck the ticket and the permanent singleton in the same atomic write.
  const result=await controlDb.prepare(`INSERT INTO platform_first_superadmin
    (singleton,issuer,subject,setup_token_hash,enrolled_at_ms)
    SELECT 1,issuer,subject,token_hash,${D1_NOW_MS} FROM platform_setup_tickets
    WHERE ${ACTIVE_TICKET} AND nonce=? AND issuer=? AND subject=?`)
    .bind(ticketHash,ticket.nonce,identity.issuer,identity.subject).run();
  return result.success===true && result.meta?.changes===1;
}
