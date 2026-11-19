import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {getCookie,setCookie} from 'hono/cookie';
import {bootstrapPlatformSuperAdmin,readPlatformSetupNonce} from './auth/platform-superadmin-bootstrap.js';
import {
  issuePlatformSuperAdminSession,revokePlatformSuperAdminSession,signOutPlatformBrowser,
  validatePlatformSuperAdminSession,
} from './auth/platform-superadmin-session.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './auth/session-token.js';
import {reservePlatformShop} from './auth/platform-shop-reservations.js';
import {verifyPlatformShopBinding} from './auth/platform-shop-binding.js';

const SETUP_COOKIE='__Host-shererp-platform-setup';
const CHALLENGE_COOKIE='__Host-shererp-platform-challenge';
const SESSION_COOKIE='__Host-shererp-platform-session';
const COOKIE={path:'/',secure:true,httpOnly:true,sameSite:'Strict'};
const CHALLENGE_SECONDS=120;
const MAX_CHALLENGES=8;
const WINDOW_MS=60_000;
const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const GOOGLE_CLIENT=/^[a-zA-Z0-9-]{1,218}\.apps\.googleusercontent\.com$/;
const app=new Hono();
const denied=c=>c.json({error:'Authentication denied'},401);
const unavailable=c=>c.json({error:'Platform authentication unavailable'},503);
const limited=c=>c.json({error:'Try again in a minute'},429);

app.onError((_error,c)=>unavailable(c));
app.use('*',async(c,next)=>{
  c.header('Cache-Control','no-store');
  c.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  c.header('Referrer-Policy','no-referrer');
  c.header('X-Content-Type-Options','nosniff');
  const url=new URL(c.req.url);
  const requestOrigin=c.req.header('Origin');
  const {PLATFORM_AUTH_ORIGIN:origin,PLATFORM_AUTH_SCOPE:scope,PLATFORM_CLIENT_ID:clientId,
    PLATFORM_INGRESS:limiter,CONTROL_DB:db}=c.env??{};
  if(url.protocol!=='https:' || url.origin!==origin ||
     ((c.req.method==='POST'||requestOrigin!==undefined) && requestOrigin!==origin))
    return c.json({error:'Origin forbidden'},403);
  if(url.search)return c.json({error:'Query parameters are unsupported'},400);
  if(scope!=='private-platform-auth' || typeof clientId!=='string' || !GOOGLE_CLIENT.test(clientId) ||
     typeof limiter?.limit!=='function' || typeof db?.prepare!=='function' ||
     typeof db?.batch!=='function')return unavailable(c);
  await next();
});

const pageCsp=[
  "default-src 'none'","base-uri 'none'","frame-ancestors 'none'","form-action 'none'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' https://accounts.google.com/gsi/style",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "frame-src https://accounts.google.com/gsi/",
].join('; ');

for(const [route,asset,type] of [
  ['/','/index.html','text/html; charset=utf-8'],
  ['/platform-auth.css','/platform-auth.css','text/css; charset=utf-8'],
  ['/platform-auth.js','/platform-auth.js','text/javascript; charset=utf-8'],
]){
  app.get(route,async c=>{
    let body=c.env.platformPageFiles?.[asset];
    if(typeof body!=='string'){
      const assets=c.env.ASSETS;
      if(typeof assets?.fetch!=='function')return unavailable(c);
      const reply=await assets.fetch(new Request(new URL(asset,c.req.url)));
      if(reply.status!==200)return unavailable(c);
      body=reply.body;
    }
    if(route==='/'){
      c.header('Content-Security-Policy',pageCsp);
      c.header('Cross-Origin-Opener-Policy','same-origin-allow-popups');
      c.header('Referrer-Policy','strict-origin-when-cross-origin');
    }
    return c.body(body,200,{'Content-Type':type});
  });
}

async function limitIngress(c,next){
  const result=await c.env.PLATFORM_INGRESS.limit({key:'platform-browser-auth'});
  if(result?.success!==true)return limited(c);
  await next();
}

const limitBody=bodyLimit({maxSize:10240,onError:c=>c.json({error:'Request too large'},413)});
async function expectedJson(c,fields){
  if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return null;
  let body;
  try{body=await c.req.json();}catch{return null;}
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==fields.length ||
     !fields.every(field=>typeof body[field]==='string'))return null;
  return body;
}

app.post('/api/platform/setup/challenge',limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['setupToken']);
  if(!body)return denied(c);
  const nonce=await readPlatformSetupNonce(c.env.CONTROL_DB,body.setupToken);
  if(!nonce)return denied(c);
  setCookie(c,SETUP_COOKIE,body.setupToken,{...COOKIE,maxAge:600});
  return c.json({clientId:c.env.PLATFORM_CLIENT_ID,nonce});
});

app.post('/api/platform/setup',limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['credential']);
  if(!body)return denied(c);
  const enrolled=await bootstrapPlatformSuperAdmin({
    controlDb:c.env.CONTROL_DB,clientId:c.env.PLATFORM_CLIENT_ID,
    setupToken:getCookie(c,SETUP_COOKIE),credential:body.credential,
    onRejected:reason=>console.warn('platform_enrollment_denied',reason),
  });
  setCookie(c,SETUP_COOKIE,'',{...COOKIE,maxAge:0});
  return enrolled?c.json({enrolled:true}):denied(c);
});

app.post('/api/platform/auth/challenge',limitIngress,async c=>{
  const browserToken=createOpaqueSessionToken();
  const bindingHash=await hashOpaqueSessionToken(browserToken);
  const nonce=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const lifetime=CHALLENGE_SECONDS*1000;
  const result=await c.env.CONTROL_DB.prepare(`INSERT INTO platform_login_challenges
    (binding_hash,nonce,expires_at_ms)
    SELECT ?,?,${NOW}+? WHERE (
      SELECT count(*) FROM platform_login_challenges WHERE expires_at_ms>${NOW}+?-?
    )<?`).bind(bindingHash,nonce,lifetime,lifetime,WINDOW_MS,MAX_CHALLENGES).run();
  if(result.success!==true)return unavailable(c);
  if(result.meta?.changes!==1)return limited(c);
  setCookie(c,CHALLENGE_COOKIE,browserToken,{...COOKIE,maxAge:CHALLENGE_SECONDS});
  return c.json({clientId:c.env.PLATFORM_CLIENT_ID,nonce});
});

app.post('/api/platform/auth/login',limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['credential','code']);
  if(!body)return denied(c);
  const {CONTROL_DB:db,PLATFORM_CLIENT_ID:clientId,PLATFORM_TOTP_SECRET:totpSecret,
    PLATFORM_FACTOR_VERSION:rawVersion}=c.env;
  const session=await issuePlatformSuperAdminSession({
    controlDb:db,clientId,totpSecret,factorVersion:Number(rawVersion),
    browserToken:getCookie(c,CHALLENGE_COOKIE),credential:body.credential,code:body.code,
  });
  setCookie(c,CHALLENGE_COOKIE,'',{...COOKIE,maxAge:0});
  if(!session)return denied(c);
  await revokePlatformSuperAdminSession(db,getCookie(c,SESSION_COOKIE));
  const maxAge=Math.max(0,Math.floor((session.expiresAtMs-Date.now())/1000));
  setCookie(c,SESSION_COOKIE,session.token,{...COOKIE,maxAge});
  return c.json({role:'PlatformSuperAdmin'});
});

app.get('/api/platform/auth/session',async c=>{
  const session=await validatePlatformSuperAdminSession(c.env.CONTROL_DB,getCookie(c,SESSION_COOKIE));
  return session?c.json({role:session.role}):denied(c);
});

app.post('/api/platform/auth/logout',async c=>{
  await signOutPlatformBrowser(c.env.CONTROL_DB,{
    sessionToken:getCookie(c,SESSION_COOKIE),browserToken:getCookie(c,CHALLENGE_COOKIE),
  });
  setCookie(c,SESSION_COOKIE,'',{...COOKIE,maxAge:0});
  setCookie(c,CHALLENGE_COOKIE,'',{...COOKIE,maxAge:0});
  return c.json({signedOut:true});
});

app.post('/api/platform/shops',async(c,next)=>{
  if(c.env.PLATFORM_SHOP_RESERVATION_ENABLED!=='true')return c.notFound();
  await next();
},limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['operationId','displayName']);
  if(!body)return c.json({error:'Invalid business reservation'},400);
  const result=await reservePlatformShop(c.env.CONTROL_DB,{
    ...body,sessionToken:getCookie(c,SESSION_COOKIE),
  });
  if(result.status==='invalid')return c.json({error:'Invalid business reservation'},400);
  if(result.status==='denied')return denied(c);
  if(result.status==='conflict')return c.json({error:'Reservation request conflicts'},409);
  return c.json(result.reservation,result.status==='created'?201:200);
});

app.post('/api/platform/shops/verify-binding',async(c,next)=>{
  if(c.env.PLATFORM_SHOP_BINDING_ENABLED!=='true')return c.notFound();
  await next();
},limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['shopId']);
  if(!body)return c.json({error:'Invalid business identity'},400);
  const status=await verifyPlatformShopBinding(c.env,{shopId:body.shopId,sessionToken:getCookie(c,SESSION_COOKIE)});
  if(status==='invalid')return c.json({error:'Invalid business identity'},400);
  if(status==='unavailable')return unavailable(c);
  if(status==='denied')return denied(c);
  if(status==='not_found')return c.notFound();
  if(status==='mismatch')return c.json({error:'Shop binding verification failed'},409);
  if(status!=='created'&&status!=='replayed')return unavailable(c);
  return c.json({shopId:body.shopId,status:'binding-verified'},status==='created'?201:200);
});

// Dedicated private entry point. The default public Worker does not import it.
export default app;
