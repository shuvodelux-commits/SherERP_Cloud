/**
 * Test-only, never deployed. Paths map to immutable server-owned operations.
 * HTTP body, headers and query params supply no tenant, ID or posting SQL.
 */
import {createAtomicSourceIdPostingProof} from '../../src/db/atomic-source-id-posting-proof.js';
const h=x=>x.repeat(64);
const A=Object.freeze({tenantId:'TENANT-A'});
const B=Object.freeze({tenantId:'TENANT-B'});
const C=Object.freeze({tenantId:'TENANT-C'});
const G=Object.freeze({tenantId:'TENANT-G'});
const item=(scope,operationId,intentHash)=>Object.freeze({...scope,operationId,intentHash});
const FIXED=Object.freeze({
  '/__m03_idpost__/a-1':item(A,'OP-ONE',h('a')),
  '/__m03_idpost__/a-1-changed':item(A,'OP-ONE',h('b')),
  '/__m03_idpost__/a-lost':item(A,'OP-LOST',h('c')),
  '/__m03_idpost__/a-lost-retry':item(A,'OP-LOST',h('c')),
  '/__m03_idpost__/a-stock-empty':item(A,'OP-EMPTY',h('d')),
  '/__m03_idpost__/b-race-1':item(B,'OP-RACE-1',h('e')),
  '/__m03_idpost__/b-race-2':item(B,'OP-RACE-2',h('f')),
  '/__m03_idpost__/c-journal-fails':item(C,'OP-FAIL-THEN-RETRY',h('1')),
  '/__m03_idpost__/c-retry':item(C,'OP-FAIL-THEN-RETRY',h('1')),
  '/__m03_idpost__/d-no-stock':item({tenantId:'TENANT-D'},'OP-NO-STOCK',h('2')),
  '/__m03_idpost__/e-exhausted':item({tenantId:'TENANT-E'},'OP-EXHAUST',h('3')),
  '/__m03_idpost__/f-no-counter':item({tenantId:'TENANT-F'},'OP-NO-COUNTER',h('4')),
  '/__m03_idpost__/g-same-op':item(G,'OP-ONE',h('a'))
});
const json=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(FIXED,path))return json(404,{error:'Not found'});
    if(request.method!=='POST')return json(405,{error:'Method unavailable'});
    const {tenantId,operationId,intentHash}=FIXED[path];
    try{
      const result=await createAtomicSourceIdPostingProof(env,tenantId)
        .postSale_({operationId,intentHash});
      if(path==='/__m03_idpost__/a-lost')
        return json(503,{error:'Synthetic response lost after commit'});
      return json(200,result);
    }catch{
      return json(409,{error:'Synthetic ID+stock+journal write refused'});
    }
  }
};
