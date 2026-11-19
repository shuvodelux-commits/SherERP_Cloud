import {verifyWithJwks} from 'hono/jwt';

const ISSUER='https://accounts.google.com';
const GOOGLE_ISSUER=/^(?:https:\/\/)?accounts\.google\.com$/;
const GOOGLE_KEYS='https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_CLIENT=/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/;
const NONCE=/^[A-Za-z0-9_-]{43}$/;
const COMPACT_JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SUBJECT=/^[!-~]{1,255}$/;

const VERIFICATION_REASONS=new Map([
  ['JwtTokenIssuer','issuer'],['JwtTokenAudience','audience'],['JwtPayloadRequiresAud','audience'],
  ['JwtTokenIssuedAt','time'],['JwtTokenExpired','time'],['JwtTokenNotBefore','time'],
  ['TimeoutError','keys_unavailable'],
]);

function verificationReason(error){
  if(error instanceof Error && (error.message===`failed to fetch JWKS from ${GOOGLE_KEYS}` ||
    error.message==='invalid JWKS response. "keys" field is missing' ||
    error.message==='invalid JWKS response. "keys" field is not an array'))return 'keys_unavailable';
  return VERIFICATION_REASONS.get(error?.name)??(error?.name==='TypeError'?'network_or_crypto':'key_or_token');
}

/**
 * Verify a Google ID token against trusted server configuration and the nonce
 * from an existing login challenge. The caller must consume the challenge
 * once and resolve an explicit external-identity link before issuing a session.
 */
export async function verifyGoogleLoginIdToken({token,clientId,expectedNonce,onRejected}={}){
  const reject=reason=>{onRejected?.(reason);return null;};
  if(typeof token!=='string' || token.length>8192 || !COMPACT_JWT.test(token) ||
     typeof clientId!=='string' || clientId.length>255 || !GOOGLE_CLIENT.test(clientId) ||
     typeof expectedNonce!=='string' || !NONCE.test(expectedNonce))return reject('input');
  let claims;
  try{
    claims=await verifyWithJwks(token,{
      jwks_uri:GOOGLE_KEYS,
      allowedAlgorithms:['RS256'],
      verification:{iss:GOOGLE_ISSUER,aud:clientId},
    },{redirect:'error',signal:AbortSignal.timeout(3000)});
  }catch(error){
    return reject(verificationReason(error));
  }
  if(claims.iss!==ISSUER && claims.iss!=='accounts.google.com')return reject('issuer');
  if(claims.aud!==clientId || (claims.azp!==undefined && claims.azp!==clientId))return reject('audience');
  if(!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
     claims.iat<0 || claims.exp<=claims.iat)return reject('time');
  if(claims.nonce!==expectedNonce)return reject('nonce');
  if(claims.email_verified!==true)return reject('email_verification');
  if(typeof claims.sub!=='string' || !SUBJECT.test(claims.sub))return reject('subject');
  return {issuer:ISSUER,subject:claims.sub};
}
