/**
 * Isolated synthetic D1 acceptance proof. NEVER import into src/, RPC or a
 * deployed Worker: no ERP source provenance, Cash/Bank, M07 or M08 posting.
 * Positive integer base units only; costs are INTEGER BDT paisa per base unit.
 */
const KEY=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOKEN=/^[a-f0-9]{64}$/;
const EXPECTED=['tenantId','actorId','tokenHash','operationId','productId','purchaseId','purchaseLotId','expectedPurchaseRevision','expectedPurchaseRemainingUnits','now','allocations'].sort();
function parse(input) {
 if(!input||typeof input!=='object'||Array.isArray(input)||!([Object.prototype,null].includes(Object.getPrototypeOf(input))))throw new TypeError('Invalid synthetic settlement request');
 const keys=Reflect.ownKeys(input);
 if(keys.length!==EXPECTED.length||keys.some(k=>typeof k!=='string'||!Object.hasOwn(input,k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(input,k),'value'))||keys.sort().join('|')!==EXPECTED.join('|'))throw new TypeError('Invalid synthetic settlement request fields');
 const o={};for(const k of EXPECTED)o[k]=Object.getOwnPropertyDescriptor(input,k).value;
 for(const k of ['tenantId','actorId','operationId','productId','purchaseId','purchaseLotId'])if(typeof o[k]!=='string'||!KEY.test(o[k]))throw new TypeError('Invalid synthetic settlement identity');
 if(typeof o.tokenHash!=='string'||!TOKEN.test(o.tokenHash)||!Number.isSafeInteger(o.now)||o.now<0||!Number.isSafeInteger(o.expectedPurchaseRevision)||o.expectedPurchaseRevision<1||!Number.isSafeInteger(o.expectedPurchaseRemainingUnits)||o.expectedPurchaseRemainingUnits<1)throw new TypeError('Invalid synthetic session or stock version');
 if(!Array.isArray(o.allocations)||!o.allocations.length||o.allocations.length>20)throw new TypeError('Invalid synthetic settlement allocations');
 const ids=new Set();o.allocations=o.allocations.map(a=>{
   if(!a||typeof a!=='object'||Array.isArray(a)||!([Object.prototype,null].includes(Object.getPrototypeOf(a))))throw new TypeError('Invalid synthetic settlement allocation');
   const fields=Reflect.ownKeys(a);
   if(fields.length!==4||fields.some(k=>typeof k!=='string'||!['oversoldLotId','expectedRevision','expectedRemainingUnits','units'].includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(a,k),'value')))throw new TypeError('Invalid synthetic settlement allocation fields');
   const x={};for(const k of ['oversoldLotId','expectedRevision','expectedRemainingUnits','units'])x[k]=Object.getOwnPropertyDescriptor(a,k).value;
   if(typeof x.oversoldLotId!=='string'||!KEY.test(x.oversoldLotId)||!Number.isSafeInteger(x.expectedRevision)||x.expectedRevision<1||!Number.isSafeInteger(x.expectedRemainingUnits)||x.expectedRemainingUnits>=0||!Number.isSafeInteger(x.units)||x.units<1||x.units>1000000||ids.has(x.oversoldLotId))throw new TypeError('Invalid synthetic settlement allocation identity/quantity');
   ids.add(x.oversoldLotId);return x;
 });
 return o;
}
const AUTH=`SELECT 1 FROM m03_os_sessions s JOIN m03_os_users u ON u.tenant_id=s.tenant_id AND u.user_id=s.user_id JOIN m03_os_roles r ON r.tenant_id=s.tenant_id AND r.role_id=s.role_id WHERE s.token_hash=? AND s.tenant_id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.active=1 AND r.active=1 AND r.can_post=1 AND u.role_id=s.role_id AND s.role_id=r.role_id AND u.auth_version=s.user_version AND r.auth_version=s.role_version`;
const CLAIM=`WITH wanted AS (
 SELECT json_extract(value,'$.oversoldLotId') AS id,
 CAST(json_extract(value,'$.expectedRevision') AS INTEGER) AS expected_revision,
 CAST(json_extract(value,'$.expectedRemainingUnits') AS INTEGER) AS expected_remaining,
 CAST(json_extract(value,'$.units') AS INTEGER) AS qty FROM json_each(?)
)
INSERT INTO m03_os_receipts(tenant_id,operation_id,actor_id,product_id,purchase_id,purchase_lot_id,expected_purchase_revision,expected_purchase_remaining,allocations_json,total_units,provisional_cost_paisa,actual_cost_paisa,variance_paisa,intent_hash,committed_at)
SELECT ?,?,?,?,?,?,?,?,?,
 (SELECT SUM(qty) FROM wanted),
 (SELECT SUM(n.unit_cost_paisa*w.qty) FROM wanted w JOIN m03_os_lots n ON n.tenant_id=? AND n.lot_id=w.id),
 p.unit_cost_paisa*(SELECT SUM(qty) FROM wanted),
 (SELECT SUM(n.unit_cost_paisa*w.qty) FROM wanted w JOIN m03_os_lots n ON n.tenant_id=? AND n.lot_id=w.id)-p.unit_cost_paisa*(SELECT SUM(qty) FROM wanted),
 ?,?
FROM m03_os_lots p
WHERE p.tenant_id=? AND p.product_id=? AND p.lot_id=? AND p.purchase_id=? AND p.kind='PURCHASE'
AND p.version=? AND p.remaining_units=? AND p.remaining_units>= (SELECT SUM(qty) FROM wanted)
AND (SELECT COUNT(*) FROM wanted) BETWEEN 1 AND 20
AND (SELECT COUNT(*) FROM wanted w JOIN m03_os_lots n ON n.tenant_id=p.tenant_id AND n.product_id=p.product_id AND n.lot_id=w.id AND n.kind='OVERSOLD' AND n.purchase_id='OVERSOLD' AND n.version=w.expected_revision AND n.remaining_units=w.expected_remaining AND n.remaining_units<=-w.qty AND n.occurred_at<=p.occurred_at)=(SELECT COUNT(*) FROM wanted)
AND EXISTS (${AUTH})
ON CONFLICT DO NOTHING RETURNING operation_id`;
const READ=`SELECT tenant_id,operation_id,actor_id,product_id,purchase_id,purchase_lot_id,allocations_json,total_units,provisional_cost_paisa,actual_cost_paisa,variance_paisa,intent_hash FROM m03_os_receipts WHERE tenant_id=? AND operation_id=? AND actor_id=? AND EXISTS (${AUTH}) LIMIT 2`;
function readRows(p){if(!p||p.success!==true||!Array.isArray(p.results))throw new Error('NEEDS_REVIEW: invalid D1 oversold settlement results');return p.results;}
async function sha256(s){const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return Array.from(new Uint8Array(data),n=>n.toString(16).padStart(2,'0')).join('');}
export function createSyntheticOversoldSettlementProof(DB){
 if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')throw new TypeError('D1 batch unavailable');
 return Object.freeze({async settle(input){
  const x=parse(input);const json=JSON.stringify(x.allocations);
  const intentHash=await sha256(JSON.stringify({type:'m03.synthetic.oversold.settle.v1',tenantId:x.tenantId,actorId:x.actorId,operationId:x.operationId,productId:x.productId,purchaseId:x.purchaseId,purchaseLotId:x.purchaseLotId,expectedPurchaseRevision:x.expectedPurchaseRevision,expectedPurchaseRemainingUnits:x.expectedPurchaseRemainingUnits,allocations:x.allocations}));
  const auth=[x.tokenHash,x.tenantId,x.actorId,x.now];let results;
  try{results=await DB.batch([
    DB.prepare(CLAIM).bind(json,x.tenantId,x.operationId,x.actorId,x.productId,x.purchaseId,x.purchaseLotId,x.expectedPurchaseRevision,x.expectedPurchaseRemainingUnits,json,x.tenantId,x.tenantId,intentHash,'2026-11-19T16:00:00Z',x.tenantId,x.productId,x.purchaseLotId,x.purchaseId,x.expectedPurchaseRevision,x.expectedPurchaseRemainingUnits,...auth),
    DB.prepare(READ).bind(x.tenantId,x.operationId,x.actorId,...auth)
  ]);}catch(e){throw new Error('NEEDS_REVIEW: synthetic D1 settlement outcome uncertain',{cause:e});}
  if(!Array.isArray(results)||results.length!==2)throw new Error('NEEDS_REVIEW: malformed D1 settlement batch');
  const [claims,receipts]=results.map(readRows);
  if(claims.length>1||receipts.length>1||claims.some(row=>row.operation_id!==x.operationId))throw new Error('NEEDS_REVIEW: ambiguous D1 settlement evidence');
  if(!receipts.length){if(claims.length)throw new Error('NEEDS_REVIEW: missing committed settlement receipt');return {status:'DECLINED',operationId:x.operationId};}
  const row=receipts[0];if(row.tenant_id!==x.tenantId||row.operation_id!==x.operationId||row.actor_id!==x.actorId||row.product_id!==x.productId||row.purchase_id!==x.purchaseId||row.purchase_lot_id!==x.purchaseLotId||!Number.isSafeInteger(row.total_units)||!Number.isSafeInteger(row.variance_paisa)||typeof row.intent_hash!=='string'||row.intent_hash.length!==64)throw new Error('NEEDS_REVIEW: malformed settlement receipt');
  if(row.intent_hash!==intentHash||row.allocations_json!==json)return {status:'CONFLICT',operationId:x.operationId};
  return {status:claims.length?'COMMITTED':'REPLAY',operationId:x.operationId,purchaseRemainingUnits:x.expectedPurchaseRemainingUnits-row.total_units,settledUnits:row.total_units,variancePaisa:row.variance_paisa};
 }});
}
