import qr from 'qrcode/lib/browser.js';
import {beginBrowserSetup,browserSetupConfigured,finishBrowserSetup,
  readBrowserAdminFactor,verifyBrowserSetupGoogle} from './auth/browser-first-admin-setup.js';
import {disablePlatformShopOwner} from './auth/platform-owner-write-session.js';
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {getCookie,setCookie} from 'hono/cookie';
import {bootstrapPlatformSuperAdmin,readPlatformSetupNonce} from './auth/platform-superadmin-bootstrap.js';
import {
  issuePlatformSuperAdminSession,revokePlatformSuperAdminSession,signOutPlatformBrowser,
  validatePlatformSuperAdminSession,
} from './auth/platform-superadmin-session.js';
import {createOpaqueSessionToken,hashOpaqueSessionToken} from './auth/session-token.js';
import {PLATFORM_ADMIN_TRUSTED_SESSION_SECONDS} from './auth/platform-admin-trusted-session.js';
import {reservePlatformShop} from './auth/platform-shop-reservations.js';
import {pilotShopConfiguration,verifyPlatformShopBinding} from './auth/platform-shop-binding.js';
import {issuePlatformOwnerInvitation} from './auth/platform-owner-invitations.js';

import {listLocalProvisioning,readLocalProvisioning,resumeLocalProvisioning,startLocalProvisioning} from './auth/port-p4-local-provisioning.js';
import {hostedShopServiceEnabled,hostedShopOperation,readHostedShopSetup,listHostedShopSetups}
  from './auth/m03-hosted-shop-service-bridge.js';
import {approvePlatformOwnerGmail} from './auth/platform-owner-gmail-approvals.js';
import {handleLocalSupportHttpRequest} from './modules/m03-local-support-http-contract.js';
import {hostedSupportRequest} from './auth/m03-hosted-support.js';
import {activeAdminSupportVisit,readSupportErpData,SUPPORT_ERP_PREFIX}
  from './auth/m03-hosted-support-erp.js';

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
  "frame-src https://accounts.google.com/gsi/","img-src data:",
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

const WIZARD_COOKIE='__Host-shererp-platform-wizard';
const wizardEnabled=env=>env.PLATFORM_BROWSER_SETUP==='true';

app.get('/api/platform/wizard',limitIngress,async c=>{
  if(!wizardEnabled(c.env)||!browserSetupConfigured(c.env))return c.notFound();
  const enrolled=await c.env.CONTROL_DB.prepare('SELECT 1 FROM platform_first_superadmin').first();
  return c.json({setup:!enrolled});
});
app.post('/api/platform/wizard/start',limitIngress,limitBody,async c=>{
  if(!wizardEnabled(c.env))return c.notFound();
  const body=await expectedJson(c,['email','setupCode']);
  const started=body&&await beginBrowserSetup(c.env,{...body,previousToken:getCookie(c,WIZARD_COOKIE)});
  if(!started)return denied(c);
  setCookie(c,WIZARD_COOKIE,started.token,{...COOKIE,maxAge:600});
  return c.json({clientId:c.env.PLATFORM_CLIENT_ID,nonce:started.nonce});
});
app.post('/api/platform/wizard/google',limitIngress,limitBody,async c=>{
  if(!wizardEnabled(c.env))return c.notFound();
  const body=await expectedJson(c,['credential']);
  const verified=body&&await verifyBrowserSetupGoogle(c.env,getCookie(c,WIZARD_COOKIE),body.credential);
  if(!verified)return denied(c);
  const label=encodeURIComponent('SherERP:'+verified.email);
  const uri=`otpauth://totp/${label}?secret=${verified.manualKey}&issuer=SherERP&algorithm=SHA1&digits=6&period=30`;
  const svg=await qr.toString(uri,{width:240,margin:4});
  return c.json({manualKey:verified.manualKey,qr:'data:image/svg+xml;base64,'+btoa(svg)});
});
app.post('/api/platform/wizard/finish',limitIngress,limitBody,async c=>{
  if(!wizardEnabled(c.env))return c.notFound();
  const body=await expectedJson(c,['code']);
  const token=body&&await finishBrowserSetup(c.env,getCookie(c,WIZARD_COOKIE),body.code);
  if(!token)return denied(c);
  setCookie(c,WIZARD_COOKIE,'',{...COOKIE,maxAge:0});
  setCookie(c,SESSION_COOKIE,token,{...COOKIE,maxAge:PLATFORM_ADMIN_TRUSTED_SESSION_SECONDS});
  return signedIn(c);
});

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

function hostedDirectoryEnabled(env){
  return env.PLATFORM_SHOP_DIRECTORY_ENABLED==='true'&&
    (env.PLATFORM_HOSTED_PILOT_ENABLED!=='true'||localProvisioningEnabled(env));
}

function localProvisioningEnabled(env){
  return env.PLATFORM_SHOP_RESERVATION_ENABLED==='true' &&
    env.PLATFORM_LOCAL_PROVISIONING_ENABLED==='true' &&
    Array.isArray(env.PLATFORM_LOCAL_SHOP_INVENTORY) &&
    env.PLATFORM_LOCAL_SHOP_INVENTORY.length>0 &&
    env.PLATFORM_LOCAL_SHOP_INVENTORY.every(item=>typeof env[item.binding]?.prepare==='function');
}

/**
 * NONDEPLOYABLE Support Mode bridge. Unlike Wrangler JSON env flags, an
 * in-process function and the exact physical Shop D1 object identity are
 * mandatory. No string or serialized config can enable the private routes.
 * Security/deployment approval is required before a real hosted adapter.
 */
function localSupportEnvironment(env){
  if(!localProvisioningEnabled(env))return null;
  const gate=env.PLATFORM_SUPPORT_LOCAL_GATE;
  if(gate?.testOnly!==true || typeof gate.resolveShops!=='function' ||
     gate.supportOrigin!==env.PLATFORM_AUTH_ORIGIN ||
     typeof env.CONTROL_DB?.prepare!=='function')return null;
  let scopes;
  try{scopes=gate.resolveShops(env);}catch{return null;}
  if(!Array.isArray(scopes)||scopes.length<1||scopes.length>10)return null;
  const inventory=env.PLATFORM_LOCAL_SHOP_INVENTORY;
  const seen=new Set();
  for(const scope of scopes){
    if(!scope||typeof scope.shopId!=='string'||typeof scope.databaseId!=='string'||
       typeof scope.databaseMarker!=='string'||typeof scope.binding!=='string'||
       seen.has(scope.shopId))return null;
    seen.add(scope.shopId);
    const matches=inventory.filter(item=>item.binding===scope.binding&&item.id===scope.databaseId);
    if(matches.length!==1||env[scope.binding]!==scope.shopDb||
       typeof scope.shopDb?.prepare!=='function')return null;
  }
  return {
    CONTROL_DB:env.CONTROL_DB,SUPPORT_TEST_MODE_ENABLED:true,
    SUPPORT_TEST_ORIGIN:env.PLATFORM_AUTH_ORIGIN,SUPPORT_TEST_SHOPS:scopes,
  };
}

function signedIn(c){
  const gmailMode=c.env.PLATFORM_OWNER_GMAIL_APPROVAL_ENABLED==='true';
  const gmailShop=gmailMode?pilotShopConfiguration(c.env):null;
  const invitationShop=!gmailMode&&c.env.PLATFORM_OWNER_INVITATION_ENABLED==='true'?pilotShopConfiguration(c.env):null;
  return c.json({
    role:'PlatformSuperAdmin',
    ...(localProvisioningEnabled(c.env)
      ?{localProvisioningEnabled:true}:{}),
    ...(hostedShopServiceEnabled(c.env)
      ?{hostedProvisioningEnabled:true}:{}),
    ...(localProvisioningEnabled(c.env)||hostedDirectoryEnabled(c.env)||
        hostedShopServiceEnabled(c.env)
      ?{shopDirectoryEnabled:true}:{}),
    ...(localSupportEnvironment(c.env)||c.env.PLATFORM_HOSTED_SUPPORT_READY==='true'
      ?{supportDiagnosticsEnabled:true}:{}),
    ...(c.env.PLATFORM_SHOP_RESERVATION_ENABLED==='true'&&
       (c.env.PLATFORM_HOSTED_PILOT_ENABLED!=='true'||localProvisioningEnabled(c.env))
       ?{shopReservationEnabled:true}:{}),
    ...(invitationShop?{ownerInvitationShopId:invitationShop.shopId}:{}),
    ...(gmailShop?{ownerGmailApprovalShopId:gmailShop.shopId}:{}),
  });
}

app.post('/api/platform/auth/login',limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['credential','code']);
  if(!body)return denied(c);
  const {CONTROL_DB:db,PLATFORM_CLIENT_ID:clientId,PLATFORM_TOTP_SECRET:totpSecret,
    PLATFORM_FACTOR_VERSION:rawVersion}=c.env;
  const browserFactor=wizardEnabled(c.env)?await readBrowserAdminFactor(c.env):null;
  const session=await issuePlatformSuperAdminSession({
    controlDb:db,clientId,totpSecret:wizardEnabled(c.env)?browserFactor:totpSecret,factorVersion:browserFactor?1:Number(rawVersion),
    browserToken:getCookie(c,CHALLENGE_COOKIE),credential:body.credential,code:body.code,
  });
  setCookie(c,CHALLENGE_COOKIE,'',{...COOKIE,maxAge:0});
  if(!session)return denied(c);
  await revokePlatformSuperAdminSession(db,getCookie(c,SESSION_COOKIE));
  const maxAge=Math.max(0,Math.floor((session.expiresAtMs-Date.now())/1000));
  setCookie(c,SESSION_COOKIE,session.token,{...COOKIE,maxAge});
  return signedIn(c);
});

app.get('/api/platform/auth/session',async c=>{
  const session=await validatePlatformSuperAdminSession(c.env.CONTROL_DB,getCookie(c,SESSION_COOKIE));
  return session?signedIn(c):denied(c);
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
  if(c.env.PLATFORM_HOSTED_PILOT_ENABLED==='true'&&!localProvisioningEnabled(c.env))
    return unavailable(c);
  if(localProvisioningEnabled(c.env)){
    const body=await expectedJson(c,['operationId','displayName','ownerEmail']);
    if(!body)return c.json({error:'Enter a business name and Owner Gmail'},400);
    const prebound=c.env.PLATFORM_HOSTED_PILOT_ENABLED==='true'
      ?pilotShopConfiguration(c.env):null;
    return localProvisioningResponse(c,await startLocalProvisioning(
      c.env.CONTROL_DB,getCookie(c,SESSION_COOKIE),body,prebound));
  }
  if(hostedShopServiceEnabled(c.env)){
    const body=await expectedJson(c,['operationId','displayName','ownerEmail']);
    if(!body)return c.json({error:'Enter a business name and Owner Gmail'},400);
    return localProvisioningResponse(c,await hostedShopOperation(
      c.env,getCookie(c,SESSION_COOKIE),'reserve',body));
  }
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

function localProvisioningResponse(c,result){
  if(result.body)return c.json(result.body,result.code);
  if(result.code===401)return denied(c);
  if(result.code===409)return c.json({error:'Business setup request conflicts'},409);
  if(result.code===400)return c.json({error:'Check the business name, Gmail, or setup request'},400);
  return unavailable(c);
}

async function localProvisioningGate(c,next){
  if(!localProvisioningEnabled(c.env)&&!hostedShopServiceEnabled(c.env)){
    return c.notFound();
  }
  await next();
}

async function directoryGate(c,next){
  if(!localProvisioningEnabled(c.env)&&!hostedDirectoryEnabled(c.env)&&
     !hostedShopServiceEnabled(c.env))return c.notFound();
  await next();
}

app.get('/api/platform/shops/list',directoryGate,async c=>
  localProvisioningResponse(c,hostedShopServiceEnabled(c.env)
    ?await listHostedShopSetups(c.env,getCookie(c,SESSION_COOKIE))
    :await listLocalProvisioning(c.env.CONTROL_DB,getCookie(c,SESSION_COOKIE))));
app.get('/api/platform/shops/setup/:operationId',localProvisioningGate,async c=>
  localProvisioningResponse(c,hostedShopServiceEnabled(c.env)
    ?await readHostedShopSetup(c.env,getCookie(c,SESSION_COOKIE),c.req.param('operationId'))
    :await readLocalProvisioning(c.env.CONTROL_DB,getCookie(c,SESSION_COOKIE),
      c.req.param('operationId'))));
app.post('/api/platform/shops/resume',localProvisioningGate,limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['operationId']);
  if(!body)return c.json({error:'Invalid setup request'},400);
  return localProvisioningResponse(c,hostedShopServiceEnabled(c.env)
    ?await hostedShopOperation(c.env,getCookie(c,SESSION_COOKIE),'resume',body)
    :await resumeLocalProvisioning(c.env,getCookie(c,SESSION_COOKIE),body.operationId));
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

app.post('/api/platform/shops/invite-owner',async(c,next)=>{
  if(c.env.PLATFORM_OWNER_INVITATION_ENABLED!=='true'||c.env.PLATFORM_OWNER_GMAIL_APPROVAL_ENABLED==='true')return c.notFound();
  await next();
},limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['googleSubject']);
  if(!body)return c.json({error:'Invalid Owner invitation'},400);
  const result=await issuePlatformOwnerInvitation(c.env,{googleSubject:body.googleSubject,sessionToken:getCookie(c,SESSION_COOKIE)});
  if(result.status==='invalid')return c.json({error:'Invalid Owner invitation'},400);
  if(result.status==='denied')return denied(c);
  if(result.status==='conflict')return c.json({error:'Owner invitation unavailable for this shop'},409);
  if(result.status!=='created')return unavailable(c);
  return c.json({inviteCode:result.inviteCode,expiresAtMs:result.expiresAtMs},201);
});

app.post('/api/platform/shops/approve-owner',async(c,next)=>{
  if(c.env.PLATFORM_OWNER_GMAIL_APPROVAL_ENABLED!=='true')return c.notFound();
  await next();
},limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['email']);
  if(!body)return c.json({error:'Enter a Gmail address'},400);
  const result=await approvePlatformOwnerGmail(c.env,{email:body.email,sessionToken:getCookie(c,SESSION_COOKIE)});
  if(result.status==='invalid')return c.json({error:'Enter a Gmail address'},400);
  if(result.status==='denied')return denied(c);
  if(result.status==='conflict')return c.json({error:'Owner approval unavailable for this shop'},409);
  if(result.status!=='approved')return unavailable(c);
  return c.json({shopId:result.shopId,email:result.email});
});

app.post('/api/platform/shops/disable-owner',async(c,next)=>{
  if(c.env.OWNER_WRITE_GRANTS_ENABLED!=='true')return c.notFound();
  await next();
},limitIngress,limitBody,async c=>{
  const body=await expectedJson(c,['shopId']);
  if(!body)return c.json({error:'Invalid business identity'},400);
  const status=await disablePlatformShopOwner(c.env,body.shopId,getCookie(c,SESSION_COOKIE));
  if(status==='denied')return denied(c);
  if(status==='mismatch')return c.json({error:'Shop binding mismatch'},409);
  return c.json({shopId:body.shopId,status});
});

/**
 * Hosted Support Mode uses an independently verified, prebound Shop D1 and
 * a 5-minute audited read grant. The separate local-test route remains
 * inaccessible without its original nonserializable fixture gate.
 */
app.post('/api/platform/support/:action',async(c,next)=>{
  if(!localSupportEnvironment(c.env)&&c.env.PLATFORM_HOSTED_SUPPORT_READY!=='true')
    return c.notFound();
  await next();
},limitIngress,limitBody,async c=>{
  const action=c.req.param('action');
  if(!['start','diagnostics','end'].includes(action))return c.notFound();
  if(c.env.PLATFORM_HOSTED_SUPPORT_READY==='true'){
    const fields={
      start:['shopId','operationId','reason'],
      diagnostics:['shopId','eventId','supportToken'],
      end:['shopId','operationId'],
    }[action];
    const body=await expectedJson(c,fields);
    if(!body)return c.json({error:'Invalid support request'},400);
    const reply=await hostedSupportRequest(
      c.env,action,body,getCookie(c,SESSION_COOKIE));
    return c.json(reply.body,reply.status);
  }
  const env=localSupportEnvironment(c.env);
  if(!env)return c.notFound();
  let body;
  try{body=await c.req.raw.clone().json();}catch{return c.json({error:'Invalid request'},400);}
  if(!body||typeof body.shopId!=='string')return c.json({error:'Invalid request'},400);
  const target=env.SUPPORT_TEST_SHOPS.find(s=>s.shopId===body.shopId);
  if(!target)return denied(c);
  // A reservation/binding is not by itself a finished shop. Ready is
  // checked from Control D1 for EVERY action, not from UI state.
  const ready=await env.CONTROL_DB.prepare(`SELECT 1 FROM platform_shop_provisioning p
    JOIN platform_shop_bindings b ON b.shop_id=p.shop_id
    WHERE p.shop_id=? AND p.stage='ready' AND
      p.database_id=? AND p.database_marker=? AND
      b.database_id=p.database_id AND b.database_marker=p.database_marker`)
    .bind(body.shopId,target.databaseId,target.databaseMarker).first();
  if(!ready)return denied(c);
  const url=new URL(c.req.url);
  url.pathname='/__m03_support_local__/'+action;
  const routed=new Request(url.toString(),c.req.raw);
  return handleLocalSupportHttpRequest(routed,env);
});

const SUPPORT_ERP_ASSETS=new Set([
  'm01-products-preview-controller.mjs','m05-product-form-stock-preview.js',
  'm05-product-unit-price-profile.js','m05-tile-stock-view.js',
  'product-unit-conversions.js','tile-quantity-contract.js',
]);
const SUPPORT_ERP_CSP=[
  "default-src 'self'","base-uri 'self'","frame-ancestors 'none'",
  "form-action 'none'","object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:","connect-src 'self'",
].join('; ');

// View the genuine compiled Owner ERP within the already authenticated
// Admin origin. No Owner cookie, impersonation or Owner Worker route is used.
app.get('/support/erp',limitIngress,async c=>{
  const visit=await activeAdminSupportVisit(c.env,getCookie(c,SESSION_COOKIE));
  if(!visit)return denied(c);
  const assets=c.env.ASSETS;
  if(typeof assets?.fetch!=='function')return unavailable(c);
  const asset=await assets.fetch(new Request(new URL('/owner-erp.html',c.req.url)));
  if(asset.status!==200)return unavailable(c);
  c.header('Content-Security-Policy',SUPPORT_ERP_CSP);
  c.header('Cache-Control','no-store');
  return c.body(asset.body,200,{'Content-Type':'text/html; charset=utf-8'});
});

// Original Owner frontend's small product-preview modules. Only these known
// files are served, and only during the current five-minute Admin grant.
app.get('/m05-products/:asset',limitIngress,async c=>{
  const asset=c.req.param('asset');
  if(!SUPPORT_ERP_ASSETS.has(asset))return c.notFound();
  const visit=await activeAdminSupportVisit(c.env,getCookie(c,SESSION_COOKIE));
  if(!visit)return denied(c);
  if(typeof c.env.ASSETS?.fetch!=='function')return unavailable(c);
  const reply=await c.env.ASSETS.fetch(new Request(
    new URL('/m05-products/'+asset,c.req.url)));
  if(reply.status!==200)return c.notFound();
  return c.body(reply.body,200,{'Content-Type':'text/javascript; charset=utf-8'});
});

// Fixed, GET-only, audited read adapter. All POST/PUT/PATCH/DELETE attempts
// return 404/405. Only reviewed Owner read functions are imported.
app.get('/api/platform/support/erp/*',limitIngress,async c=>{
  const suffix=c.req.path.slice(SUPPORT_ERP_PREFIX.length);
  if(!suffix||suffix.includes('..'))return c.notFound();
  const result=await readSupportErpData(
    c.env,getCookie(c,SESSION_COOKIE),suffix);
  return c.json(result.body,result.status);
});

// Dedicated private entry point. The default public Worker does not import it.
export default app;
