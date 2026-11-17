/**
 * Synthetic M05 local-D1-only atomic receiving contract.
 * This is not an authenticated ERP purchase writer or reusable ledger API.
 * Only fixture-owned actor and source IDs are accepted in isolated tests.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
import {previewTilePurchaseLineCandidateD1}
 from '../../src/modules/m05-tile-purchase-line-preview.js';
import {
 M05_TILE_RECEIVE_INSERT_SQL,M05_TILE_RECEIVE_LOOKUP_SQL
} from './m05-tile-receiving-schema.mjs';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const OP=/^[A-Za-z0-9_-]{12,100}$/u;
const WHOLE=/^(?:0|[1-9][0-9]{0,6})$/u;
const MAX_PCS=1000000;
const fail=()=>new Error('NEEDS_REVIEW: uncertain synthetic tile receipt; reconcile original operation');
function ownRecord(value,keys){
 if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
  throw new TypeError('Invalid synthetic tile receiving input');
 const found=Reflect.ownKeys(value);
 if(found.length!==keys.length||found.some(k=>!keys.includes(k)||
    !Object.getOwnPropertyDescriptor(value,k)?.enumerable||
    !Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))
  throw new TypeError('Invalid synthetic tile receiving fields');
}
function validateDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value))
  throw new TypeError('Invalid synthetic purchase date');
 const date=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)
  throw new TypeError('Invalid synthetic purchase date');
}
function validate(input){
 ownRecord(input,['actorId','operationId','purchaseId','supplierId','productId',
   'expectedStockVersion','expectedCatalogVersion','purchaseDate','request']);
 for(const key of ['actorId','purchaseId','supplierId','productId']){
  if(typeof input[key]!=='string'||!ID.test(input[key]))
   throw new TypeError('Invalid synthetic source identity');
 }
 if(typeof input.operationId!=='string'||!OP.test(input.operationId))
  throw new TypeError('Invalid synthetic operation ID');
 for(const [key,min] of [['expectedStockVersion',1],['expectedCatalogVersion',0]]){
  if(!Number.isSafeInteger(input[key])||input[key]<min)
   throw new TypeError('Invalid expected version');
 }
 validateDate(input.purchaseDate);
 if(input.request?.mode==='pack'){
  ownRecord(input.request,['mode','boxes','extraPieces']);
  if(typeof input.request.boxes!=='string'||
     typeof input.request.extraPieces!=='string'||
     !WHOLE.test(input.request.boxes)||!WHOLE.test(input.request.extraPieces))
   throw new TypeError('Invalid whole-Pcs tile receiving input');
  const boxes=Number(input.request.boxes),extra=Number(input.request.extraPieces);
  if(boxes===0&&extra===0||boxes>MAX_PCS||extra>MAX_PCS)
   throw new TypeError('Invalid physical tile receiving request');
  return {boxes,extra};
 }
 if(input.request?.mode==='area'){
  ownRecord(input.request,['mode','requestedSqft','fulfillment']);
  if(typeof input.request.requestedSqft!=='string'||
     !/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,4})?$/.test(input.request.requestedSqft)||
     !['loose','box-only'].includes(input.request.fulfillment))
   throw new TypeError('Invalid area receiving demand or fulfillment');
  const [whole,fraction='']=input.request.requestedSqft.split('.');
  const scaled=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,'0'));
  if(scaled<1n||scaled>10000000n)throw new RangeError('Unsupported area input bound');
  return {boxes:null,extra:null};
 }
 throw new TypeError('Unreviewed tile receive mode');
}
function rows(result){
 if(result?.success!==true||!Array.isArray(result.results))throw fail();
 return result.results;
}
function classification(existing,hash,actorId,operationId){
 if(!existing)return {status:'DECLINED',operationId};
 if(existing.intent_hash===hash&&existing.actor_id===actorId)
  return {status:'REPLAY',operationId,purchaseId:existing.purchase_id};
 return {status:'CONFLICT',operationId};
}

export function createSyntheticTileReceivingPoster(DB,{beforeBatch}={}){
 if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
  throw new Error('Synthetic tile D1 batch binding unavailable');
 if(beforeBatch!==undefined&&typeof beforeBatch!=='function')
  throw new TypeError('Invalid synthetic concurrency hook');
 return Object.freeze({
  async post(input){
   let {boxes,extra}=validate(input);
   const {
    actorId,operationId,purchaseId,supplierId,productId,
    expectedStockVersion,expectedCatalogVersion,purchaseDate,request
   }=input;
   const hash=await hashCanonicalOperationIntent({
    tenantId:'TEST-SHOP',actorId,operationType:'tile.purchase.synthetic',
    payload:{purchaseId,supplierId,productId,expectedStockVersion,
      expectedCatalogVersion,purchaseDate,request:{...request}}
   });
   // A committed matching original intent is replayed without reinterpreting
   // it through today's product revision, pricing or physical pack definition.
   let existing;
   try{existing=await DB.prepare(M05_TILE_RECEIVE_LOOKUP_SQL).bind(operationId).first();}
   catch{throw fail();}
   if(existing!==null)return classification(existing,hash,actorId,operationId);

   const proposal=await previewTilePurchaseLineCandidateD1({DB,productId,request});
   if(proposal===null)return {status:'DECLINED',operationId};
   if(!proposal.isCurrent||proposal.catalog.recordVersion!==expectedCatalogVersion)
    return {status:'DECLINED',operationId};

   if(request.mode==='area'){
    boxes=Number(proposal.quantity.boxes);
    extra=Number(proposal.quantity.extraPieces);
   }
   if(!Number.isSafeInteger(boxes)||boxes<0||!Number.isSafeInteger(extra)||extra<0)
    throw fail();
   const pcs=Number(proposal.purchasePreview.receivedPcs);
   const total=Number(proposal.purchasePreview.lineAmountMinor);
   if(!Number.isSafeInteger(pcs)||pcs<1||pcs>MAX_PCS||
      !Number.isSafeInteger(total)||total<0||total>1000000000||
      proposal.purchasePreview.postingAllowed!==false)
    throw fail();

   const measurement=JSON.stringify(proposal.quantity.measurementSnapshot);
   const pricing=JSON.stringify(proposal.purchasePreview.priceSnapshot);
   const originalRequest=JSON.stringify(request);
   if(beforeBatch)await beforeBatch({productId,operationId,purchaseId});
   let result;
   try{
    result=await DB.batch([
     DB.prepare(M05_TILE_RECEIVE_INSERT_SQL).bind(
      operationId,purchaseId,actorId,hash,supplierId,productId,
      proposal.catalog.unitConfig.revision,expectedStockVersion,expectedCatalogVersion,
      pcs,boxes,extra,proposal.purchasePreview.pricingUnit,
      proposal.purchasePreview.unitPriceText,total,
      originalRequest,measurement,pricing,purchaseDate
     ),
     DB.prepare(M05_TILE_RECEIVE_LOOKUP_SQL).bind(operationId)
    ]);
   }catch{throw fail();}
   if(!Array.isArray(result)||result.length!==2)throw fail();
   const [claim,lookup]=result.map(rows);
   const receipt=lookup.length===1?lookup[0]:null;
   if(claim.length===1&&receipt?.purchase_id===purchaseId&&
       receipt?.intent_hash===hash&&receipt?.actor_id===actorId)
    return {status:'COMMITTED',operationId,purchaseId};
   if(claim.length===0)return classification(receipt,hash,actorId,operationId);
   throw fail();
  }
 });
}
