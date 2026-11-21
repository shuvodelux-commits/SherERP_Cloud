import {beginFirstOwnerGmailLogin,loginFirstOwnerWithGmail} from './auth/platform-owner-gmail-login.js';
import {OWNER_SESSION_MAX_AGE_SECONDS} from './auth/platform-owner-session-deadline.js';
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {getCookie,setCookie} from 'hono/cookie';
import {acceptOwnerInvite,readOwnerInviteChallenge} from './auth/platform-owner-acceptance.js';
import {buildSourceAppShellData} from './modules/source-app-shell-reader.js';
import {readCleanOwnerCatalog,readOwnerCatalog} from './db/m03-owner-catalog-read.js';
import {createOwnerProduct} from './db/m03-owner-product-create.js';
import {createOwnerSupplier,readOwnerSupplierBootstrap,
  recordOwnerSupplierOpening} from './db/m03-owner-supplier-create.js';
import {openOwnerCashSession,closeOwnerCashSession,readOwnerCashSession,readOwnerCashOpeningSuggestion,
  postOwnerCreditPurchase,readOwnerPurchaseBootstrap,readOwnerPurchaseHistory,
  readOwnerPurchaseDetail} from './db/m03-owner-mvp-purchase.js';
import {pilotShopConfiguration,pilotShopIdentityMatches} from './auth/platform-shop-binding.js';
import {readOwnerPosBootstrap,postOwnerCashSale,readOwnerCashSaleInvoice}
  from './db/m03-owner-mvp-cash-sale.js';
import {postOwnerCashReturn,readOwnerInvoiceForReturn,searchOwnerInvoicesForReturn}
  from './db/m03-owner-mvp-cash-return.js';
import {readOwnerPilotCashBook,readOwnerPilotSupplierPurchaseLedger}
  from './db/m03-owner-pilot-ledger-read.js';
import {postOwnerSupplierCashPayment} from './db/m08-owner-supplier-cash-pay.js';

import {beginOwnerGoogleLogin,loginOwnerWithGoogle,signOutOwnerBrowser,validateOwnerSession} from './auth/platform-owner-sessions.js';
import {readOwnerSupportAudit} from './auth/m03-support-owner-audit.js';
import {registerOwnerInvoiceProfileRoutes} from './modules/m09-owner-invoice-profile-routes.js';

const app=new Hono();
const INVITE_COOKIE='__Host-shererp-owner-invite';
const LOGIN_COOKIE='__Host-shererp-owner-login';
const SESSION_COOKIE='__Host-shererp-owner-session';
const COOKIE={path:'/',secure:true,httpOnly:true,sameSite:'Strict'};
const GOOGLE_CLIENT=/^[a-zA-Z0-9-]{1,218}\.apps\.googleusercontent\.com$/;
const OWNER_APP_ASSETS=new Set([
  'm01-products-preview-controller.mjs','m05-product-form-stock-preview.js',
  'm05-product-unit-price-profile.js','m05-tile-stock-view.js',
  'product-unit-conversions.js','tile-quantity-contract.js',
]);
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
const cleanProductsEnabled=env=>env.OWNER_CLEAN_PRODUCTS_ENABLED==='true'&&env.OWNER_WRITE_GRANTS_ENABLED==='true';

/**
 * Explicitly disabled by default. No hosted profile enables this route,
 * and production Control D1 has no approved support-audit migration yet.
 * One current Owner can read only their own Shop's sanitized support events.
 */
app.get('/api/owner/support/audit',protectLogin,async c=>{
  if(c.env.OWNER_SUPPORT_AUDIT_ENABLED!=='true')return c.notFound();
  const result=await readOwnerSupportAudit(c.env,getCookie(c,SESSION_COOKIE));
  if(result.status==='denied')return denied(c);
  if(result.status==='unavailable')return c.json({error:'Support audit unavailable'},503);
  return c.json({events:result.events});
});



app.get('/api/owner/catalog',protectLogin,async c=>{
  if(c.env.OWNER_CATALOG_ENABLED!=='true')return c.notFound();
  const session=await validateOwnerSession(c.env,getCookie(c,SESSION_COOKIE));
  if(!session)return denied(c);
  try{
    return c.json(cleanProductsEnabled(c.env)
      ?await readCleanOwnerCatalog(c.env.PLATFORM_PILOT_DB,{withMvpStock:ownerPurchaseEnabled(c.env)})
      :{data:await readOwnerCatalog(c.env.PLATFORM_PILOT_DB)});
  }catch{
    return c.json({error:'Owner catalog unavailable'},503);
  }
});

app.post('/api/owner/catalog',protectLogin,limitBody,async c=>{
  if(c.env.OWNER_CATALOG_ENABLED!=='true'||!cleanProductsEnabled(c.env))return c.notFound();
  const token=getCookie(c,SESSION_COOKIE);
  const session=await validateOwnerSession(c.env,token,{includeOwnerSubject:true});
  const scope=pilotShopConfiguration(c.env);
  if(!session||!scope||session.shopId!==scope.shopId)return denied(c);
  if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
    return c.json({success:false,message:'Expected a JSON product.'},400);
  const input=await c.req.json().catch(()=>null);
  const result=await createOwnerProduct(scope,{token,ownerSubject:session.ownerSubject,input});
  if(result.status==='created'||result.status==='replayed')
    return c.json({success:true,data:{id:result.id}},result.status==='created'?201:200);
  if(result.status==='denied')return c.json({success:false,message:'Owner product access is unavailable.'},403);
  if(result.status==='invalid')return c.json({success:false,message:'Enter a standard product with valid prices and zero opening stock.'},400);
  if(result.status==='unavailable')return c.json({success:false,message:'Operational catalog is unavailable.'},503);
  return c.json({success:false,message:'A product with this name already exists or the original save details changed.'},409);
});

// Reuse the already reviewed clean-Products Shop gate; no extra MVP feature toggle.
const supplierApiEnabled=cleanProductsEnabled;

// Actual private clean-Shop Supplier master; no financial balances are posted.
app.get('/api/owner/suppliers',protectLogin,async c=>{
  if(!supplierApiEnabled(c.env))return c.notFound();
  const session=await validateOwnerSession(c.env,getCookie(c,SESSION_COOKIE));
  const scope=pilotShopConfiguration(c.env);
  if(!session||!scope||session.shopId!==scope.shopId)return denied(c);
  try{return c.json(await readOwnerSupplierBootstrap(scope.shopDb));}
  catch{return c.json({error:'Supplier list unavailable'},503);}
});

app.post('/api/owner/suppliers',protectLogin,limitBody,async c=>{
  if(!supplierApiEnabled(c.env))return c.notFound();
  const token=getCookie(c,SESSION_COOKIE);
  const session=await validateOwnerSession(c.env,token,{includeOwnerSubject:true});
  const scope=pilotShopConfiguration(c.env);
  if(!session||!scope||session.shopId!==scope.shopId)return denied(c);
  if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
    return c.json({success:false,message:'Expected a JSON supplier.'},400);
  const input=await c.req.json().catch(()=>null);
  const result=await createOwnerSupplier(scope,{
    token,ownerSubject:session.ownerSubject,input
  });
  if(result.status==='created'||result.status==='replayed')
    return c.json({success:true,data:{id:result.id}},result.status==='created'?201:200);
  if(result.status==='denied')
    return c.json({success:false,message:'Owner supplier access is unavailable.'},403);
  if(result.status==='invalid')
    return c.json({success:false,message:'Enter a Supplier name and valid signed opening amount.'},400);
  if(result.status==='unsupported')
    return c.json({success:false,message:'Historical opening requires the reviewed Supplier ledger migration.'},503);
  if(result.status==='unavailable')
    return c.json({success:false,message:'Supplier source history is not verified.'},503);
  return c.json({success:false,message:'Supplier already exists or saved details changed.'},409);
});

// A Supplier created before the historical-opening extension may record one
// immutable signed opening, but never after Purchases or payments have posted.
// No Cash Session is required because this is not a cash movement.
app.post('/api/owner/suppliers/:supplierId/opening',protectLogin,limitBody,async c=>{
  if(!supplierApiEnabled(c.env))return c.notFound();
  const token=getCookie(c,SESSION_COOKIE);
  const session=await validateOwnerSession(c.env,token,{includeOwnerSubject:true});
  const scope=pilotShopConfiguration(c.env);
  if(!session||!scope||session.shopId!==scope.shopId)return denied(c);
  if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
    return c.json({success:false,message:'Expected a JSON historical opening.'},400);
  const input=await c.req.json().catch(()=>null);
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).length!==2||!Object.hasOwn(input,'operationId')||
     !Object.hasOwn(input,'openingBalance'))
    return c.json({success:false,message:'Invalid Supplier opening request.'},400);
  const result=await recordOwnerSupplierOpening(scope,{
    token,ownerSubject:session.ownerSubject,
    supplierId:c.req.param('supplierId'),
    operationId:input.operationId,openingBalance:input.openingBalance
  });
  if(result.status==='created'||result.status==='replayed')
    return c.json({success:true,data:{supplierId:result.supplierId}},
      result.status==='created'?201:200);
  if(result.status==='invalid')return c.json({success:false,message:'Invalid signed opening amount.'},400);
  if(result.status==='denied')return c.json({success:false,message:'Owner Supplier opening denied.'},403);
  if(result.status==='unsupported')
    return c.json({success:false,message:'Supplier historical ledger migration is not installed.'},503);
  if(result.status==='conflict')
    return c.json({success:false,message:'Supplier opening is already recorded or money activity exists.'},409);
  return c.json({success:false,message:'Supplier opening unavailable.'},503);
});

// M03 MVP first operational credit Purchase is private, explicitly opt-in,
// never included in public Worker RPC or DB-free PR previews.
const ownerPurchaseEnabled=env=>cleanProductsEnabled(env)&&env.OWNER_MVP_PURCHASE_ENABLED==='true';
const ownerCashPosEnabled=env=>ownerPurchaseEnabled(env)&&env.OWNER_MVP_POS_CASH_ENABLED==='true';
const ownerCashReturnEnabled=env=>ownerCashPosEnabled(env)&&env.OWNER_MVP_CASH_RETURN_ENABLED==='true';
const ownerSupplierCashPayEnabled=env=>ownerCashReturnEnabled(env)&&
  env.OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED==='true';

// Reconciliation migration 0011 must precede any Supplier cash payout.
// Check SQL-time Close Day, not only JavaScript projections or a feature flag.
async function supplierCashCloseReady(db){
  const row=await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table'
      AND name='owner_mvp_supplier_cash_payment_receipts') AND
    EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
      AND name='owner_mvp_cash_close_guard'
      AND instr(sql,'owner_mvp_supplier_payment_cash_book')>0) AND
    NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger'
      AND name='owner_mvp_supplier_cash_pending_close') AS ready`).first();
  return row?.ready===1;
}

// M03/M08: scoped first-Shop financial projections. Supplier cash payout
// remains an independently gated Owner-only operation, disabled by default.
// These endpoints still do not support Bank, Expense or Customer Due.
app.get('/api/owner/suppliers/:supplierId/ledger',protectLogin,async c=>{
  if(!ownerPurchaseEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{
    const result=await readOwnerPilotSupplierPurchaseLedger(
      ctx.scope.shopDb,c.req.param('supplierId'));
    return result?c.json({success:true,data:{...result,
      cashPayAvailable:ownerSupplierCashPayEnabled(c.env)&&
        await supplierCashCloseReady(ctx.scope.shopDb)}}):c.notFound();
  }catch{return c.json({success:false,message:'Supplier purchase ledger unavailable'},503);}
});

app.get('/api/owner/cash-book',protectLogin,async c=>{
  if(!ownerCashReturnEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{
    const data=await readOwnerPilotCashBook(ctx.scope.shopDb);
    return c.json({success:true,data});
  }catch{return c.json({success:false,message:'Cash Book unavailable'},503);}
});

// Only a reviewed, migrated clean-Shop Owner may post same-day Cash Supplier Pay.
// This remains OFF in the login-only Cloudflare production profile.
app.post('/api/owner/suppliers/:supplierId/cash-pay',protectLogin,limitBody,async c=>{
  if(!ownerSupplierCashPayEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c,true);
  if(!ctx)return denied(c);
  const input=await ownerPurchaseJson(c);
  if(!input||Object.keys(input).length!==2||
     !Object.hasOwn(input,'operationId')||!Object.hasOwn(input,'payload')||
     input.payload?.supplierId!==c.req.param('supplierId'))
    return c.json({success:false,message:'Invalid supplier payment.'},400);
  try{
    if(!await supplierCashCloseReady(ctx.scope.shopDb))
      return c.json({success:false,
        message:'Supplier cash reconciliation is not available for this Shop.'},503);
    const result=await postOwnerSupplierCashPayment(ctx.scope,{
      token:ctx.token,ownerSubject:ctx.ownerSubject,
      operationId:input.operationId,payload:input.payload
    });
    if(result.status==='created'||result.status==='replayed')
      return c.json({success:true,data:{
        paymentId:result.paymentId,supplierId:result.supplierId,
        amount:result.amount,currentDue:result.currentDue
      }},result.status==='created'?201:200);
    if(result.status==='denied')return c.json({success:false,
      message:'Owner or Supplier payment authorization denied.'},403);
    if(result.status==='session-required')return c.json({success:false,
      message:'Open a Cash Session before paying a Supplier.'},409);
    if(result.status==='insufficient-cash')return c.json({success:false,
      message:'Insufficient verified cash in this Cash Session.'},409);
    if(result.status==='insufficient-due')return c.json({success:false,
      message:'Supplier due is insufficient or has changed.'},409);
    if(result.status==='conflict')return c.json({success:false,
      message:'Payment operation already exists with different details.'},409);
    if(result.status==='unsupported')return c.json({success:false,
      message:'Only a same-day Cash payment without discount or Bank is supported.'},422);
    if(result.status==='invalid')return c.json({success:false,
      message:'Invalid supplier Cash payment.'},400);
    return c.json({success:false,message:'Supplier payment unavailable.'},503);
  }catch{return c.json({success:false,message:'Supplier payment unavailable.'},503);}
});

async function verifiedOwnerPurchaseContext(c,subject=false,dashboard=false){
  const token=getCookie(c,SESSION_COOKIE);
  const session=await validateOwnerSession(c.env,token,{includeOwnerSubject:subject,dashboard});
  const scope=pilotShopConfiguration(c.env);
  if(!session||!scope||session.shopId!==scope.shopId||
     !await pilotShopIdentityMatches(scope))return null;
  return {token,ownerSubject:session.ownerSubject,shopName:session.dashboard?.displayName,scope};
}

// M03 sole shared Worker integrator. The installed M09 routes are flag-OFF by
// default and reuse the current private Owner cookie, Origin and Shop D1 gate.
// This adds no public RPC, staff account access, invoice printer or D1 migration.
registerOwnerInvoiceProfileRoutes(app,{
  protectLogin,
  limitBody,
  currentOwnerContext:c=>verifiedOwnerPurchaseContext(c,true),
});
function purchaseError(c,status){
  if(status==='denied')return c.json({success:false,message:'Purchase Owner access denied.'},403);
  if(status==='session-required')return c.json({success:false,
    message:'Start Day before recording a purchase. The Cash Session must be Open.'},409);
  if(status==='opening-mismatch')return c.json({success:false,
    message:'Opening cash must match the previous counted Close Day amount. Refresh Cash Session before starting.'},409);
  if(status==='reconciliation-required')return c.json({success:false,
    message:'Cash Session reconciliation changed or is unavailable. Refresh and review the recorded Cash Book before retrying.'},409);
  if(status==='conflict')return c.json({success:false,
    message:'The original Close Day amount or notes changed. Retry unchanged or review the saved close.'},409);
  if(status==='unsupported')return c.json({success:false,
    message:'For now only same-day, unpaid, zero-discount purchases in one base unit are supported. Cash, Bank, Tiles and mixed-unit posting are not connected yet.'},422);
  if(status==='invalid')return c.json({success:false,message:'Invalid purchase or Cash Session input.'},400);
  if(status==='conflict')return c.json({success:false,
    message:'Purchase already exists or saved details changed. Refresh and review before retrying.'},409);
  return c.json({success:false,message:'Purchase request unavailable or not authorized.'},503);
}
async function ownerPurchaseJson(c){
  if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
    return null;
  const input=await c.req.json().catch(()=>null);
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  return input;
}

app.get('/api/owner/purchase/bootstrap',protectLogin,async c=>{
  if(!ownerPurchaseEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{
    const data=await readOwnerPurchaseBootstrap(ctx.scope.shopDb);
    return c.json({success:true,data:{...data,cashSession:await readOwnerCashSession(ctx.scope.shopDb)}});
  }catch{return c.json({success:false,message:'Purchase bootstrap unavailable'},503);}
});

app.get('/api/owner/purchases',protectLogin,async c=>{
  if(!ownerPurchaseEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{return c.json({success:true,data:await readOwnerPurchaseHistory(ctx.scope.shopDb)});}
  catch{return c.json({success:false,message:'Purchase history unavailable'},503);}
});

app.get('/api/owner/purchases/:purchaseId',protectLogin,async c=>{
  if(!ownerPurchaseEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{
    const data=await readOwnerPurchaseDetail(ctx.scope.shopDb,c.req.param('purchaseId'));
    return data?c.json({success:true,data}):c.notFound();
  }catch{return c.json({success:false,message:'Purchase detail unavailable'},503);}
});

app.post('/api/owner/purchases',protectLogin,limitBody,async c=>{
  if(!ownerPurchaseEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c,true);
  if(!ctx)return denied(c);
  const input=await ownerPurchaseJson(c);
  if(!input||Object.keys(input).length!==2||!Object.hasOwn(input,'operationId')||
     !Object.hasOwn(input,'payload'))return purchaseError(c,'invalid');
  const result=await postOwnerCreditPurchase(ctx.scope,{
    token:ctx.token,ownerSubject:ctx.ownerSubject,
    operationId:input.operationId,payload:input.payload
  });
  if(result.status==='created'||result.status==='replayed')
    return c.json({success:true,data:{purchaseId:result.purchaseId,
      grandTotal:result.grandTotal,dueAmount:result.dueAmount}},
      result.status==='created'?201:200);
  return purchaseError(c,result.status);
});

app.get('/api/owner/cash-session',protectLogin,async c=>{
  if(!ownerPurchaseEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{return c.json({success:true,data:await readOwnerCashSession(ctx.scope.shopDb)});}
  catch{return c.json({success:false,message:'Cash Session unavailable'},503);}
});

// Only the currently authenticated Owner learns the last physical drawer count.
// This does NOT mutate the cash ledger, start a new Session or bypass a grant.
app.get('/api/owner/cash-session/next-opening',protectLogin,async c=>{
  if(!ownerPurchaseEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{return c.json({success:true,data:await readOwnerCashOpeningSuggestion(ctx.scope.shopDb)});}
  catch{return c.json({success:false,message:'Next opening amount unavailable'},503);}
});

for(const [path,operation] of [
  ['/api/owner/cash-session/start',openOwnerCashSession],
  ['/api/owner/cash-session/close',closeOwnerCashSession],
]){
  app.post(path,protectLogin,limitBody,async c=>{
    if(!ownerPurchaseEnabled(c.env))return c.notFound();
    const ctx=await verifiedOwnerPurchaseContext(c,true);
    if(!ctx)return denied(c);
    const input=await ownerPurchaseJson(c);
    const keys=operation===openOwnerCashSession
      ?['operationId','openingCash','notes']
      :['operationId','countedCash','notes'];
    if(!input||typeof input.operationId!=='string'||
      Object.keys(input).length!==keys.length||
      keys.some(key=>!Object.hasOwn(input,key)))return purchaseError(c,'invalid');
    // Never let browser JSON override the authenticated Owner subject/token.
    const result=await operation(ctx.scope,{
      ...input,token:ctx.token,ownerSubject:ctx.ownerSubject
    });
    if(['started','closed','replayed','already-open'].includes(result.status)){
      return c.json({success:true,data:{sessionId:result.sessionId,
        ...(result.expected!==undefined?{expected:result.expected}:{}),
        ...(result.counted!==undefined?{counted:result.counted}:{}),
        ...(result.variance!==undefined?{variance:result.variance}:{}),
        status:result.status}},result.status==='started'?201:200);
    }
    return purchaseError(c,result.status);
  });
}

// ONE real MVP cash sale through the existing private Owner/Shop boundary.
app.get('/api/owner/pos/bootstrap',protectLogin,async c=>{
  if(!ownerCashPosEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c,false,true);
  if(!ctx)return denied(c);
  try{return c.json({success:true,data:await readOwnerPosBootstrap(ctx.scope.shopDb,{
    shopName:ctx.shopName,
  })});}catch{return c.json({success:false,message:'POS stock data unavailable'},503);}
});

app.get('/api/owner/pos/drafts',protectLogin,async c=>{
  if(!ownerCashPosEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c,false,true);
  if(!ctx)return denied(c);
  try{
    // There is no draft store for this verified clean new Shop; never
    // fabricate historical drafts or silently claim restored drafts.
    await readOwnerPosBootstrap(ctx.scope.shopDb,{shopName:ctx.shopName});
    return c.json({success:true,data:[]});
  }catch{return c.json({success:false,message:'Draft list unavailable'},503);}
});

app.get('/api/owner/pos/invoices/:invoiceId',protectLogin,async c=>{
  if(!ownerCashPosEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{
    const invoice=await readOwnerCashSaleInvoice(ctx.scope.shopDb,c.req.param('invoiceId'));
    return invoice?c.json({success:true,data:invoice}):c.notFound();
  }catch{return c.json({success:false,message:'Invoice unavailable'},503);}
});

app.post('/api/owner/pos/sales',protectLogin,limitBody,async c=>{
  if(!ownerCashPosEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c,true,true);
  if(!ctx)return denied(c);
  const input=await ownerPurchaseJson(c);
  if(!input||Object.keys(input).length!==2||
    !Object.hasOwn(input,'operationId')||!Object.hasOwn(input,'payload'))
    return c.json({success:false,message:'Invalid POS checkout'},400);
  const result=await postOwnerCashSale(ctx.scope,{
    token:ctx.token,ownerSubject:ctx.ownerSubject,shopName:ctx.shopName,
    operationId:input.operationId,payload:input.payload
  });
  if(result.status==='created'||result.status==='replayed')
    return c.json({success:true,data:result.invoice},result.status==='created'?201:200);
  if(result.status==='denied')
    return c.json({success:false,message:'Owner POS access denied'},403);
  if(result.status==='session-required')
    return c.json({success:false,message:'Start Day before completing a sale'},409);
  if(result.status==='unsupported')
    return c.json({success:false,message:
      'Only one in-stock Standard product, original FIFO price, cash paid in full, no discount or Customer Due is supported in this MVP pilot.'},422);
  if(result.status==='declined')
    return c.json({success:false,message:'Stock or FIFO sale price changed. Refresh POS before retrying.'},409);
  if(result.status==='invalid')
    return c.json({success:false,message:'Invalid POS checkout details.'},400);
  if(result.status==='conflict')
    return c.json({success:false,message:'Checkout changed after saving. Review the original invoice before retry.'},409);
  return c.json({success:false,message:'POS transaction unavailable. Retry unchanged checkout.'},503);
});

// M03/M07 real original Cash Return. Same current Owner/Shop and original
// #801 Sales receipt; no arbitrary refund or public financial RPC.
app.get('/api/owner/returns/search/:query',protectLogin,async c=>{
  if(!ownerCashReturnEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{return c.json({success:true,data:await searchOwnerInvoicesForReturn(
    ctx.scope.shopDb,c.req.param('query'))});}
  catch{return c.json({success:false,message:'Return invoice search unavailable'},503);}
});

app.get('/api/owner/returns/invoices/:invoiceId',protectLogin,async c=>{
  if(!ownerCashReturnEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c);
  if(!ctx)return denied(c);
  try{
    const data=await readOwnerInvoiceForReturn(ctx.scope.shopDb,c.req.param('invoiceId'));
    return data?c.json({success:true,data}):c.notFound();
  }catch{return c.json({success:false,message:'Return invoice unavailable'},503);}
});

app.post('/api/owner/returns',protectLogin,limitBody,async c=>{
  if(!ownerCashReturnEnabled(c.env))return c.notFound();
  const ctx=await verifiedOwnerPurchaseContext(c,true);
  if(!ctx)return denied(c);
  const input=await ownerPurchaseJson(c);
  if(!input||Object.keys(input).length!==2||
     !Object.hasOwn(input,'operationId')||!Object.hasOwn(input,'payload'))
    return c.json({success:false,message:'Invalid Sales Return request'},400);
  const result=await postOwnerCashReturn(ctx.scope,{
    token:ctx.token,ownerSubject:ctx.ownerSubject,
    operationId:input.operationId,payload:input.payload
  });
  if(result.status==='created'||result.status==='replayed'){
    const {status,...receipt}=result;
    return c.json({success:true,data:receipt},status==='created'?201:200);
  }
  if(result.status==='denied')return c.json({success:false,message:'Owner Return access denied'},403);
  if(result.status==='session-required')
    return c.json({success:false,message:'Start Day before recording a Return'},409);
  if(result.status==='unsupported')
    return c.json({success:false,message:'Only a whole-unit, original-price Cash refund for one verified FIFO invoice line is connected. Store Credit, batch and edits are not available yet.'},422);
  if(result.status==='declined'||result.status==='conflict')
    return c.json({success:false,message:'Original invoice, return quantity or refund changed. Reload the original invoice before retrying.'},409);
  if(result.status==='invalid')
    return c.json({success:false,message:'Invalid Return details'},400);
  return c.json({success:false,message:'Return unavailable; retry unchanged request'},503);
});

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
  setCookie(c,SESSION_COOKIE,token,{...COOKIE,maxAge:OWNER_SESSION_MAX_AGE_SECONDS});
  return c.json({role:'Owner'});
});

app.get('/api/owner/auth/session',protectLogin,async c=>{
  const session=await validateOwnerSession(c.env,getCookie(c,SESSION_COOKIE),{
    dashboard:c.env.OWNER_DASHBOARD_BOOTSTRAP_ENABLED==='true',
  });
  // Only an authenticated current Owner learns about the read-only audit UI.
  // Hosted configs omit OWNER_SUPPORT_AUDIT_ENABLED, keeping this default-off.
  return session?c.json({
    ...session,
    ...(c.env.OWNER_SUPPORT_AUDIT_ENABLED==='true'?{supportAuditEnabled:true}:{}),
  }):denied(c);
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

const erpPageCsp=[
  "default-src 'self'","base-uri 'self'","frame-ancestors 'none'","form-action 'none'",
  "script-src 'self' 'unsafe-inline'","style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com","img-src 'self' data: blob:",
  "connect-src 'self'","object-src 'none'",
].join('; ');

app.get('/app',protectLogin,async c=>{
  if(c.env.OWNER_DASHBOARD_BOOTSTRAP_ENABLED!=='true')return c.notFound();
  const session=await validateOwnerSession(c.env,getCookie(c,SESSION_COOKIE),{dashboard:true});
  if(!session)return c.redirect('/',302);
  const assets=c.env.ASSETS;
  if(typeof assets?.fetch!=='function')return unavailable(c);
  const reply=await assets.fetch(new Request(new URL('/owner-erp.html',c.req.url)));
  if(reply.status!==200)return unavailable(c);
  c.header('Cache-Control','no-store');
  c.header('Content-Security-Policy',erpPageCsp);
  c.header('Referrer-Policy','no-referrer');
  c.header('X-Content-Type-Options','nosniff');
  return c.body(await reply.text(),200,{'Content-Type':'text/html; charset=utf-8'});
});

app.get('/index.html',protectLogin,async c=>{
  if(c.env.OWNER_DASHBOARD_BOOTSTRAP_ENABLED!=='true')return c.notFound();
  const session=await validateOwnerSession(c.env,getCookie(c,SESSION_COOKIE),{dashboard:true});
  return session?c.redirect('/app',302):denied(c);
});

app.get('/m05-products/*',protectLogin,async c=>{
  if(c.env.OWNER_DASHBOARD_BOOTSTRAP_ENABLED!=='true')return c.notFound();
  const filename=c.req.path.slice('/m05-products/'.length);
  if(!OWNER_APP_ASSETS.has(filename))return c.notFound();
  const session=await validateOwnerSession(c.env,getCookie(c,SESSION_COOKIE),{dashboard:true});
  if(!session)return denied(c);
  const assets=c.env.ASSETS;
  if(typeof assets?.fetch!=='function')return unavailable(c);
  const reply=await assets.fetch(new Request(new URL(c.req.path,c.req.url)));
  if(reply.status!==200)return c.notFound();
  c.header('Cache-Control','no-store');
  c.header('X-Content-Type-Options','nosniff');
  return c.body(reply.body,200,{'Content-Type':'text/javascript; charset=utf-8'});
});

app.get('/api/owner/app-shell',protectLogin,async c=>{
  if(c.env.OWNER_DASHBOARD_BOOTSTRAP_ENABLED!=='true')return c.notFound();
  const session=await validateOwnerSession(c.env,getCookie(c,SESSION_COOKIE),{dashboard:true});
  if(!session)return denied(c);
  const source=buildSourceAppShellData({
    shopName:session.dashboard.displayName,currencySymbol:'',
  });
  return c.json({success:true,data:source.data});
});

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
    const markers=[
      c.env.OWNER_GMAIL_SIGNUP_ENABLED==='true'?'data-gmail-signin="enabled"':'',
      c.env.OWNER_REDEMPTION_ENABLED==='true'?'data-redemption="enabled"':'',
      c.env.OWNER_DASHBOARD_BOOTSTRAP_ENABLED==='true'?'data-owner-erp="enabled"':'',
    ].filter(Boolean).join(' ');
    const content=markers?html.replace('<body>','<body '+markers+'>'):html;
    return c.body(content,200,{'Content-Type':type});
  });
}

// This entry is separate from the deployed platform and public ERP Workers.
export default app;
