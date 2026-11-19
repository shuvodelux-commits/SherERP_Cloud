import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {publishOwnerWriteGrant} from '../../src/db/shop-owner-write-grant.js';

// The generation still comes from trusted fixture orchestration.
export function publishFixtureOwnerGrant(env,token,generation){
  const scope=pilotShopConfiguration(env);
  return publishOwnerWriteGrant(scope.shopDb,scope,token,generation);
}
