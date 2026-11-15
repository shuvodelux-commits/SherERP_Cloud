/**
 * Nondeployable, fixed synthetic M03 batch-guard Worker.
 * Request bodies, query parameters and untrusted SQL are ignored.
 * No public Worker entry, production migrations or real financial data.
 */
import {createD1ExactlyOneBatchGuard} from '../../src/db/exactly-one-batch.js';

const ACTIONS=Object.freeze({
  '/__m03_guard__/post-first':Object.freeze({
    operationId:'OP-FIRST',payloadHash:'hash-original',sku:'PIPE',qty:1
  }),
  '/__m03_guard__/post-collision':Object.freeze({
    operationId:'OP-FIRST',payloadHash:'hash-changed',sku:'PIPE',qty:1
  }),
  '/__m03_guard__/post-empty':Object.freeze({
    operationId:'OP-EMPTY',payloadHash:'hash-empty',sku:'EMPTY',qty:1
  }),
  '/__m03_guard__/post-bad-journal':Object.freeze({
    operationId:'OP-BAD-JOURNAL',payloadHash:'hash-bad',sku:'PIPE',qty:1,badJournal:true
  }),
  '/__m03_guard__/last-a':Object.freeze({
    operationId:'OP-LAST-A',payloadHash:'hash-last-a',sku:'SINGLE',qty:1
  }),
  '/__m03_guard__/last-b':Object.freeze({
    operationId:'OP-LAST-B',payloadHash:'hash-last-b',sku:'SINGLE',qty:1
  })
});
const MULTIROW='/__m03_guard__/multirow';
const json=(status,body)=>Response.json(body,{
  status,headers:{'Cache-Control':'no-store'}
});

export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(ACTIONS,path) && path!==MULTIROW)
      return json(404,{error:'Not found'});
    if(request.method!=='POST')
      return json(405,{error:'Method unavailable'});
    try{
      const guard=createD1ExactlyOneBatchGuard(env);
      if(path===MULTIROW){
        await guard.execute_([env.DB.prepare('UPDATE proof_stock SET quantity=quantity+1')]);
      }else{
        const action=ACTIONS[path];
        const {operationId,payloadHash,sku,qty,badJournal}=action;
        await guard.execute_([
          env.DB.prepare('INSERT OR IGNORE INTO proof_operations(operation_id,payload_hash) VALUES (?,?)')
            .bind(operationId,payloadHash),
          env.DB.prepare('UPDATE proof_stock SET quantity=quantity-? WHERE sku=? AND quantity>=?')
            .bind(qty,sku,qty),
          env.DB.prepare('INSERT INTO proof_journal(operation_id,sku,quantity) VALUES (?,?,?)')
            .bind(operationId,sku,badJournal?null:qty),
          env.DB.prepare('INSERT INTO proof_receipts(operation_id,payload_hash,posted) VALUES (?,?,1)')
            .bind(operationId,payloadHash)
        ]);
      }
      return json(200,{posted:true});
    }catch{
      return json(409,{error:'Synthetic guarded D1 operation refused'});
    }
  }
};
