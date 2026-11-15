/**
 * Nondeployable M03/M04 authorized receipt test Worker. Routes are fixed
 * synthetic test actions; HTTP bodies cannot choose token, tenant or actor.
 */
import {createAuthorizedOperationReceiptAdapter}
  from '../../src/db/authorized-operation-receipt.js';

const BASE=Object.freeze({
  tokenHash:'a'.repeat(64),tenantId:'TENANT-A',now:1000,operationId:'OP-1',
  operationType:'sales.post',
  payload:Object.freeze({
    items:Object.freeze([Object.freeze({sku:'PIPE',units:'1.000'})]),
    total:'120.00'
  })
});
const ACTIONS=Object.freeze({
  '/__m03_authorized__/replay':BASE,
  '/__m03_authorized__/reordered':Object.freeze({
    operationId:'OP-1',tokenHash:'a'.repeat(64),tenantId:'TENANT-A',now:1000,
    operationType:'sales.post',
    payload:Object.freeze({
      total:'120.00',
      items:Object.freeze([Object.freeze({units:'1.000',sku:'PIPE'})])
    })
  }),
  '/__m03_authorized__/changed-amount':Object.freeze({
    ...BASE,payload:Object.freeze({...BASE.payload,total:'120.01'})
  }),
  '/__m03_authorized__/changed-type':Object.freeze({
    ...BASE,operationType:'purchase.post'
  }),
  '/__m03_authorized__/other-actor':Object.freeze({
    ...BASE,tokenHash:'c'.repeat(64)
  }),
  '/__m03_authorized__/other-tenant':Object.freeze({
    ...BASE,tokenHash:'b'.repeat(64),tenantId:'TENANT-B'
  }),
  '/__m03_authorized__/missing':Object.freeze({
    ...BASE,operationId:'OP-UNKNOWN'
  }),
  '/__m03_authorized__/invalid-float':Object.freeze({
    ...BASE,payload:Object.freeze({...BASE.payload,total:120.50})
  })
});
const reply=(status,body)=>Response.json(body,{
  status,headers:{'Cache-Control':'no-store'}
});
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(ACTIONS,path))return reply(404,{error:'Not found'});
    if(request.method!=='POST')return reply(405,{error:'Method unavailable'});
    try{
      const result=await createAuthorizedOperationReceiptAdapter(env)
        .reconcile_(ACTIONS[path]);
      return reply(200,result);
    }catch(error){
      if(error instanceof TypeError || error instanceof RangeError){
        return reply(400,{error:'Invalid synthetic input'});
      }
      if(/^Denied:/.test(error.message)){
        return reply(403,{error:'Denied'});
      }
      return reply(503,{error:'NEEDS_REVIEW: Synthetic authorized read refused'});
    }
  }
};
