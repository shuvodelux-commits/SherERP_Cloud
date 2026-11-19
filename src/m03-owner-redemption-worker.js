import {beginFirstOwnerGmailLogin,loginFirstOwnerWithGmail} from './auth/platform-owner-gmail-login.js';
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {getCookie,setCookie} from 'hono/cookie';
import {acceptOwnerInvite,readOwnerInviteChallenge} from './auth/platform-owner-acceptance.js';

import {beginOwnerGoogleLogin,loginOwnerWithGoogle,signOutOwnerBrowser,validateOwnerSession} from './auth/platform-owner-sessions.js';

const app=new Hono();
const INVITE_COOKIE='__Host-shererp-owner-invite';
const LOGIN_COOKIE='__Host-shererp-owner-login';
const SESSION_COOKIE='__Host-shererp-owner-session';
const COOKIE={path:'/',secure:true,httpOnly:true,sameSite:'Strict'};
const GOOGLE_CLIENT=/^[a-zA-Z0-9-]{1,218}\.apps\.googleusercontent\.com$/;
const denied=c=>c.json({error:'Owner setup denied'},401);
const unavailable=c=>c.json({error:'Owner setup unavailable'},503);

function isHttpsOrigin(value){
  if(typeof value!=='string')return false;
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&url.origin===value;
  }catch{
    return false;
  }
}

app.onError((_error,c)=>unavailable(c));

const protect=(flag,rateLimit=true)=>async(c,next)=>{
  c.header('Cache-Control','no-store');
  c.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  c.header('Referrer-Policy','no-referrer');
  c.header('X-Content-Type-Options','nosniff');
  const env=c.env??{};
  if(env[flag]!=='true'||(flag==='OWNER_REDEMPTION_ENABLED'&&env.OWNER_GMAIL_SIGNUP_ENABLED==='true'))return c.notFound();
  const {OWNER_AUTH_ORIGIN:ownerOrigin,PLATFORM_AUTH_ORIGIN:adminOrigin,
    PLATFORM_OWNER_CLIENT_ID:client,OWNER_INGRESS:limiter,CONTROL_DB:db}=env;
  if(!isHttpsOrigin(ownerOrigin)||!isHttpsOrigin(adminOrigin)||ownerOrigin===adminOrigin||
     typeof client!=='string'||!GOOGLE_CLIENT.test(client)||
     typeof limiter?.limit!=='function'||typeof db?.prepare!=='function')return unavailable(c);
  const url=new URL(c.req.url);
  const requestOrigin=c.req.header('Origin');
  if(url.origin!==ownerOrigin||((c.req.method==='POST'||requestOrigin!==undefined)&&requestOrigin!==ownerOrigin))return c.json({error:'Origin forbidden'},403);
  if(url.search)return c.json({error:'Query parameters are unsupported'},400);
  if(rateLimit&&(await limiter.limit({key:c.req.path}))?.success!==true)return c.json({error:'Try again later'},429);
  await next();
};

const limitBody=bodyLimit({maxSize:10240,onError:c=>c.json({error:'Request too large'},413)});
async function jsonField(c,key){
  if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return null;
  try{
    const body=await c.req.json();
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||
       !Object.hasOwn(body,key)||typeof body[key]!=='string')return null;
    return body[key];
  }catch{
    return null;
  }
}

app.post('/api/owner/setup/challenge',protect('OWNER_REDEMPTION_ENABLED'),limitBody,async c=>{
  const inviteCode=await jsonField(c,'inviteCode');
  if(inviteCode===null)return c.json({error:'Invalid request'},400);
  const nonce=await readOwnerInviteChallenge(c.env,inviteCode);
  if(!nonce)return denied(c);
  setCookie(c,INVITE_COOKIE,inviteCode,{...COOKIE,maxAge:600});
  return c.json({clientId:c.env.PLATFORM_OWNER_CLIENT_ID,nonce});
});

app.post('/api/owner/setup',protect('OWNER_REDEMPTION_ENABLED'),limitBody,async c=>{
  const credential=await jsonField(c,'credential');
  if(credential===null)return c.json({error:'Invalid request'},400);
  const inviteCode=getCookie(c,INVITE_COOKIE);
  setCookie(c,INVITE_COOKIE,'',{...COOKIE,maxAge:0});
  const owner=await acceptOwnerInvite(c.env,{inviteCode,credential});
  return owner?c.json(owner,201):denied(c);
});

const protectLogin=protect('OWNER_LOGIN_ENABLED');

app.post('/api/owner/auth/challenge',protectLogin,async c=>{
  const challenge=await beginOwnerGoogleLogin(c.env)??
    (c.env.OWNER_GMAIL_SIGNUP_ENABLED==='true'?await beginFirstOwnerGmailLogin(c.env):null);
  if(!challenge)return denied(c);
  setCookie(c,LOGIN_COOKIE,challenge.browserToken,{...COOKIE,maxAge:120});
  return c.json({clientId:c.env.PLATFORM_OWNER_CLIENT_ID,nonce:challenge.nonce});
});

app.post('/api/owner/auth/login',protectLogin,limitBody,async c=>{
  const credential=await jsonField(c,'credential');
  if(credential===null)return c.json({error:'Invalid request'},400);
  const input={credential,browserToken:getCookie(c,LOGIN_COOKIE)};
  const token=await loginOwnerWithGoogle(c.env,input)??
    (c.env.OWNER_GMAIL_SIGNUP_ENABLED==='true'?await loginFirstOwnerWithGmail(c.env,input):null);
  if(!token)return denied(c);
  setCookie(c,LOGIN_COOKIE,'',{...COOKIE,maxAge:0});
  setCookie(c,SESSION_COOKIE,token,{...COOKIE,maxAge:31_536_000});
  return c.json({role:'Owner'});
});

app.get('/api/owner/auth/session',protectLogin,async c=>{
  const session=await validateOwnerSession(c.env,getCookie(c,SESSION_COOKIE),{
    dashboard:c.env.OWNER_DASHBOARD_BOOTSTRAP_ENABLED==='true',
  });
  return session?c.json(session):denied(c);
});

app.post('/api/owner/auth/logout',protectLogin,async c=>{
  const signedOut=await signOutOwnerBrowser(c.env,{
    sessionToken:getCookie(c,SESSION_COOKIE),browserToken:getCookie(c,LOGIN_COOKIE),
  });
  if(!signedOut)return unavailable(c);
  setCookie(c,LOGIN_COOKIE,'',{...COOKIE,maxAge:0});
  setCookie(c,SESSION_COOKIE,'',{...COOKIE,maxAge:0});
  return c.json({signedOut:true});
});

const pageCsp=[
  "default-src 'none'","base-uri 'none'","frame-ancestors 'none'","form-action 'none'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' https://accounts.google.com/gsi/style",
  "connect-src 'self' https://accounts.google.com/gsi/","frame-src https://accounts.google.com/gsi/",
].join('; ');

for(const [route,path,type] of [
  ['/','/index.html','text/html; charset=utf-8'],
  ['/owner-auth.css','/owner-auth.css','text/css; charset=utf-8'],
  ['/owner-auth.js','/owner-auth.js','text/javascript; charset=utf-8'],
]){
  app.get(route,protect('OWNER_LOGIN_ENABLED',false),async c=>{
    const assets=c.env.ASSETS;
    if(typeof assets?.fetch!=='function')return unavailable(c);
    const reply=await assets.fetch(new Request(new URL(path,c.req.url)));
    if(reply.status!==200)return unavailable(c);
    if(route!=='/')return c.body(reply.body,200,{'Content-Type':type});
    c.header('Content-Security-Policy',pageCsp);
    c.header('Cross-Origin-Opener-Policy','same-origin-allow-popups');
    c.header('Referrer-Policy','strict-origin-when-cross-origin');
    const html=await reply.text();
    const marker=c.env.OWNER_GMAIL_SIGNUP_ENABLED==='true'?'data-gmail-signin="enabled"':
      c.env.OWNER_REDEMPTION_ENABLED==='true'?'data-redemption="enabled"':'';
    const content=marker?html.replace('<body>','<body '+marker+'>'):html;
    return c.body(content,200,{'Content-Type':type});
  });
}

// This entry is separate from the deployed platform and public ERP Workers.
export default app;
