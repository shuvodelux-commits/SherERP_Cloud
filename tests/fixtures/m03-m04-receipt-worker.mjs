/**
 * Test-only M03/M04 schema-aligned readback Worker. Hardcoded requests only.
 * Never deployed to public RPC, no attacker identity/SQL from HTTP.
 */
import {createM04SingleBusinessReceiptReadback}
  from '../../src/db/m04-operation-receipt-read.js';
import {AUTH_POLICY} from '../../src/auth/d1-auth-core.js';
import {M04_RECEIPT_INTENT,M04_RECEIPT_CLOCK,M04_RECEIPT_TOKEN_B,
  M04_RECEIPT_TOKEN_C,M04_RECEIPT_PAYLOAD}
  from './m03-m04-receipt-schema.mjs';

const A=M04_RECEIPT_INTENT;
const ACTIONS=Object.freeze({
  '/__m03_m04_receipt__/owner':{businessId:'BUSINESS-A',intent:A},
  '/__m03_m04_receipt__/reordered':{
    businessId:'BUSINESS-A',intent:{...A,payload:{
      total:'120.00',items:[{units:'1.000',sku:'PIPE'}]
    }}
  },
  '/__m03_m04_receipt__/changed-amount':{
    businessId:'BUSINESS-A',intent:{...A,payload:{
      ...M04_RECEIPT_PAYLOAD,total:'120.01'
    }}
  },
  '/__m03_m04_receipt__/changed-type':{
    businessId:'BUSINESS-A',intent:{...A,operationType:'purchase.post'}
  },
  '/__m03_m04_receipt__/other-admin':{
    businessId:'BUSINESS-A',intent:{...A,token:M04_RECEIPT_TOKEN_B}
  },
  '/__m03_m04_receipt__/cashier':{
    businessId:'BUSINESS-A',intent:{...A,token:M04_RECEIPT_TOKEN_C}
  },
  '/__m03_m04_receipt__/unknown-token':{
    businessId:'BUSINESS-A',intent:{...A,token:'d'.repeat(64)}
  },
  '/__m03_m04_receipt__/second-own':{
    businessId:'BUSINESS-A',
    intent:{...A,token:M04_RECEIPT_TOKEN_B,operationId:'OP-2'}
  },
  '/__m03_m04_receipt__/missing':{
    businessId:'BUSINESS-A',intent:{...A,operationId:'OP-UNKNOWN'}
  },
  '/__m03_m04_receipt__/other-business':{
    businessId:'BUSINESS-B',intent:A
  },
  '/__m03_m04_receipt__/expired-idle':{
    businessId:'BUSINESS-A',
    intent:{...A,nowMs:M04_RECEIPT_CLOCK+AUTH_POLICY.sessionIdleMs-300_000}
  },
  '/__m03_m04_receipt__/expired-absolute':{
    businessId:'BUSINESS-A',
    intent:{...A,nowMs:M04_RECEIPT_CLOCK+1_200_000}
  }
});

const reply=(status,body)=>Response.json(body,{
  status,headers:{'Cache-Control':'no-store'}
});
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!Object.hasOwn(ACTIONS,url.pathname)){
      return reply(404,{error:'Not found'});
    }
    if(request.method!=='POST'){
      return reply(405,{error:'Method unavailable'});
    }
    const action=ACTIONS[url.pathname];
    try{
      const result=await createM04SingleBusinessReceiptReadback(env,{
        businessId:action.businessId
      }).reconcile_(action.intent);
      return reply(200,result);
    }catch(error){
      if(error instanceof TypeError){
        return reply(400,{error:'Invalid test-only operation'});
      }
      if(typeof error.message==='string' && error.message.startsWith('Denied:')){
        return reply(403,{error:'Denied'});
      }
      return reply(503,{error:'NEEDS_REVIEW'});
    }
  }
};
