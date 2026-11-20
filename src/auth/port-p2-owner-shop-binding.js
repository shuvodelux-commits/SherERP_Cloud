import { hashOpaqueSessionToken } from './session-token.js';
import { prepareCurrentOwnerPlacement } from './platform-owner-sessions.js';
import { pilotShopIdentityMatches } from './platform-shop-binding.js';
import { matchesPortP2MigrationPrefix, readPortP2ShopCheckpoint } from '../db/port-p2-shop-schema.js';

const sameShop = (left, right) => left?.shopId === right.shopId &&
  left.databaseId === right.databaseId && left.databaseMarker === right.databaseMarker;

function prepareReadyPlacement(control, shopId) {
  return control.prepare(`SELECT binding_key AS binding, minimum_generation AS minimumGeneration
    FROM port_p2_shop_placements WHERE shop_id=? AND ready=1`).bind(shopId);
}

/** Read-only PORT-00 candidate. Only the server passes the deployed roster.
 * This is not an Owner login or a Shop D1 write grant.
 */
export async function resolvePortP2OwnerShop(env, token, roster) {
  try {
    const hash = await hashOpaqueSessionToken(token);
    if (!hash) return { status: 'denied' };
    const control = env.CONTROL_DB;
    const owner = await prepareCurrentOwnerPlacement(control, hash).first();
    if (!owner) return { status: 'denied' };

    const placement = await prepareReadyPlacement(control, owner.shopId).first();
    const published = roster?.shops?.find(shop => shop.shopId === owner.shopId);
    if (!placement || !published || !sameShop(published, owner) ||
        published.binding !== placement.binding || !/^SHOP_[A-Z0-9_]+$/.test(published.binding) ||
        !Object.hasOwn(env, published.binding) || !Number.isSafeInteger(roster.generation) ||
        roster.generation < placement.minimumGeneration ||
        roster.shops.filter(shop => shop.shopId === owner.shopId || shop.binding === published.binding).length !== 1) {
      return { status: 'unavailable' };
    }

    const shopDb = env[published.binding];
    if (!await pilotShopIdentityMatches({ ...owner, shopDb })) return { status: 'unavailable' };
    const { receipts, schema } = await readPortP2ShopCheckpoint(shopDb);
    if (!matchesPortP2MigrationPrefix(receipts, roster.migrations) ||
        receipts.length !== roster.migrations.length || receipts.at(-1)?.schema !== schema) {
      return { status: 'unavailable' };
    }

    // Recheck app authority and placement in the same Control D1 snapshot
    // after reading Shop D1. The result is scoped to this read request.
    const [sessionCheck, placementCheck] = await control.batch([
      prepareCurrentOwnerPlacement(control, hash), prepareReadyPlacement(control, owner.shopId)
    ]);
    if (!sessionCheck.success || !placementCheck.success) return { status: 'unavailable' };
    if (!sameShop(sessionCheck.results[0], owner)) return { status: 'denied' };
    const [currentPlacement] = placementCheck.results;
    if (currentPlacement?.binding !== placement.binding ||
        currentPlacement.minimumGeneration !== placement.minimumGeneration) {
      return { status: 'unavailable' };
    }
    return { status: 'ready', shopId: owner.shopId, shopDb };
  } catch {
    return { status: 'unavailable' };
  }
}
