import {requireD1Binding} from './d1-binding.js';

const SOURCE_GROUPS = new Set(['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES']);
const EXACT_LEGACY_LINK = `SELECT party_id FROM party_legacy_links
  WHERE source_group = ? AND source_id = ? AND status = 'ACTIVE'
  LIMIT 1`;

/** Resolve only an exact, source-traceable active Party link. Never merge by name/phone. */
export async function resolveLegacyPartyId(env,sourceGroup,sourceId) {
  if(!SOURCE_GROUPS.has(sourceGroup)) throw new TypeError('Unsupported Party source group');
  if(typeof sourceId!=='string' || !sourceId.trim()) throw new TypeError('Invalid Party source ID');
  const db=requireD1Binding(env);
  const result=await db.prepare(EXACT_LEGACY_LINK).bind(sourceGroup,sourceId).first();
  if (result===null) return null;
  if(!result || typeof result.party_id!=='string' || !result.party_id.trim()) {
    throw new Error('Invalid D1 Party identity result');
  }
  return result.party_id;
}
