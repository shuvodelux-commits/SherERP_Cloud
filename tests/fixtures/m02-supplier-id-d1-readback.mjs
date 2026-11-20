/**
 * TEST-ONLY local D1 Supplier source-ID and Party role readback.
 * NO operational Worker, no live issuer, no source import, no posting.
 * Uses the M03 synthetic issuer schema plus two physically separate D1s.
 */
import {reviewCleanShopSupplierReceiptShape} from '../../src/party/m02-clean-shop-supplier-identity.js';

export const SYNTHETIC_M02_SUPPLIER_DDL=Object.freeze([
  `CREATE TABLE m02_test_supplier_parties(
    tenant_id TEXT NOT NULL, party_id TEXT NOT NULL, name TEXT NOT NULL,
    PRIMARY KEY(tenant_id,party_id)
  ) STRICT`,
  `CREATE TABLE m02_test_supplier_links(
    tenant_id TEXT NOT NULL, source_group TEXT NOT NULL, source_id TEXT NOT NULL,
    party_id TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,
    link_basis TEXT NOT NULL,
    PRIMARY KEY(tenant_id,source_group,source_id),
    FOREIGN KEY(tenant_id,party_id)
      REFERENCES m02_test_supplier_parties(tenant_id,party_id)
  ) STRICT`
]);

const validShopId=x=>typeof x==='string'&&/^[A-Z0-9][A-Z0-9_-]{0,127}$/.test(x);
const genericError=()=>new Error('Synthetic Shop D1 Supplier readback unavailable');

async function select(DB,sql){
  if(!DB||typeof DB.prepare!=='function')throw genericError();
  try{
    const result=await DB.prepare(sql).all();
    if(result?.success!==true||!Array.isArray(result.results))
      throw genericError();
    return result.results;
  }catch{
    throw genericError();
  }
}
const RECEIPTS=`SELECT r.tenant_id,r.id_key,r.operation_id,r.intent_hash,
 r.issued_sequence,c.prefix
 FROM synthetic_m03_id_receipts r
 JOIN synthetic_m03_id_counters c
 ON c.tenant_id=r.tenant_id AND c.id_key=r.id_key
 ORDER BY r.tenant_id,r.id_key,r.operation_id`;
const LINKS=`SELECT tenant_id,source_group,source_id,party_id,role,status,link_basis
 FROM m02_test_supplier_links
 ORDER BY tenant_id,source_group,source_id`;

/**
 * One trusted test runner supplies D1 bindings; Shop IDs are not verified
 * actors or credentials. Never expose this function as an RPC.
 * Outputs only redacted counts/codes and hard NO-GO flags.
 */
export async function auditLocalSupplierD1({shops}={}){
  if(!Array.isArray(shops)||shops.length===0||
     shops.some(x=>!x||!validShopId(x.shopId)||!x.DB))
    throw genericError();

  let foreign=0;
  const snapshot=[];
  for(const {shopId,DB} of shops){
    const receipts=await select(DB,RECEIPTS);
    const links=await select(DB,LINKS);
    foreign+=receipts.filter(r=>r.tenant_id!==shopId).length+
      links.filter(r=>r.tenant_id!==shopId).length;
    snapshot.push({
      shopId,
      receipts:receipts.filter(r=>r.tenant_id===shopId).map(r=>({
        sourceGroup:r.id_key,
        sourceId:r.prefix+'-'+String(r.issued_sequence).padStart(6,'0'),
        sequence:r.issued_sequence,
        operationId:r.operation_id,
        intentHash:r.intent_hash
      })),
      links:links.filter(r=>r.tenant_id===shopId).map(r=>({
        sourceGroup:r.source_group,sourceId:r.source_id,
        partyId:r.party_id,role:r.role,status:r.status,
        linkBasis:r.link_basis
      }))
    });
  }
  let base;
  try{base=reviewCleanShopSupplierReceiptShape({shops:snapshot});}
  catch{throw genericError();}
  if(!foreign)return base;
  const blockers=[...base.blockers,{code:'FOREIGN_SHOP_D1_ROW',count:foreign}]
    .sort((a,b)=>a.code.localeCompare(b.code));
  return {
    ...base,
    syntheticReceiptShapeValid:false,
    blockers,
    sqlIssuanceAuthorized:false,
    historicalReconciled:false,
    financialPostingReady:false
  };
}
