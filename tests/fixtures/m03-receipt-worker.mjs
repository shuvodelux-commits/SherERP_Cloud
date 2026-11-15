/**
 * Synthetic-only local Workerd/D1 receipt reconciliation fixture.
 *
 * All tenant/actor/operation/SQL values are code-owned constants. An HTTP
 * body is ignored. NEVER import from a deployed Worker or use real D1 data.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
import {createOperationReceiptReconciliationAdapter} from '../../src/db/operation-receipt-reconcile.js';

const ORIGINAL=Object.freeze({
  tenantId:'TENANT-1',operationId:'OP-42',actorId:'staff-1',
  operationType:'sales.post',
  payload:Object.freeze({
    items:Object.freeze([Object.freeze({sku:'PIPE',units:'1.000'})]),
    total:'120.00'
  })
});
const INTENTS=Object.freeze({
  '/__m03_receipt__/reconcile-original':ORIGINAL,
  '/__m03_receipt__/reconcile-reordered':Object.freeze({
    payload:Object.freeze({total:'120.00',items:Object.freeze([
      Object.freeze({units:'1.000',sku:'PIPE'})
    ])}),
    operationType:'sales.post',actorId:'staff-1',
    operationId:'OP-42',tenantId:'TENANT-1'
  }),
  '/__m03_receipt__/reconcile-changed-total':Object.freeze({
    ...ORIGINAL,payload:Object.freeze({...ORIGINAL.payload,total:'120.01'})
  }),
  '/__m03_receipt__/reconcile-changed-actor':Object.freeze({
    ...ORIGINAL,actorId:'staff-2'
  }),
  '/__m03_receipt__/reconcile-changed-type':Object.freeze({
    ...ORIGINAL,operationType:'purchase.post'
  }),
  '/__m03_receipt__/reconcile-other-tenant':Object.freeze({
    ...ORIGINAL,tenantId:'TENANT-2'
  }),
  '/__m03_receipt__/reconcile-late-failure':Object.freeze({
    ...ORIGINAL,operationId:'OP-BAD'
  })
});
const LOST='/__m03_receipt__/commit-lost';
const FAILED='/__m03_receipt__/commit-late-failure';
const json=(status,body)=>Response.json(body,{status,
  headers:{'Cache-Control':'no-store'}});
const receiptHash=async(input)=>hashCanonicalOperationIntent({
  tenantId:input.tenantId,actorId:input.actorId,
  operationType:input.operationType,payload:input.payload
});

async function syntheticCommit(DB,operationId,forceJournalFailure){
  const hash=await receiptHash(ORIGINAL);
  const receiptRef=forceJournalFailure?'SALE-BAD':'SALE-7';
  await DB.batch([
    DB.prepare(`INSERT INTO operation_receipts
      (tenant_id,operation_id,actor_id,operation_type,payload_hash,result_ref,committed_at)
      VALUES (?,?,?,?,?,?,?)`)
      .bind('TENANT-1',operationId,'staff-1','sales.post',hash,receiptRef,'2026-11-15T06:00:00Z'),
    DB.prepare(`UPDATE synthetic_stock SET available=available-1
      WHERE sku='PIPE' AND available>=1`),
    DB.prepare(`INSERT INTO synthetic_journal(operation_id,receipt_ref) VALUES (?,?)`)
      .bind(operationId,forceJournalFailure?null:receiptRef)
  ]);
}

export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(INTENTS,path)&&path!==LOST&&path!==FAILED){
      return json(404,{error:'Not found'});
    }
    if(request.method!=='POST')return json(405,{error:'Method unavailable'});
    if(path===LOST){
      try{
        await syntheticCommit(env.DB,'OP-42',false);
        // Intentionally simulate ambiguous delivery AFTER the durable DB
        // transaction committed. Caller must reconcile original operation ID.
        return json(503,{error:'Synthetic HTTP result lost after committed D1 batch'});
      }catch{
        return json(409,{error:'Synthetic operation commit refused'});
      }
    }
    if(path===FAILED){
      try{
        await syntheticCommit(env.DB,'OP-BAD',true);
        return json(200,{error:'Unexpected synthetic success'});
      }catch{
        return json(503,{error:'Synthetic D1 journal failure'});
      }
    }
    try{
      const result=await createOperationReceiptReconciliationAdapter(env)
        .reconcile_(INTENTS[path]);
      return json(200,result);
    }catch{
      return json(503,{error:'NEEDS_REVIEW: Synthetic reconciliation refused'});
    }
  }
};
