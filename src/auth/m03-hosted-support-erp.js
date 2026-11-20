/**
 * Active, read-only Admin Support ERP visitor. No Owner session is issued:
 * the authorization is the current MFA-backed PlatformSuperAdmin session,
 * the single trusted Shop D1 and an active 5-minute support grant.
 */
import {hashOpaqueSessionToken} from './session-token.js';
import {CURRENT_PLATFORM_ADMIN_FROM} from './platform-superadmin-session.js';
import {verifiedPreboundPilot} from './m03-hosted-prebound-pilot.js';
import {buildSourceAppShellData} from '../modules/source-app-shell-reader.js';
import {readCleanOwnerCatalog,readOwnerCatalog} from '../db/m03-owner-catalog-read.js';
import {readOwnerSupplierBootstrap} from '../db/m03-owner-supplier-create.js';
import {readOwnerPurchaseBootstrap,readOwnerCashSession,
  readOwnerPurchaseHistory,readOwnerPurchaseDetail} from '../db/m03-owner-mvp-purchase.js';
import {readOwnerPosBootstrap,readOwnerCashSaleInvoice} from '../db/m03-owner-mvp-cash-sale.js';
import {readOwnerInvoiceForReturn,searchOwnerInvoicesForReturn} from '../db/m03-owner-mvp-cash-return.js';

const NOW="CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const ABSOLUTE_ID=/^(?:INV|PUR)-[0-9]{6,}$/;
const ERROR=Object.freeze({error:'Read-only support access unavailable'});
export const SUPPORT_ERP_PREFIX='/api/platform/support/erp/';
const RECEIPT_SOURCES=Object.freeze([
  {table:'owner_product_create_receipts',kind:'Product created',query:
    'SELECT created_at_ms AS atMs,sequence AS seq FROM owner_product_create_receipts ORDER BY sequence DESC LIMIT 25'},
  {table:'owner_mvp_purchase_receipts',kind:'Purchase posted',query:
    'SELECT created_at_ms AS atMs,sequence AS seq FROM owner_mvp_purchase_receipts ORDER BY sequence DESC LIMIT 25'},
  {table:'owner_mvp_sale_receipts',kind:'Cash sale posted',query:
    'SELECT created_at_ms AS atMs,sequence AS seq FROM owner_mvp_sale_receipts ORDER BY sequence DESC LIMIT 25'},
  {table:'owner_mvp_sale_return_receipts',kind:'Sales return posted',query:
    'SELECT created_at_ms AS atMs,sequence AS seq FROM owner_mvp_sale_return_receipts ORDER BY sequence DESC LIMIT 25'},
  {table:'owner_mvp_cash_sessions',kind:'Cash session opened',query:
    'SELECT started_at_ms AS atMs,sequence AS seq FROM owner_mvp_cash_sessions ORDER BY sequence DESC LIMIT 25'},
  {table:'owner_mvp_cash_sessions',kind:'Cash session closed',query:
    'SELECT closed_at_ms AS atMs,sequence AS seq FROM owner_mvp_cash_sessions WHERE closed_at_ms IS NOT NULL ORDER BY sequence DESC LIMIT 25'},
]);

function matchScope(env,pilot,grant){
  return !!pilot&&!!grant && grant.shopId===pilot.shopId &&
    grant.databaseId===pilot.databaseId&&grant.databaseMarker===pilot.databaseMarker;
}
export async function activeAdminSupportVisit(env,sessionToken){
  if(env?.PLATFORM_HOSTED_SUPPORT_ENABLED!=='true'||
    typeof env.CONTROL_DB?.prepare!=='function')return null;
  const hash=await hashOpaqueSessionToken(sessionToken);
  if(!hash)return null;
  // SQL-current session, factor version and exact immutable shop scope.
  const grant=await env.CONTROL_DB.prepare(`SELECT
      g.operation_id AS operationId,g.shop_id AS shopId,
      g.database_id AS databaseId,g.database_marker AS databaseMarker,
      g.expires_at_ms AS expiresAtMs,r.display_name AS displayName
    FROM m03_local_support_grants g
    JOIN platform_shop_reservations r ON r.shop_id=g.shop_id
    JOIN platform_shop_bindings b ON b.shop_id=g.shop_id
      AND b.database_id=g.database_id AND b.database_marker=g.database_marker
    JOIN platform_shop_provisioning p ON p.shop_id=g.shop_id AND p.stage='ready'
      AND p.database_id=g.database_id AND p.database_marker=g.database_marker
    WHERE g.admin_session_hash=? AND g.revoked_at_ms IS NULL
      AND g.expires_at_ms>${NOW} AND g.issued_at_ms<=${NOW}
      AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
        AND f.subject=g.actor_subject)
    ORDER BY g.issued_at_ms DESC LIMIT 1`)
    .bind(hash,hash).first();
  if(!grant)return null;
  const pilot=await verifiedPreboundPilot(env);
  if(!matchScope(env,pilot,grant))return null;
  return {grant,pilot,sessionHash:hash};
}

export async function auditedAdminSupportVisit(env,sessionToken){
  const visit=await activeAdminSupportVisit(env,sessionToken);
  if(!visit)return null;
  const eventId=crypto.randomUUID();
  const result=await env.CONTROL_DB.prepare(`INSERT INTO m03_local_support_events
    (event_id,grant_operation_id,event_type,shop_id,actor_subject,event_at_ms)
    SELECT ?,g.operation_id,'READ',g.shop_id,g.actor_subject,${NOW}
    FROM m03_local_support_grants g
    WHERE g.operation_id=? AND g.admin_session_hash=?
      AND g.revoked_at_ms IS NULL
      AND g.issued_at_ms<=${NOW} AND g.expires_at_ms>${NOW}
      AND EXISTS(SELECT 1 ${CURRENT_PLATFORM_ADMIN_FROM}
        AND f.subject=g.actor_subject)
    RETURNING event_id AS eventId`)
    .bind(eventId,visit.grant.operationId,visit.sessionHash,visit.sessionHash).first();
  return result?visit:null;
}

async function readActivity(env,visit){
  const {shopDb}=visit.pilot;
  const known=new Set((await shopDb.prepare(
    `SELECT name FROM sqlite_schema WHERE type='table'`).all()).results.map(r=>r.name));
  const entries=[];
  for(const item of RECEIPT_SOURCES){
    if(!known.has(item.table))continue;
    const rows=(await shopDb.prepare(item.query).all()).results;
    for(const r of rows){
      if(Number.isSafeInteger(r.atMs)&&r.atMs>0&&Number.isSafeInteger(r.seq))
        entries.push({eventType:item.kind,eventAtMs:r.atMs,reference:item.table+':'+r.seq,
          source:'Shop'});
    }
  }
  // Existing support access audit is also per-Shop and immutable.
  const events=(await env.CONTROL_DB.prepare(`SELECT
    e.event_type AS eventType,e.event_at_ms AS eventAtMs,
    g.reason AS reason,g.operation_id AS operationId
    FROM m03_local_support_events e
    JOIN m03_local_support_grants g ON g.operation_id=e.grant_operation_id
    WHERE e.shop_id=? AND g.shop_id=?
    ORDER BY e.event_at_ms DESC,e.event_id DESC LIMIT 50`)
    .bind(visit.grant.shopId,visit.grant.shopId).all()).results;
  for(const r of events){
    entries.push({eventType:'Support '+r.eventType,eventAtMs:r.eventAtMs,
      reference:r.operationId,source:'Support',reason:r.reason});
  }
  entries.sort((a,b)=>b.eventAtMs-a.eventAtMs||a.reference.localeCompare(b.reference));
  return {success:true,data:{
    shopId:visit.grant.shopId,items:entries.slice(0,60),
    sourceTables:RECEIPT_SOURCES.filter(s=>known.has(s.table)).map(s=>s.table),
  }};
}

export async function readSupportErpData(env,sessionToken,path){
  const visit=await auditedAdminSupportVisit(env,sessionToken);
  if(!visit)return {status:403,body:ERROR};
  const db=visit.pilot.shopDb;
  const shopName=visit.grant.displayName;
  let body;
  try{
    if(path==='session')body={role:'PlatformSupport',shopId:visit.grant.shopId,
      operationId:visit.grant.operationId,expiresAtMs:visit.grant.expiresAtMs,
      dashboard:{displayName:shopName,dataAvailable:false}};
    else if(path==='app-shell')body=buildSourceAppShellData({
      shopName,currencySymbol:'',
    });
    else if(path==='catalog'){
      // Reuse the same reviewed Owner read adapter. Never expose a write grant.
      body=await readCleanOwnerCatalog(db,{withMvpStock:true}).catch(async()=>
        ({data:await readOwnerCatalog(db)}));
    }
    else if(path==='suppliers')body=await readOwnerSupplierBootstrap(db);
    else if(path==='purchase/bootstrap'){
      const bootstrap=await readOwnerPurchaseBootstrap(db);
      body={success:true,data:{...bootstrap,cashSession:await readOwnerCashSession(db)}};
    }
    else if(path==='purchases')body={success:true,data:await readOwnerPurchaseHistory(db)};
    else if(path==='cash-session')body={success:true,data:await readOwnerCashSession(db)};
    else if(path==='pos/bootstrap')body={success:true,data:await readOwnerPosBootstrap(db,{shopName})};
    else if(path==='pos/drafts')body={success:true,data:[]};
    else if(path==='activity')body=await readActivity(env,visit);
    else if(path.startsWith('purchases/')&&ABSOLUTE_ID.test(path.slice(10))){
      const result=await readOwnerPurchaseDetail(db,path.slice(10));
      if(!result)return {status:404,body:ERROR};
      body={success:true,data:result};
    }
    else if(path.startsWith('pos/invoices/')&&ABSOLUTE_ID.test(path.slice(13))){
      const result=await readOwnerCashSaleInvoice(db,path.slice(13));
      if(!result)return {status:404,body:ERROR};
      body={success:true,data:result};
    }
    else if(path.startsWith('returns/invoices/')&&ABSOLUTE_ID.test(path.slice(17))){
      const result=await readOwnerInvoiceForReturn(db,path.slice(17));
      if(!result)return {status:404,body:ERROR};
      body={success:true,data:result};
    }
    else if(path.startsWith('returns/search/')){
      const q=decodeURIComponent(path.slice(15));
      if(!q.trim()||q.length>80)return {status:400,body:ERROR};
      body={success:true,data:await searchOwnerInvoicesForReturn(db,q)};
    } else return {status:404,body:ERROR};
  }catch{return {status:503,body:ERROR};}
  // Cross-D1 READ is only returned after another current session+grant check.
  const still=await activeAdminSupportVisit(env,sessionToken);
  if(!still||still.grant.operationId!==visit.grant.operationId)return {status:403,body:ERROR};
  return {status:200,body};
}
