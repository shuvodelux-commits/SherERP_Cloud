/**
 * Test-only, fixed-input M03 reversal Worker. All D1 identifiers, tenant
 * identities, actor, hash, source ID and quantities are code-owned synthetic
 * constants; HTTP body is never parsed or used as business authority.
 */
import {createSyntheticD1ReversalContract} from './m03-reversal-contract.mjs';

const BASE=Object.freeze({
  tenantId:'TENANT-1',actorId:'STAFF-1',reversalId:'REV-ONE',
  originalOperationId:'OP-OWN',originalHash:'a'.repeat(64),
  units:1,reason:'Approved invoice deletion'
});
const ACTIONS=Object.freeze({
  '/__m03_reverse__/owned':BASE,
  '/__m03_reverse__/changed-reason':Object.freeze({
    ...BASE,reason:'Changed approval'
  }),
  '/__m03_reverse__/changed-actor':Object.freeze({
    ...BASE,actorId:'STAFF-2'
  }),
  '/__m03_reverse__/second-id':Object.freeze({
    ...BASE,reversalId:'REV-TWO'
  }),
  '/__m03_reverse__/other-tenant':Object.freeze({
    ...BASE,tenantId:'TENANT-2',originalHash:'b'.repeat(64)
  }),
  '/__m03_reverse__/vendor':Object.freeze({
    ...BASE,reversalId:'REV-VENDOR',
    originalOperationId:'OP-VENDOR',originalHash:'c'.repeat(64)
  }),
  '/__m03_reverse__/active-return':Object.freeze({
    ...BASE,reversalId:'REV-RETURN',
    originalOperationId:'OP-RETURN',originalHash:'d'.repeat(64)
  }),
  '/__m03_reverse__/no-source':Object.freeze({
    ...BASE,reversalId:'REV-NONE',
    originalOperationId:'OP-UNKNOWN'
  }),
  '/__m03_reverse__/unproven':Object.freeze({
    ...BASE,reversalId:'REV-UNPROVEN',
    originalOperationId:'OP-UNPROVEN',originalHash:'1'.repeat(64)
  }),
  '/__m03_reverse__/wrong-original-hash':Object.freeze({
    ...BASE,reversalId:'REV-WRONG',originalHash:'c'.repeat(64)
  }),
  '/__m03_reverse__/race-a':Object.freeze({
    ...BASE,reversalId:'REV-RACE-A',
    originalOperationId:'OP-RACE',originalHash:'0'.repeat(64)
  }),
  '/__m03_reverse__/race-b':Object.freeze({
    ...BASE,reversalId:'REV-RACE-B',
    originalOperationId:'OP-RACE',originalHash:'0'.repeat(64)
  }),
  '/__m03_reverse__/missing-stock':Object.freeze({
    ...BASE,reversalId:'REV-MISSING',
    originalOperationId:'OP-MISSING',originalHash:'e'.repeat(64)
  }),
  '/__m03_reverse__/journal-failure':Object.freeze({
    ...BASE,reversalId:'REV-BROKEN',
    originalOperationId:'OP-BROKEN',originalHash:'f'.repeat(64)
  })
});

const respond=(status,body)=>Response.json(body,{
  status,headers:{'Cache-Control':'no-store'}
});

export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(ACTIONS,path))return respond(404,{error:'Not found'});
    if(request.method!=='POST')return respond(405,{error:'Method unavailable'});
    try{
      const result=await createSyntheticD1ReversalContract(env.DB)
        .reverse(ACTIONS[path]);
      return respond(200,result);
    }catch{
      return respond(409,{error:'Synthetic reversal refused; reconcile original ID'});
    }
  }
};
