/**
 * Test-only ephemeral Google-like signing key. Never used by production.
 * Existing verifier still checks signature, audience, issuer, nonce and Gmail.
 */
import {generateKeyPairSync,sign} from 'node:crypto';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
export const ownerJwk={
  ...publicKey.export({format:'jwk'}),
  kid:'m03-synthetic-owner',
  alg:'RS256',
  use:'sig'
};

const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

export function makeSignedGmailOwnerToken({nonce,clientId,subject,email,emailVerified=true}){
  const now=Math.floor(Date.now()/1000);
  const header=encode({alg:'RS256',kid:ownerJwk.kid,typ:'JWT'});
  const claims=encode({
    iss:'https://accounts.google.com',aud:clientId,sub:subject,
    email,email_verified:emailVerified,nonce,iat:now-5,exp:now+120
  });
  const input=header+'.'+claims;
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
}
