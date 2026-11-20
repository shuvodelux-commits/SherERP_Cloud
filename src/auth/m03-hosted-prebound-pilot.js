/** Bridge the EXISTING local Control Center state machine to ONE reviewed,
 * pre-bound hosted pilot Shop D1. No Cloudflare API, no dynamic creation,
 * no DDL execution from a public request. Everything remains fail-closed.
 */
import {pilotShopConfiguration,pilotShopIdentityMatches} from './platform-shop-binding.js';
import {OWNER_READY_SHOP_MIGRATION_PLAN} from '../db/m03-owner-ready-shop-migrations.js';
import {readPortP2ShopCheckpoint,matchesPortP2MigrationPrefix} from '../db/port-p2-shop-schema.js';

const BINDING='SHOP_PILOT_DB';
const HOSTED_BINDING='PLATFORM_PILOT_DB';
export async function verifiedPreboundPilot(env){
  if(env?.PLATFORM_HOSTED_PILOT_ENABLED!=='true'||
    env.PLATFORM_SHOP_RESERVATION_ENABLED!=='true')return null;
  const pilot=pilotShopConfiguration(env);
  if(!pilot||env[HOSTED_BINDING]!==pilot.shopDb)return null;
  if(!await pilotShopIdentityMatches(pilot))return null;
  try{
    const {receipts,schema}=await readPortP2ShopCheckpoint(pilot.shopDb);
    if(receipts.length!==OWNER_READY_SHOP_MIGRATION_PLAN.length||
      !matchesPortP2MigrationPrefix(receipts,OWNER_READY_SHOP_MIGRATION_PLAN)||
      receipts.at(-1).schema!==schema)return null;
  }catch{return null;}
  return pilot;
}

export async function attachHostedPilot(env){
  const pilot=await verifiedPreboundPilot(env);
  if(!pilot)return env;
  const inventory=[{id:pilot.databaseId,binding:BINDING}];
  const receipt=action=>({
    ...action,id:pilot.databaseId,binding:BINDING,
    evidenceRef:'prebound-reconciled-v1'
  });
  const provider={
    // The database was already created, migrated and bound by the approved
    // operator. These methods NEVER create a Cloudflare resource.
    async createDatabase(action){
      if(!await verifiedPreboundPilot(env))throw Error('PREBOUND_PILOT_UNAVAILABLE');
      return receipt(action);
    },
    async findCreation(action){
      if(!await verifiedPreboundPilot(env))throw Error('PREBOUND_PILOT_UNAVAILABLE');
      return receipt(action);
    },
    async verifyTarget(scope,shopDb){
      return shopDb===pilot.shopDb && scope.shopId===pilot.shopId &&
        scope.databaseId===pilot.databaseId &&
        scope.databaseMarker===pilot.databaseMarker &&
        scope.binding===BINDING && !!await verifiedPreboundPilot(env);
    },
    async prepareShop(scope){
      if(scope.shopId!==pilot.shopId || !await verifiedPreboundPilot(env))
        throw Error('PREBOUND_PILOT_UNAVAILABLE');
    },
  };
  // Reuse existing Create/Resume/list/Owner approval, with ONE exact physical
  // D1 binding. The test-only Support Mode still requires its own
  // non-serializable local gate and remains unavailable in hosted Workers.
  return {
    ...env,[BINDING]:pilot.shopDb,PLATFORM_LOCAL_PROVISIONING_ENABLED:'true',
    PLATFORM_LOCAL_OWNER_READY_ENABLED:'true',
    PLATFORM_LOCAL_SHOP_INVENTORY:inventory,
    PLATFORM_LOCAL_SHOP_MIGRATIONS:OWNER_READY_SHOP_MIGRATION_PLAN,
    PLATFORM_LOCAL_SHOP_PROVIDER:provider,
  };
}
