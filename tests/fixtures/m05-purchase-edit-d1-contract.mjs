/**
 * Test-only m05ml_* local D1 atomic purchase edit caller.
 * Not a public RPC, auth handler, deployed posting kernel or M07 correction
 * engine. Financial writes and validation are authoritative in a SQLite
 * claim/trigger with immutable original purchase and ledger source rows.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const LIMIT=1_000_000_000;

const SQL_CLAIM=`INSERT OR IGNORE INTO m05ml_edit_receipts(
 tenant_id,purchase_id,operation_id,actor_id,intent_hash,reason,
 new_items_json,subtotal_paisa,grand_paisa,due_paisa)
 SELECT ?,?,?,?,?,?,?,?,MAX(0,?-p.discount_paisa),
 MAX(0,?-p.discount_paisa)-p.paid_paisa
 FROM m05ml_purchases p WHERE p.tenant_id=? AND p.purchase_id=?
 AND p.due_paisa>0
 AND MAX(0,?-p.discount_paisa)>=p.paid_paisa
 AND EXISTS(SELECT 1 FROM m05ml_sessions s
 WHERE s.tenant_id=p.tenant_id AND s.state='Open')
 AND EXISTS(SELECT 1 FROM m05ml_suppliers s JOIN m05ml_party_links l
 ON l.tenant_id=s.tenant_id AND l.source_group='SUPPLIERS'
 AND l.source_id=s.supplier_id AND l.party_id=s.party_id AND l.reviewed=1
 WHERE s.tenant_id=p.tenant_id AND s.supplier_id=p.supplier_id AND s.active=1)
 AND NOT EXISTS(SELECT 1 FROM m05ml_delete_receipts d
 WHERE d.tenant_id=p.tenant_id AND d.purchase_id=p.purchase_id)
 AND NOT EXISTS(SELECT 1 FROM m05ml_purchase_returns rr
 WHERE rr.tenant_id=p.tenant_id AND rr.purchase_id=p.purchase_id AND rr.active=1)
 AND NOT EXISTS(SELECT 1 FROM m05ml_purchase_settlements ss
 WHERE ss.tenant_id=p.tenant_id AND ss.purchase_id=p.purchase_id AND ss.active=1)
 AND NOT EXISTS(SELECT 1 FROM m05ml_purchases later
 JOIN m05ml_supplier_ledger sl ON sl.tenant_id=later.tenant_id
 AND sl.purchase_id=later.purchase_id
 WHERE later.tenant_id=p.tenant_id AND later.supplier_id=p.supplier_id
 AND later.rowid>p.rowid)
 AND EXISTS(SELECT 1 FROM m05ml_items i
 WHERE i.tenant_id=p.tenant_id AND i.purchase_id=p.purchase_id)
 AND (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=p.tenant_id AND i.purchase_id=p.purchase_id)=
 (SELECT COUNT(*) FROM json_each(?))
 AND (SELECT COUNT(*) FROM m05ml_lots lt
 WHERE lt.tenant_id=p.tenant_id AND lt.purchase_id=p.purchase_id)=
 (SELECT COUNT(*) FROM m05ml_items i
 WHERE i.tenant_id=p.tenant_id AND i.purchase_id=p.purchase_id)
 AND NOT EXISTS(SELECT 1 FROM json_each(?) j
 LEFT JOIN m05ml_items i ON i.tenant_id=p.tenant_id
 AND i.purchase_id=p.purchase_id AND i.sku=json_extract(j.value,'$.sku')
 LEFT JOIN m05ml_lots lt ON lt.tenant_id=i.tenant_id
 AND lt.purchase_id=i.purchase_id AND lt.sku=i.sku
 LEFT JOIN m05ml_products pr ON pr.tenant_id=i.tenant_id AND pr.sku=i.sku
 WHERE i.sku IS NULL OR lt.lot_id IS NULL OR pr.sku IS NULL
 OR pr.active<>1 OR pr.deleted<>0 OR pr.product_type<>'Standard'
 OR pr.version<>json_extract(j.value,'$.expectedVersion')
 OR lt.qty<>i.qty OR lt.remaining_qty<0 OR lt.remaining_qty>lt.qty
 OR (lt.remaining_qty<lt.qty
     AND json_extract(j.value,'$.costPaisa')<>lt.cost_paisa)
 OR lt.remaining_qty+json_extract(j.value,'$.qty')-i.qty<0
 OR (json_extract(j.value,'$.qty')<i.qty
 AND pr.stock+json_extract(j.value,'$.qty')-i.qty<0))
 RETURNING purchase_id,operation_id,actor_id,intent_hash,due_paisa`;
const SQL_LOOKUP=`SELECT e.purchase_id,e.operation_id,e.actor_id,
 e.intent_hash,e.due_paisa,a.lines_changed
 FROM m05ml_edit_receipts e LEFT JOIN m05ml_edit_audit a
 ON a.tenant_id=e.tenant_id AND a.purchase_id=e.purchase_id
 WHERE e.tenant_id=? AND e.operation_id=?`;

const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exactKeys=(x,keys)=>record(x)&&
  Reflect.ownKeys(x).sort().join(',')===keys.slice().sort().join(',');
function cost(value){
  if(typeof value!=='string'|| !/^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/.test(value))
    throw new TypeError('Exact integer-paisa purchase unit cost required');
  const [major,minor='']=value.split('.');
  const paisa=100*Number(major)+Number(minor.padEnd(2,'0'));
  if(!Number.isSafeInteger(paisa)||paisa>LIMIT)
    throw new RangeError('Purchase unit cost overflow');
  return paisa;
}
function parse(input){
  if(!exactKeys(input,['tenantId','actorId','purchaseId','operationId','reason','items'])
    || !ID.test(input.tenantId||'')||!ID.test(input.actorId||'')
    ||!ID.test(input.purchaseId||'')||!OP.test(input.operationId||'')
    ||typeof input.reason!=='string'||input.reason.trim().length<1
    ||input.reason.length>200||/[\x00-\x1f\x7f]/.test(input.reason)
    ||!Array.isArray(input.items)||input.items.length<1||input.items.length>10)
    throw new TypeError('Invalid synthetic purchase edit envelope');
  const seen=new Set();let subtotal=0;
  const lines=input.items.map(item=>{
    if(!exactKeys(item,['sku','qty','unitPrice','expectedVersion'])
      ||!ID.test(item.sku||'')||!Number.isSafeInteger(item.qty)
      ||item.qty<1||item.qty>1_000_000
      ||!Number.isSafeInteger(item.expectedVersion)
      ||item.expectedVersion<1||item.expectedVersion>1_000_000)
      throw new TypeError('Invalid synthetic purchase edit SKU or quantity');
    if(seen.has(item.sku))throw new TypeError('Duplicate SKU in purchase correction');
    seen.add(item.sku);
    const costPaisa=cost(item.unitPrice);
    subtotal+=item.qty*costPaisa;
    if(!Number.isSafeInteger(subtotal)||subtotal>LIMIT)
      throw new RangeError('Purchase edit subtotal overflow');
    return {sku:item.sku,qty:item.qty,expectedVersion:item.expectedVersion,costPaisa};
  });
  return {lines,subtotal};
}
const rows=result=>{
  if(result?.success!==true||!Array.isArray(result.results))
    throw new Error('NEEDS_REVIEW: missing authoritative D1 edit result');
  return result.results;
};

export function createSyntheticPurchaseEditor(DB,{beforeBatch}={}){
  if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
    throw new Error('Synthetic local D1 edit binding required');
  if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
    throw new TypeError('Invalid test-only beforeBatch callback');
  return Object.freeze({
    async edit(input){
      const {lines,subtotal}=parse(input);
      const {tenantId,actorId,purchaseId,operationId,reason}=input;
      const hash=await hashCanonicalOperationIntent({
        tenantId,actorId,operationType:'purchase.edit.synthetic',
        payload:{purchaseId,reason,lines}
      });
      const itemsJson=JSON.stringify(lines);
      if(beforeBatch)await beforeBatch({tenantId,purchaseId,operationId});
      let result;
      try{
        result=await DB.batch([
          DB.prepare(SQL_CLAIM).bind(
            tenantId,purchaseId,operationId,actorId,hash,reason,
            itemsJson,subtotal,subtotal,subtotal,tenantId,purchaseId,
            subtotal,itemsJson,itemsJson
          ),
          DB.prepare(SQL_LOOKUP).bind(tenantId,operationId)
        ]);
      }catch{
        // A lost response can happen after a successful commit; never assert
        // rollback from network failure or silently issue a fresh operation.
        throw new Error('NEEDS_REVIEW: purchase edit commit uncertain; reconcile operation ID');
      }
      if(!Array.isArray(result)||result.length!==2)
        throw new Error('NEEDS_REVIEW: ambiguous purchase edit batch');
      const [claim,lookup]=result.map(rows);
      const found=lookup.length===1?lookup[0]:null;
      const same=found?.actor_id===actorId&&found?.intent_hash===hash
        &&found?.purchase_id===purchaseId
        &&Number.isSafeInteger(found?.lines_changed);
      if(claim.length===1&&same)return {
        status:'COMMITTED',operationId,purchaseId,
        newDuePaisa:found.due_paisa,linesChanged:found.lines_changed
      };
      if(claim.length===0){
        if(!found)return {status:'DECLINED',operationId};
        if(same)return {status:'REPLAY',operationId,purchaseId,
          newDuePaisa:found.due_paisa,linesChanged:found.lines_changed};
        return {status:'CONFLICT',operationId};
      }
      throw new Error('NEEDS_REVIEW: edit claim/readback disagreement');
    }
  });
}
