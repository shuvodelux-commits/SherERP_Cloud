import {verifyWithJwks} from 'hono/jwt';

const ISSUER='https://accounts.google.com';
const GOOGLE_ISSUER=/^(?:https:\/\/)?accounts\.google\.com$/;
const GOOGLE_KEYS='https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_CLIENT=/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/;
const NONCE=/^[A-Za-z0-9_-]{43}$/;
const COMPACT_JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SUBJECT=/^[!-~]{1,255}$/;

/**
 * Verify a Google ID token against trusted server configuration and the nonce
 * from an existing login challenge. The caller must consume the challenge
 * once and resolve an explicit external-identity link before issuing a session.
 */
export async function verifyGoogleLoginIdToken({token,clientId,expectedNonce}={}){
  if(typeof token!=='string' || token.length>8192 || !COMPACT_JWT.test(token) ||
     typeof clientId!=='string' || clientId.length>255 || !GOOGLE_CLIENT.test(clientId) ||
     typeof expectedNonce!=='string' || !NONCE.test(expectedNonce))return null;
  try{
    const claims=await verifyWithJwks(token,{
      jwks_uri:GOOGLE_KEYS,
      allowedAlgorithms:['RS256'],
      verification:{iss:GOOGLE_ISSUER,aud:clientId},
    },{redirect:'error',signal:AbortSignal.timeout(3000)});
    if((claims.iss!==ISSUER && claims.iss!=='accounts.google.com') ||
       claims.aud!==clientId || (claims.azp!==undefined && claims.azp!==clientId) ||
       !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
       claims.iat<0 || claims.exp<=claims.iat ||
       claims.nonce!==expectedNonce || claims.email_verified!==true ||
       typeof claims.sub!=='string' || !SUBJECT.test(claims.sub))return null;
    return {issuer:ISSUER,subject:claims.sub};
  }catch{
    return null;
  }
}
