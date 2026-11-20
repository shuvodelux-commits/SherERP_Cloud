/**
 * Option A: reuse the existing PORT-P2 / PORT-P4 Owner-ready schema proof.
 *
 * This verifier NEVER executes arbitrary SQL or selects a Cloudflare D1 ID.
 * The separately reviewed private migration provider must attest the target
 * and apply pinned migrations; success requires immutable Shop D1 identity,
 * the exact 13 migration receipts and unchanged schema snapshot.
 */
import {OWNER_READY_SHOP_MIGRATION_PLAN,isOwnerReadyShopMigrationPlan}
  from '../db/m03-owner-ready-shop-migrations.js';
import {readPortP2ShopCheckpoint,matchesPortP2MigrationPrefix}
  from '../db/port-p2-shop-schema.js';
import {pilotShopIdentityMatches} from '../auth/platform-shop-binding.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const denied=()=>{throw Error('SHOP_SCHEMA_NOT_READY');};
const hex=bytes=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');

export async function prepareVerifiedShop({
  shopDb,scope,provider,plan=OWNER_READY_SHOP_MIGRATION_PLAN
}={}){
  if(!shopDb||typeof shopDb.prepare!=='function'||!scope||
    !UUID.test(scope.shopId)||!UUID.test(scope.databaseId)||
    !UUID.test(scope.databaseMarker)||
    !isOwnerReadyShopMigrationPlan(plan)||
    typeof provider?.verifyTarget!=='function'||
    typeof provider?.prepareShop!=='function')denied();
  try{
    if(await provider.verifyTarget(scope,shopDb)!==true)denied();
    await provider.prepareShop(scope);
    if(await provider.verifyTarget(scope,shopDb)!==true)denied();
    if(!await pilotShopIdentityMatches({
      shopId:scope.shopId,databaseId:scope.databaseId,
      databaseMarker:scope.databaseMarker,shopDb
    }))denied();
    const {receipts,schema}=await readPortP2ShopCheckpoint(shopDb);
    if(receipts.length!==plan.length||!matchesPortP2MigrationPrefix(receipts,plan)||
      receipts.at(-1)?.schema!==schema)denied();
    const payload=JSON.stringify(receipts.map(r=>[
      r.position,r.name,r.checksum
    ]));
    const digest=hex(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(payload)));
    return Object.freeze({
      shopId:scope.shopId,databaseId:scope.databaseId,
      marker:scope.databaseMarker,schemaRevision:'owner-ready-v1',
      receiptDigest:digest
    });
  }catch{denied();}
}
