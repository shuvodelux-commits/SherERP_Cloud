/**
 * Nondeployable test Worker for M03 D1-atomic posting and M04 authority.
 * Every identity, timestamp, amount and operation ID is fixture-owned. Never
 * accept actor/tenant/token/SQL from HTTP body or a public ERP RPC.
 */
import {createSyntheticAuthorizedPostingContract}
  from './m03-authorized-post-contract.mjs';

const A=Object.freeze({
  tokenHash:'a'.repeat(64),tenantId:'TENANT-A',actorId:'USER-A',
  operationId:'OP-1',units:1,amount:'120.00',now:1000
});
const B=Object.freeze({
  ...A,tokenHash:'b'.repeat(64),tenantId:'TENANT-B',actorId:'USER-B'
});
const C=Object.freeze({
  ...A,tokenHash:'c'.repeat(64),tenantId:'TENANT-C',actorId:'USER-C',
  operationId:'OP-LOST'
});
const D=Object.freeze({
  ...A,tokenHash:'d'.repeat(64),tenantId:'TENANT-D',actorId:'USER-D'
});
const E=Object.freeze({
  ...A,tokenHash:'e'.repeat(64),tenantId:'TENANT-E',actorId:'USER-E'
});
const ROUTES=Object.freeze({
  '/__m03_post__/post-a':A,
  '/__m03_post__/post-a-changed':Object.freeze({...A,amount:'120.01'}),
  '/__m03_post__/post-a-forged':Object.freeze({...A,actorId:'USER-OTHER'}),
  '/__m03_post__/post-a-other-actor':Object.freeze({
    ...A,tokenHash:'f'.repeat(64),actorId:'USER-OTHER'
  }),
  '/__m03_post__/post-b':B,
  '/__m03_post__/post-c-lost':C,
  '/__m03_post__/post-c-replay':C,
  '/__m03_post__/post-c-after-revoke':Object.freeze({...C,operationId:'OP-AFTER'}),
  '/__m03_post__/race-d-a':Object.freeze({...D,operationId:'OP-RACE-A'}),
  '/__m03_post__/race-d-b':Object.freeze({...D,operationId:'OP-RACE-B'}),
  '/__m03_post__/bad-e':Object.freeze({...E,operationId:'OP-BAD'}),
  '/__m03_post__/good-e':Object.freeze({...E,operationId:'OP-GOOD'}),
  '/__m03_post__/post-a-after-change':Object.freeze({...A,operationId:'OP-NEW'}),
  '/__m03_post__/post-b-after-change':Object.freeze({...B,operationId:'OP-NEW'})
});
const json=(status,body)=>Response.json(body,{
  status,headers:{'Cache-Control':'no-store'}
});
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(ROUTES,path))return json(404,{error:'Not found'});
    if(request.method!=='POST')return json(405,{error:'Method unavailable'});
    try{
      const result=await createSyntheticAuthorizedPostingContract(env.DB)
        .post(ROUTES[path]);
      if(path==='/__m03_post__/post-c-lost' && result.status==='COMMITTED'){
        // Deliberately emulate a response lost after successful D1 COMMIT.
        return json(503,{error:'Synthetic HTTP delivery lost after commit'});
      }
      return json(200,result);
    }catch{
      return json(409,{error:'Synthetic D1 posting failed; reconcile original operation ID'});
    }
  }
};
