import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {getCookie,setCookie} from 'hono/cookie';
import {acceptOwnerInvite,readOwnerInviteChallenge} from './auth/platform-owner-acceptance.js';

const app=new Hono();
const INVITE_COOKIE='__Host-shererp-owner-invite';
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

async function protect(c,next){
  c.header('Cache-Control','no-store');
  c.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  c.header('Referrer-Policy','no-referrer');
  c.header('X-Content-Type-Options','nosniff');
  const env=c.env??{};
  if(env.OWNER_REDEMPTION_ENABLED!=='true')return c.notFound();
  const {OWNER_AUTH_ORIGIN:ownerOrigin,PLATFORM_AUTH_ORIGIN:adminOrigin,
    PLATFORM_OWNER_CLIENT_ID:client,OWNER_INGRESS:limiter,CONTROL_DB:db}=env;
  if(!isHttpsOrigin(ownerOrigin)||!isHttpsOrigin(adminOrigin)||ownerOrigin===adminOrigin||
     typeof client!=='string'||!GOOGLE_CLIENT.test(client)||
     typeof limiter?.limit!=='function'||typeof db?.prepare!=='function')return unavailable(c);
  const url=new URL(c.req.url);
  if(url.origin!==ownerOrigin||c.req.header('Origin')!==ownerOrigin)return c.json({error:'Origin forbidden'},403);
  if(url.search)return c.json({error:'Query parameters are unsupported'},400);
  if((await limiter.limit({key:'owner-redemption'}))?.success!==true)return c.json({error:'Try again later'},429);
  await next();
}

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

app.post('/api/owner/setup/challenge',protect,limitBody,async c=>{
  const inviteCode=await jsonField(c,'inviteCode');
  if(inviteCode===null)return c.json({error:'Invalid request'},400);
  const nonce=await readOwnerInviteChallenge(c.env,inviteCode);
  if(!nonce)return denied(c);
  setCookie(c,INVITE_COOKIE,inviteCode,{...COOKIE,maxAge:600});
  return c.json({clientId:c.env.PLATFORM_OWNER_CLIENT_ID,nonce});
});

app.post('/api/owner/setup',protect,limitBody,async c=>{
  const credential=await jsonField(c,'credential');
  if(credential===null)return c.json({error:'Invalid request'},400);
  const inviteCode=getCookie(c,INVITE_COOKIE);
  setCookie(c,INVITE_COOKIE,'',{...COOKIE,maxAge:0});
  const owner=await acceptOwnerInvite(c.env,{inviteCode,credential});
  return owner?c.json(owner,201):denied(c);
});

// This entry is separate from the deployed platform and public ERP Workers.
export default app;
