import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {getCookie,setCookie} from 'hono/cookie';
import {buildSourceAppShellData} from '../modules/source-app-shell-reader.js';
import {tokenFingerprint} from './d1-legacy-rpc.js';
import {verifyGoogleLoginIdToken} from './google-id-token.js';

const CHALLENGE_COOKIE='__Host-shererp-google-challenge';
const SESSION_COOKIE='__Host-shererp-google-session';
const CHALLENGE_SECONDS=5*60;
const SESSION_SECONDS=30*60;
const CHALLENGE_WINDOW_SECONDS=60;
const MAX_CHALLENGES_PER_WINDOW=12;
const COOKIE={path:'/',secure:true,httpOnly:true,sameSite:'Strict'};
const AUTHORIZED_SESSION=`WITH authorized AS (
  SELECT u.user_id AS id,u.full_name AS name,u.role_name AS role
  FROM auth_google_sessions s
  JOIN auth_google_links l ON l.issuer=s.issuer AND l.subject=s.subject
    AND l.user_id=s.user_id AND l.revoked_at_ms IS NULL
  JOIN auth_users u ON u.user_id=s.user_id AND u.status='Active' AND u.role_name='Administrator'
    AND u.auth_version=s.user_auth_version AND u.credential_version=s.credential_version
  WHERE s.token_hash=? AND s.revoked_at_ms IS NULL AND s.created_at_ms<=? AND s.expires_at_ms>?
)`;
const newToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),
  byte=>byte.toString(16).padStart(2,'0')).join('');
const newNonce=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
  .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const denied=c=>c.json({success:false,message:'Google sign-in unavailable or invalid'},401);
const success=(c,data)=>c.json({success:true,data});
async function passwordLockKey(phone){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(phone));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

/**
 * Auth-only staging app. The dedicated Worker supplies trusted origin,
 * database and verifier configuration. Public previews do not mount it.
 */
export function createStagingGoogleLoginApp({db,origin,clientId}){
  const app=new Hono();
  app.onError((_error,c)=>c.json({success:false,message:'Google sign-in unavailable'},503));
  app.use('*',async(c,next)=>{
    c.header('Cache-Control','no-store');
    c.header('X-Content-Type-Options','nosniff');
    if(new URL(c.req.url).origin!==origin ||
       (c.req.raw.method==='POST' && c.req.header('Origin')!==origin))
      return c.json({success:false,message:'Origin forbidden'},403);
    await next();
  });

  app.post('/api/auth/google/challenge',async c=>{
    const binding=newToken();
    const nonce=newNonce();
    const bindingHash=await tokenFingerprint(binding);
    const now=Date.now();
    const expires=now+CHALLENGE_SECONDS*1000;
    const [,saved]=await db.batch([
      db.prepare(`DELETE FROM auth_google_challenges WHERE binding_hash IN (
        SELECT c.binding_hash FROM auth_google_challenges c
        WHERE c.expires_at_ms<=?
          AND NOT EXISTS(SELECT 1 FROM auth_google_sessions s WHERE s.binding_hash=c.binding_hash)
        ORDER BY c.expires_at_ms LIMIT 64
      )`).bind(now),
      db.prepare(`INSERT INTO auth_google_challenges(binding_hash,nonce,expires_at_ms)
        SELECT ?,?,? WHERE (
          SELECT count(*) FROM auth_google_challenges WHERE expires_at_ms>?
        )<?`).bind(bindingHash,nonce,expires,expires-CHALLENGE_WINDOW_SECONDS*1000,
          MAX_CHALLENGES_PER_WINDOW),
    ]);
    if(saved?.success!==true)return denied(c);
    if(saved.meta?.changes!==1){
      c.header('Retry-After',String(CHALLENGE_WINDOW_SECONDS));
      return c.json({success:false,message:'Try signing in again in a minute.'},429);
    }
    setCookie(c,CHALLENGE_COOKIE,binding,{...COOKIE,maxAge:CHALLENGE_SECONDS});
    return success(c,{nonce,clientId});
  });

  app.post('/api/auth/google',bodyLimit({
    maxSize:10240,
    onError:c=>c.json({success:false,message:'Request too large'},413),
  }),async c=>{
    if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
      return c.json({success:false,message:'JSON request required'},415);
    let body;
    try{body=await c.req.json();}catch{return denied(c);}
    if(!body || typeof body.credential!=='string' || Object.keys(body).length!==1)
      return denied(c);
    const bindingHash=await tokenFingerprint(getCookie(c,CHALLENGE_COOKIE));
    if(!bindingHash)return denied(c);
    const challenge=await db.prepare(`SELECT nonce FROM auth_google_challenges c
      WHERE c.binding_hash=? AND c.expires_at_ms>?
        AND NOT EXISTS(SELECT 1 FROM auth_google_sessions s WHERE s.binding_hash=c.binding_hash)`)
      .bind(bindingHash,Date.now()).first();
    if(!challenge)return denied(c);
    const identity=await verifyGoogleLoginIdToken({
      token:body.credential,clientId,expectedNonce:challenge.nonce,
    });
    if(!identity)return denied(c);

    const linked=await db.prepare(`SELECT u.phone_key
      FROM auth_google_links l JOIN auth_users u ON u.user_id=l.user_id
      WHERE l.issuer=? AND l.subject=? AND l.revoked_at_ms IS NULL
        AND u.status='Active' AND u.role_name='Administrator'`)
      .bind(identity.issuer,identity.subject).first();
    if(!linked)return denied(c);
    const throttleKey=await passwordLockKey(linked.phone_key);
    const token=newToken();
    const tokenHash=await tokenFingerprint(token);
    const now=Date.now();
    // A single SQL statement binds challenge, approved link and active staff.
    const issued=await db.prepare(`INSERT INTO auth_google_sessions
      (token_hash,binding_hash,issuer,subject,user_id,user_auth_version,
       credential_version,created_at_ms,expires_at_ms)
      SELECT ?,c.binding_hash,l.issuer,l.subject,u.user_id,u.auth_version,u.credential_version,?,?
      FROM auth_google_challenges c
      JOIN auth_google_links l ON l.issuer=? AND l.subject=? AND l.revoked_at_ms IS NULL
      JOIN auth_users u ON u.user_id=l.user_id AND u.status='Active' AND u.role_name='Administrator'
      WHERE c.binding_hash=? AND c.nonce=? AND c.expires_at_ms>? AND u.phone_key=?
        AND NOT EXISTS(SELECT 1 FROM auth_google_sessions s WHERE s.binding_hash=c.binding_hash)
        AND NOT EXISTS(SELECT 1 FROM auth_login_throttle t
          WHERE t.login_hash=? AND t.locked_until_ms>? AND t.reset_at_ms>?)`)
      .bind(tokenHash,now,now+SESSION_SECONDS*1000,identity.issuer,identity.subject,
        bindingHash,challenge.nonce,now,linked.phone_key,throttleKey,now,now).run();
    if(issued.meta?.changes!==1)return denied(c);
    setCookie(c,CHALLENGE_COOKIE,'',{...COOKIE,maxAge:0});
    setCookie(c,SESSION_COOKIE,token,{...COOKIE,maxAge:SESSION_SECONDS});
    return success(c,{authenticated:true});
  });

  app.get('/api/auth/google/session',async c=>{
    const tokenHash=await tokenFingerprint(getCookie(c,SESSION_COOKIE));
    if(!tokenHash)return denied(c);
    const now=Date.now();
    const user=await db.prepare(`${AUTHORIZED_SESSION} SELECT id,name,role FROM authorized`)
      .bind(tokenHash,now,now).first();
    return user?success(c,{user}):denied(c);
  });

  app.get('/api/auth/google/shell',async c=>{
    const tokenHash=await tokenFingerprint(getCookie(c,SESSION_COOKIE));
    if(!tokenHash)return denied(c);
    const now=Date.now();
    // Authorize the same D1 snapshot that supplies the two shell settings.
    const settings=await db.prepare(`${AUTHORIZED_SESSION}
      SELECT
        COALESCE((SELECT NULLIF(value,'') FROM settings WHERE key='Shop Name'),
                 'Hardware Store ERP') AS shopName,
        COALESCE((SELECT value FROM settings WHERE key='Currency Symbol'),'') AS currencySymbol
      FROM authorized`).bind(tokenHash,now,now).first();
    return settings?c.json(buildSourceAppShellData(settings)):denied(c);
  });

  app.post('/api/auth/google/logout',async c=>{
    const tokenHash=await tokenFingerprint(getCookie(c,SESSION_COOKIE));
    if(tokenHash){
      const now=Date.now();
      await db.prepare(`UPDATE auth_google_sessions SET revoked_at_ms=?
        WHERE token_hash=? AND revoked_at_ms IS NULL AND created_at_ms<=?`)
        .bind(now,tokenHash,now).run();
    }
    setCookie(c,SESSION_COOKIE,'',{...COOKIE,maxAge:0});
    return success(c,'logged out');
  });
  return app;
}
