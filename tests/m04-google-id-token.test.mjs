import assert from 'node:assert/strict';
import {generateKeyPairSync, randomBytes, sign} from 'node:crypto';
import {test} from 'node:test';
import {verifyGoogleLoginIdToken} from '../src/auth/google-id-token.js';

const clientId='123456-example.apps.googleusercontent.com';
const subject='123456789012345678901';
const nonce=randomBytes(32).toString('base64url');
const kid='test-google-key';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'};
const base64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const makeToken=(claimOverrides={}, headerOverrides={},key=privateKey)=>{
  const now=Math.floor(Date.now()/1000);
  const header={alg:'RS256',kid,typ:'JWT',...headerOverrides};
  const claims={
    iss:'https://accounts.google.com',aud:clientId,sub:subject,iat:now-10,exp:now+120,
    nonce,email_verified:true,...claimOverrides,
  };
  const signingInput=`${base64(header)}.${base64(claims)}`;
  return `${signingInput}.${sign('RSA-SHA256',Buffer.from(signingInput),key).toString('base64url')}`;
};
const verify=(token,expectedNonce=nonce)=>verifyGoogleLoginIdToken({token,clientId,expectedNonce});
function stubGoogleKeys(t){
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://www.googleapis.com/oauth2/v3/certs');
    assert.equal(options.redirect,'error');
    return Response.json({keys:[jwk]});
  });
}

test('trusted Google signature resolves only a stable subject for the issued nonce',async(t)=>{
  stubGoogleKeys(t);
  assert.deepEqual(await verify(makeToken()),{issuer:'https://accounts.google.com',subject});
  assert.deepEqual(await verify(makeToken({iss:'accounts.google.com'})),{
    issuer:'https://accounts.google.com',subject,
  });
});

test('Google verification fails closed on invalid session-bound claims',async(t)=>{
  stubGoogleKeys(t);
  const now=Math.floor(Date.now()/1000);
  for(const invalid of [
    {iss:'https://accounts.google.com.example.test'},
    {aud:'other-client'},{aud:[clientId,'other-client']},{azp:'other-client'},
    {exp:now-1},{exp:undefined},{iat:now+1_000},{iat:undefined},
    {nonce:'wrong'},{nonce:undefined},{email_verified:false},{sub:undefined},
  ]){
    assert.equal(await verify(makeToken(invalid)),null);
  }
  assert.equal(await verify(makeToken(),randomBytes(32).toString('base64url')),null);
});

test('Google verification rejects a forged signature, unknown key and unavailable Google keys',async(t)=>{
  const keys=t.mock.method(globalThis,'fetch',async()=>Response.json({keys:[jwk]}));
  const forged=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
  assert.equal(await verify(makeToken({}, {}, forged)),null);
  assert.equal(await verify(makeToken({}, {kid:'unknown'})),null);
  assert.equal(await verify(makeToken({}, {alg:'HS256'})),null);
  keys.mock.mockImplementation(async()=>new Response(null,{status:503}));
  assert.equal(await verify(makeToken()),null);
});
