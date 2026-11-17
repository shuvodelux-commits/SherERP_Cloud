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


const EXACT_SOURCE_ROW_LINK=`SELECT
    l.party_id,l.source_group,l.source_id,l.legacy_sheet_row,
    l.link_basis,p.status AS party_status
  FROM party_legacy_links AS l
  JOIN parties AS p ON p.party_id=l.party_id
  WHERE l.source_group = ? AND l.source_id = ? AND l.legacy_sheet_row = ?
    AND l.status = 'ACTIVE'
  LIMIT 2`;

function validProvenanceInput(value){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value))){
    throw new TypeError('Invalid Party source provenance input shape');
  }
  const wanted=['sourceGroup','sourceId','legacySheetRow'];
  const keys=Reflect.ownKeys(value);
  if(keys.length!==wanted.length ||
     keys.some(key=>typeof key!=='string' || !wanted.includes(key)) ||
     wanted.some(key=>{
       const field=Object.getOwnPropertyDescriptor(value,key);
       return !field?.enumerable || !Object.hasOwn(field,'value');
     })){
    throw new TypeError('Invalid Party source provenance fields');
  }
  const {sourceGroup,sourceId,legacySheetRow}=value;
  if(typeof sourceGroup!=='string' || !SOURCE_GROUPS.has(sourceGroup) ||
     typeof sourceId!=='string' || !sourceId.trim() ||
     !Number.isSafeInteger(legacySheetRow) || legacySheetRow<2){
    throw new TypeError('Invalid Party source ID, group or physical row');
  }
  return {sourceGroup,sourceId,legacySheetRow};
}

/**
 * Internal historical source-identity lookup keyed by ALL three source facts.
 * A physical Sheet row number is never a Party identity on its own; missing
 * provenance must go to M02 review, not a fallback by phone/name/row proximity.
 *
 * Returns identity evidence only, NOT authority to post, settle, merge or net
 * Party accounts. INACTIVE Parties remain resolvable for historical documents.
 * Existing M02 review/approval policy remains a separate integration gate.
 */
export async function resolveLegacyPartyByProvenance(env,input){
  const {sourceGroup,sourceId,legacySheetRow}=validProvenanceInput(input);
  const DB=requireD1Binding(env);
  const found=await DB.prepare(EXACT_SOURCE_ROW_LINK)
    .bind(sourceGroup,sourceId,legacySheetRow).all();
  if(found?.success!==true || !Array.isArray(found.results) ||
     found.results.length>1){
    throw new Error('Invalid or ambiguous D1 Party source provenance result');
  }
  if(found.results.length===0)return null;
  const row=found.results[0];
  if(!row || typeof row!=='object' ||
     typeof row.party_id!=='string' || !row.party_id.trim() ||
     row.source_group!==sourceGroup || row.source_id!==sourceId ||
     row.legacy_sheet_row!==legacySheetRow ||
     !['ORIGINAL_RECORD','HUMAN_VERIFIED'].includes(row.link_basis) ||
     !['ACTIVE','INACTIVE'].includes(row.party_status)){
    throw new Error('Invalid or mismatched D1 Party source provenance identity');
  }
  return {
    partyId:row.party_id,sourceGroup,sourceId,legacySheetRow,
    linkBasis:row.link_basis,partyStatus:row.party_status
  };
}
