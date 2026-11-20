/**
 * M02 clean-shop Supplier receipt SHAPE review only.
 *
 * This is a deterministic synthetic evidence checker, NOT the D1 counter,
 * operation receipt issuer, Party master writer, or authorization boundary.
 * Historical original IDs/counter floors require separate M02 reconciliation.
 */
import {originalSourceIdPrefix} from '../db/m03-source-id-families.js';

const error=()=>new Error('Supplier receipt shape unavailable');
const shopID=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;
const partyID=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const operationID=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const intent=/^[a-f0-9]{64}$/;
const sourceID=/^SUP-([0-9]{6,})$/;
const isPlain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
  Object.values(Object.getOwnPropertyDescriptors(x)).every(p=>Object.hasOwn(p,'value'));

function isValidSupplierId(sourceId,sequence) {
  if(typeof sourceId!=='string'||!Number.isSafeInteger(sequence)||sequence<1)
    return false;
  const match=sourceID.exec(sourceId);
  return match!==null &&
    originalSourceIdPrefix('SUPPLIERS')==='SUP' &&
    match[1]===String(sequence).padStart(6,'0');
}
/**
 * Caller supplies only synthetic snapshots; this does NOT attest D1 origin.
 * Results are sanitized and never include Party, Shop, operation or Source IDs.
 */
export function reviewCleanShopSupplierReceiptShape(input) {
  if(!isPlain(input)||!Array.isArray(input.shops)||input.shops.length<1||
    input.shops.some(shop=>!isPlain(shop)||typeof shop.shopId!=='string'||
      !shopID.test(shop.shopId)||!Array.isArray(shop.receipts)||
      !Array.isArray(shop.links)||
      shop.receipts.some(x=>!isPlain(x))||
      shop.links.some(x=>!isPlain(x))))
    throw error();

  const problems=new Map();
  const block=code=>problems.set(code,(problems.get(code)||0)+1);
  const knownShops=new Set();
  let receiptsCount=0,linksCount=0;
  for(const shop of input.shops) {
    receiptsCount+=shop.receipts.length;
    linksCount+=shop.links.length;
    if(knownShops.has(shop.shopId))block('DUPLICATE_SHOP_SCOPE');
    knownShops.add(shop.shopId);
    const sources=new Map();
    const operations=new Map();
    const links=new Map();
    for(const receipt of shop.receipts) {
      const valid=receipt.sourceGroup==='SUPPLIERS'&&
        isValidSupplierId(receipt.sourceId,receipt.sequence)&&
        typeof receipt.operationId==='string'&&operationID.test(receipt.operationId)&&
        typeof receipt.intentHash==='string'&&intent.test(receipt.intentHash);
      if(!valid){
        block('INVALID_SUPPLIER_RECEIPT');
        continue;
      }
      if(sources.has(receipt.sourceId))block('DUPLICATE_SHOP_SUPPLIER_ID');
      if(operations.has(receipt.operationId))block('DUPLICATE_SHOP_OPERATION_ID');
      sources.set(receipt.sourceId,receipt);
      operations.set(receipt.operationId,receipt);
    }
    for(const link of shop.links) {
      const valid=link.sourceGroup==='SUPPLIERS'&&
        typeof link.sourceId==='string'&&
        isValidSupplierId(link.sourceId,Number(link.sourceId.slice(4)))&&
        typeof link.partyId==='string'&&partyID.test(link.partyId)&&
        link.role==='Supplier'&&link.status==='ACTIVE'&&
        link.linkBasis==='NEW_RECORD';
      if(!valid){
        block('SUPPLIER_PARTY_LINK_INVALID');
        continue;
      }
      if(links.has(link.sourceId))block('DUPLICATE_SHOP_SUPPLIER_LINK');
      links.set(link.sourceId,link);
    }
    for(const [id] of sources)if(!links.has(id))
      block('SUPPLIER_PARTY_LINK_MISSING');
    for(const [id] of links)if(!sources.has(id))
      block('ORPHAN_SHOP_SUPPLIER_LINK');
  }
  const blockers=[...problems].sort(([a],[b])=>a.localeCompare(b))
    .map(([code,count])=>({code,count}));
  return {
    syntheticReceiptShapeValid:blockers.length===0,
    counts:{shops:input.shops.length,receipts:receiptsCount,supplierLinks:linksCount},
    blockers,
    sqlIssuanceAuthorized:false,
    historicalReconciled:false,
    financialPostingReady:false
  };
}
