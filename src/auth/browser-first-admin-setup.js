import {normalizeGoogleGmail,verifyGoogleLoginIdToken} from './google-id-token.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './session-token.js';
import {matchingStep} from './platform-superadmin-session.js';
import {commitFirstAdminEnrollment} from './browser-first-admin-enrollment.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const ACTIVE=`token_hash=? AND expires_at_ms>${NOW}
  AND NOT EXISTS(SELECT 1 FROM platform_first_superadmin)`;
const HEX_KEY=/^[0-9a-f]{64}$/;
const bytes=hex=>Uint8Array.from(hex.match(/../g),pair=>parseInt(pair,16));
const hex=raw=>Array.from(raw,byte=>byte.toString(16).padStart(2,'0')).join('');
const encode=raw=>btoa(String.fromCharCode(...raw));
const decode=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
const aad=new TextEncoder().encode('shererp:platform:first-factor:v1');
const key=value=>crypto.subtle.importKey('raw',bytes(value),'AES-GCM',false,['encrypt','decrypt']);

export function browserSetupConfigured(env){
  return HEX_KEY.test(env.PLATFORM_BOOTSTRAP_CODE??'') &&
    HEX_KEY.test(env.PLATFORM_FACTOR_ENCRYPTION_KEY??'') &&
    env.PLATFORM_BOOTSTRAP_CODE!==env.PLATFORM_FACTOR_ENCRYPTION_KEY;
}

export async function beginBrowserSetup(env,{email,setupCode,previousToken}){
  const normalized=normalizeGoogleGmail(email);
  if(!browserSetupConfigured(env)||!normalized||!HEX_KEY.test(setupCode))return null;
  const allowed=await crypto.subtle.importKey('raw',bytes(env.PLATFORM_BOOTSTRAP_CODE),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const supplied=await crypto.subtle.importKey('raw',bytes(setupCode),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  if(!await crypto.subtle.verify('HMAC',allowed,await crypto.subtle.sign('HMAC',supplied,aad),aad))return null;
  const token=createOpaqueSessionToken();
  const hash=await hashOpaqueSessionToken(token);
  const nonce=encode(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const db=env.CONTROL_DB;
  const previousHash=await hashOpaqueSessionToken(previousToken);
  const [,result]=await db.batch([
    db.prepare(`DELETE FROM platform_browser_setup WHERE expires_at_ms<=${NOW} OR token_hash=?`).bind(previousHash),
    db.prepare(`INSERT INTO platform_browser_setup (token_hash,nonce,email,expires_at_ms)
      SELECT ?,?,?,${NOW}+600000 WHERE NOT EXISTS(SELECT 1 FROM platform_first_superadmin)
      AND (SELECT count(*) FROM platform_browser_setup)<8`).bind(hash,nonce,normalized),
  ]);
  return result.meta.changes===1?{token,nonce}:null;
}

function base32(raw){
  let buffer=0,bits=0,result='';
  for(const byte of raw){
    buffer=(buffer<<8)|byte;
    bits+=8;
    while(bits>=5){
      bits-=5;
      result+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(buffer>>>bits)&31];
    }
  }
  return result;
}

export async function verifyBrowserSetupGoogle(env,token,credential){
  const hash=await hashOpaqueSessionToken(token);
  if(!hash||!browserSetupConfigured(env))return null;
  const db=env.CONTROL_DB;
  const pending=await db.prepare(`SELECT nonce,email FROM platform_browser_setup
    WHERE ${ACTIVE} AND subject IS NULL`).bind(hash).first();
  if(!pending)return null;
  const identity=await verifyGoogleLoginIdToken({
    token:credential,clientId:env.PLATFORM_CLIENT_ID,expectedNonce:pending.nonce,requireGmail:true,
  });
  if(identity?.email!==pending.email)return null;
  const secret=crypto.getRandomValues(new Uint8Array(20));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},
    await key(env.PLATFORM_FACTOR_ENCRYPTION_KEY),secret);
  const ciphertext=encode(iv)+'.'+encode(new Uint8Array(encrypted));
  const result=await db.prepare(`UPDATE platform_browser_setup SET subject=?,encrypted_secret=?
    WHERE ${ACTIVE} AND subject IS NULL`).bind(identity.subject,ciphertext,hash).run();
  return result.meta.changes===1?{manualKey:base32(secret),email:pending.email}:null;
}

async function decryptFactor(env,ciphertext){
  const [iv,data]=ciphertext.split('.');
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv),additionalData:aad},
    await key(env.PLATFORM_FACTOR_ENCRYPTION_KEY),decode(data));
  return hex(new Uint8Array(raw));
}

export async function finishBrowserSetup(env,token,code){
  const hash=await hashOpaqueSessionToken(token);
  if(!hash||!browserSetupConfigured(env)||!/^\d{6}$/.test(code))return false;
  const db=env.CONTROL_DB;
  const row=await db.prepare(`UPDATE platform_browser_setup SET attempts=attempts+1
    WHERE ${ACTIVE} AND attempts<5 AND subject IS NOT NULL
    RETURNING subject,nonce,encrypted_secret,CAST(${NOW}/30000 AS INTEGER) AS step`).bind(hash).first();
  if(!row)return false;
  const secret=await decryptFactor(env,row.encrypted_secret);
  const otpStep=await matchingStep(secret,code,row.step);
  if(otpStep===null)return false;
  const sessionToken=createOpaqueSessionToken();
  const enrolled=await commitFirstAdminEnrollment(db,{
    subject:row.subject,enrollmentHash:hash,nonce:row.nonce,
    encryptedSecret:row.encrypted_secret,requirePending:true,otpStep,
    sessionHash:await hashOpaqueSessionToken(sessionToken),
  });
  return enrolled?sessionToken:null;
}

export async function readBrowserAdminFactor(env){
  if(!HEX_KEY.test(env.PLATFORM_FACTOR_ENCRYPTION_KEY??''))return null;
  const row=await env.CONTROL_DB.prepare(`SELECT encrypted_secret FROM platform_browser_first_factor
    JOIN platform_admin_auth USING(singleton) WHERE enabled=1 AND factor_version=1`).first();
  return row?decryptFactor(env,row.encrypted_secret):null;
}
