/**
 * Nondeployable fixed-input M03 Workerd/D1 fixture.
 * Verifies the real Worker WebCrypto hash against the merged synthetic D1
 * posting contract. NO request-selected tenant, actor, SQL, IDs or payload.
 */
import {hashCanonicalOperationIntent} from '../../src/db/operation-intent-fingerprint.js';
import {createSyntheticD1PostingContract} from './m03-transaction-contract.mjs';

const BASE=Object.freeze({
  tenantId:'tenant-1',
  actorId:'staff-1',
  operationType:'sales.post',
  payload:Object.freeze({
    items:Object.freeze([Object.freeze({sku:'PIPE',quantity:'1.000'})]),
    total:'120.00'
  })
});
const REORDERED=Object.freeze({
  payload:Object.freeze({
    total:'120.00',
    items:Object.freeze([Object.freeze({quantity:'1.000',sku:'PIPE'})])
  }),
  operationType:'sales.post',
  actorId:'staff-1',
  tenantId:'tenant-1'
});
const FIXED=Object.freeze({
  '/__m03_intent__/commit':BASE,
  '/__m03_intent__/reordered':REORDERED,
  '/__m03_intent__/changed-total':Object.freeze({
    ...BASE,payload:Object.freeze({...BASE.payload,total:'120.01'})
  }),
  '/__m03_intent__/other-tenant':Object.freeze({...BASE,tenantId:'tenant-2'}),
  '/__m03_intent__/other-actor':Object.freeze({...BASE,actorId:'staff-2'}),
  '/__m03_intent__/other-type':Object.freeze({...BASE,operationType:'purchase.post'}),
  '/__m03_intent__/invalid-float':Object.freeze({
    ...BASE,payload:Object.freeze({...BASE.payload,total:120.5})
  }),
  '/__m03_intent__/invalid-undefined':Object.freeze({
    ...BASE,payload:Object.freeze({items:[{sku:'PIPE',quantity:undefined}],total:'120.00'})
  })
});
const json=(status,body)=>Response.json(body,{
  status,headers:{'Cache-Control':'no-store'}
});
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(FIXED,path))return json(404,{error:'Not found'});
    if(request.method!=='POST')return json(405,{error:'Method unavailable'});
    try{
      // Only the trusted fixed synthetic object is hashed. Untrusted request
      // body is neither parsed nor allowed to choose the operational scope.
      const fingerprint=await hashCanonicalOperationIntent(FIXED[path]);
      const result=await createSyntheticD1PostingContract(env.DB).post({
        operationId:'HASH-OP',payloadHash:fingerprint,units:1
      });
      return json(200,{...result,fingerprint});
    }catch(error){
      if(error instanceof TypeError || error instanceof RangeError){
        return json(400,{error:'Invalid synthetic operation intent'});
      }
      return json(409,{error:'Synthetic operation refused'});
    }
  }
};
