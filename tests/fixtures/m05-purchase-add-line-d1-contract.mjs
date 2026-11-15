/**
 * Local test-only addition of one *new* SKU to an immutable source purchase.
 * This is not a public RPC or the production M03/M07 posting kernel.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OP=/^[A-Za-z0-9_-]{12,100}$/;
const LIMIT=1_000_000_000;

const SQL_CLAIM=`INSERT OR IGNORE INTO m05ml_add_receipts(
 tenant_id,purchase_id,operation_id,actor_id,intent_hash,reason,sku,
 qty,cost_paisa,sell_paisa,expected_version,new_due_paisa)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,p.due_paisa+(?*?)
 FROM m05ml_purchases p WHERE p.tenant_id=? AND p.purchase_id=?
 RETURNING purchase_id,operation_id,actor_id,intent_hash,new_due_paisa`;
const SQL_LOOKUP=`SELECT r.purchase_id,r.operation_id,r.actor_id,r.intent_hash,
 r.new_due_paisa,a.lines_added
 FROM m05ml_add_receipts r LEFT JOIN m05ml_add_audit a
 ON a.tenant_id=r.tenant_id AND a.purchase_id=r.purchase_id
 WHERE r.tenant_id=? AND r.operation_id=?`;

const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const exactKeys=(x,keys)=>record(x)&&
 Reflect.ownKeys(x).sort().join(',')===keys.slice().sort().join(',');
function toPaisa(value,label){
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/.test(value))
   throw new TypeError('Invalid '+label+': exact paisa string required');
 const [major,minor='']=value.split('.');
 const n=100*Number(major)+Number(minor.padEnd(2,'0'));
 if(!Number.isSafeInteger(n)||n>LIMIT)
   throw new RangeError('Invalid '+label+' money limit');
 return n;
}
function parse(input){
 if(!exactKeys(input,[
   'tenantId','actorId','purchaseId','operationId','reason',
   'sku','qty','unitPrice','sellPrice','expectedVersion'
 ])||!ID.test(input.tenantId||'')||!ID.test(input.actorId||'')
   ||!ID.test(input.purchaseId||'')||!OP.test(input.operationId||'')
   ||!ID.test(input.sku||'')
   ||typeof input.reason!=='string'||input.reason.trim().length===0
   ||input.reason.length>200||/[\x00-\x1f\x7f]/.test(input.reason)
   ||!Number.isSafeInteger(input.qty)||input.qty<1||input.qty>1_000_000
   ||!Number.isSafeInteger(input.expectedVersion)
   ||input.expectedVersion<1||input.expectedVersion>1_000_000)
   throw new TypeError('Invalid synthetic purchase new SKU addition');
 const costPaisa=toPaisa(input.unitPrice,'unit price');
 const sellPaisa=toPaisa(input.sellPrice,'selling price');
 if(!Number.isSafeInteger(costPaisa*input.qty)||costPaisa*input.qty>LIMIT)
   throw new RangeError('Added purchase SKU total exceeds limit');
 return {costPaisa,sellPaisa};
}
function authoritativeRows(result){
 if(result?.success!==true||!Array.isArray(result.results))
   throw new Error('NEEDS_REVIEW: missing authoritative D1 add-SKU result');
 return result.results;
}

export function createSyntheticPurchaseLineAdder(DB,{beforeBatch}={}){
 if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
   throw new Error('Synthetic local D1 binding required');
 if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
   throw new TypeError('Invalid add-line test-only beforeBatch hook');
 return Object.freeze({
   async add(input){
     const {costPaisa,sellPaisa}=parse(input);
     const {tenantId,actorId,purchaseId,operationId,reason,sku,qty,expectedVersion}=input;
     const intentHash=await hashCanonicalOperationIntent({
       tenantId,actorId,operationType:'purchase.add_line.synthetic',
       payload:{purchaseId,reason,sku,qty,costPaisa,sellPaisa,expectedVersion}
     });
     if(beforeBatch)await beforeBatch({tenantId,purchaseId,operationId});
     let result;
     try{
       result=await DB.batch([
         DB.prepare(SQL_CLAIM).bind(
           tenantId,purchaseId,operationId,actorId,intentHash,reason,sku,
           qty,costPaisa,sellPaisa,expectedVersion,qty,costPaisa,
           tenantId,purchaseId
         ),
         DB.prepare(SQL_LOOKUP).bind(tenantId,operationId)
       ]);
     }catch{
       // A response may be lost after an authoritative write. The caller
       // must reconcile by operation ID, never invent a second operation ID.
       throw new Error('NEEDS_REVIEW: new purchase SKU commit uncertain; reconcile operation ID');
     }
     if(!Array.isArray(result)||result.length!==2)
       throw new Error('NEEDS_REVIEW: ambiguous add-SKU D1 batch');
     const [claim,lookup]=result.map(authoritativeRows);
     const found=lookup.length===1?lookup[0]:null;
     const same=found?.actor_id===actorId&&found?.intent_hash===intentHash
       &&found?.purchase_id===purchaseId&&found?.lines_added===1;
     if(claim.length===1&&same)
       return {status:'COMMITTED',operationId,purchaseId,
         newDuePaisa:found.new_due_paisa,linesAdded:1};
     if(claim.length===0){
       if(!found)return {status:'DECLINED',operationId};
       if(same)return {status:'REPLAY',operationId,purchaseId,
         newDuePaisa:found.new_due_paisa,linesAdded:1};
       return {status:'CONFLICT',operationId};
     }
     throw new Error('NEEDS_REVIEW: inconsistent add-SKU D1 readback');
   }
 });
}
