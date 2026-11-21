/**
 * Option A: private shared Owner Worker, exact Shop D1 routing contract.
 *
 * Reuses the existing PORT-P2 owner-session authority, immutable Control D1
 * Shop placement, independent Shop D1 identity and pinned schema receipts.
 * No browser-controlled Shop ID, database name, binding or session selection.
 * Never called without the future private Worker release publication gates.
 */
import {hashOpaqueSessionToken} from './session-token.js';
import {prepareCurrentOwnerPlacement} from './platform-owner-sessions.js';
import {pilotShopIdentityMatches} from './platform-shop-binding.js';
import {OWNER_READY_SHOP_MIGRATION_PLAN} from '../db/m03-owner-ready-shop-migrations.js';
import {readPortP2ShopCheckpoint,matchesPortP2MigrationPrefix}
  from '../db/port-p2-shop-schema.js';
import {verifyReleaseRoster} from '../provisioning/verified-binding-roster.js';
import {matchesApprovedSupplierCashSchemaOverlay}
  from '../db/m03-approved-supplier-overlay.js';

const same=(a,b)=>a?.shopId===b?.shopId&&
  a?.databaseId===b?.databaseId&&
  a?.databaseMarker===b?.databaseMarker&&
  a?.subject===b?.subject;
const stopped=(status='unavailable')=>({status});
const hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');

function readyPlacement(control,shopId){
  return control.prepare(`SELECT shop_id AS shopId,database_id AS databaseId,
    database_marker AS databaseMarker,binding_key AS binding
    FROM platform_shop_provisioning
    WHERE shop_id=? AND stage='ready' AND failed_stage IS NULL
    AND database_id IS NOT NULL AND binding_key IS NOT NULL
    AND EXISTS(SELECT 1 FROM platform_shop_bindings b
      WHERE b.shop_id=platform_shop_provisioning.shop_id
      AND b.database_id=platform_shop_provisioning.database_id
      AND b.database_marker=platform_shop_provisioning.database_marker)`)
    .bind(shopId);
}

function trustedRelease(env){
  const release=env.OWNER_ACTIVE_RELEASE_ROSTER;
  if(env.OWNER_MULTI_SHOP_ROUTING_ENABLED!=='true'||!release||
    release.accountId!==env.OWNER_RUNTIME_ACCOUNT_ID||
    release.codeSha!==env.OWNER_RUNTIME_CODE_SHA||
    release.versionId!==env.OWNER_RUNTIME_VERSION_ID)return null;
  try{verifyReleaseRoster(release);}
  catch{return null;}
  if(release.bindings.find(x=>x.binding==='CONTROL_DB')?.databaseId!==
     env.OWNER_RUNTIME_CONTROL_DB_ID)return null;
  return release;
}

/**
 * Resolve an opaque, already-authenticated Owner session to exactly one bound
 * D1. No browser input other than the Owner session cookie is accepted.
 * A single Google Gmail owning two Shops still needs explicit Shop-scoped
 * login/session selection elsewhere, never a request parameter here.
 */
export async function resolveAuthorizedOwnerShop(env,token){
  if(!env||typeof env.CONTROL_DB?.prepare!=='function'||
    typeof env.CONTROL_DB?.batch!=='function')return stopped();
  const release=trustedRelease(env);
  if(!release)return stopped();
  try{
    const hash=await hashOpaqueSessionToken(token);
    if(!hash)return stopped('denied');
    const control=env.CONTROL_DB;
    const owner=await prepareCurrentOwnerPlacement(control,hash).first();
    if(!owner)return stopped('denied');

    const published=release.shops.find(s=>s.shopId===owner.shopId);
    const placement=await readyPlacement(control,owner.shopId).first();
    if(!published||!placement||
      placement.shopId!==owner.shopId||
      placement.databaseId!==owner.databaseId||
      placement.databaseMarker!==owner.databaseMarker||
      published.databaseId!==owner.databaseId||
      published.databaseMarker!==owner.databaseMarker||
      placement.binding!==published.binding||
      !Object.hasOwn(env,published.binding)||
      typeof env[published.binding]?.prepare!=='function'||
      release.shops.filter(s=>s.shopId===owner.shopId||
        s.binding===published.binding).length!==1)return stopped();

    const shopDb=env[published.binding];
    if(!await pilotShopIdentityMatches({
      shopDb,shopId:owner.shopId,databaseId:owner.databaseId,
      databaseMarker:owner.databaseMarker
    }))return stopped();

    const {receipts,schema}=await readPortP2ShopCheckpoint(shopDb);
    if(receipts.length!==OWNER_READY_SHOP_MIGRATION_PLAN.length||
      !matchesPortP2MigrationPrefix(receipts,OWNER_READY_SHOP_MIGRATION_PLAN))
      return stopped();
    // The original 13 immutable receipts still anchor the Shop. Later
    // reviewed Supplier/Cash/Support DDL is valid only if the same strict
    // SHA-256-pinned verifier used by hosted single-Shop readiness accepts
    // the COMPLETE overlay. Partial or unknown SQL must remain unavailable.
    const baseline=receipts.at(-1)?.schema;
    if(baseline!==schema && !await matchesApprovedSupplierCashSchemaOverlay(
      baseline,schema))return stopped();
    if(published.binding!=='PLATFORM_PILOT_DB'){
      if(published.schemaRevision!=='owner-ready-v1')return stopped();
      const payload=JSON.stringify(receipts.map(r=>[r.position,r.name,r.checksum]));
      const digest=hex(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(payload)));
      if(published.receiptDigest!==digest)return stopped();
    }

    // Security-critical recheck after Shop D1's eventual-consistency window:
    // an access revocation or Ready/placement change cannot keep a stale
    // authenticated Shop database in the response.
    const [current,ready]=await control.batch([
      prepareCurrentOwnerPlacement(control,hash),
      readyPlacement(control,owner.shopId)
    ]);
    if(current.success!==true||ready.success!==true)return stopped();
    if(!same(current.results[0],owner))return stopped('denied');
    const target=ready.results[0];
    if(!target||target.binding!==placement.binding||
      target.databaseId!==placement.databaseId||
      target.databaseMarker!==placement.databaseMarker)return stopped();

    return {status:'ready',shopId:owner.shopId,shopDb,
      schemaRevision:'owner-ready-v1'};
  }catch{return stopped();}
}
