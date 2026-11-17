/**
 * Nondeployable local Workerd fixture. Every tenant, operation, hash and
 * business source family is server-owned and fixed. Client body is ignored.
 */
import {createAtomicSourceIdIssuer} from '../../src/db/atomic-source-id-issuer.js';

const hash=n=>String(n).repeat(64);
const A=Object.freeze({tenantId:'TENANT-A',idKey:'PRODUCT_CATEGORIES'});
const B=Object.freeze({tenantId:'TENANT-B',idKey:'PRODUCT_CATEGORIES'});
const D=Object.freeze({tenantId:'TENANT-D',idKey:'PRODUCT_CATEGORIES'});
const E=Object.freeze({tenantId:'TENANT-E',idKey:'PRODUCT_CATEGORIES'});
const req=(scope,operationId,intentHash)=>Object.freeze({...scope,operationId,intentHash});

const FIXED=Object.freeze({
  '/__m03_id__/a-first':req(A,'OP-SAME',hash('a')),
  '/__m03_id__/a-first-drift':req(A,'OP-SAME',hash('b')),
  '/__m03_id__/a-second':req(A,'OP-NEXT',hash('c')),
  '/__m03_id__/a-lost':req(A,'OP-LOST',hash('d')),
  '/__m03_id__/a-lost-retry':req(A,'OP-LOST',hash('d')),
  '/__m03_id__/b-first':req(B,'OP-SAME',hash('a')),
  '/__m03_id__/d-blocked':req(D,'OP-DB-1',hash('e')),
  '/__m03_id__/d-retry':req(D,'OP-DB-1',hash('e')),
  '/__m03_id__/e-exhausted':req(E,'OP-E-1',hash('f')),
  '/__m03_id__/no-counter':req({tenantId:'TENANT-Z',idKey:'PRODUCT_CATEGORIES'},'OP-Z-1',hash('1')),
  '/__m03_id__/wrong-prefix':req({tenantId:'TENANT-W',idKey:'PRODUCT_CATEGORIES'},'OP-W-1',hash('2')),
  '/__m03_id__/unknown-family':req({tenantId:'TENANT-Q',idKey:'SESSIONS'},'OP-Q-1',hash('3')),
  ...Object.fromEntries(Array.from({length:12},(_,i)=>[
    '/__m03_id__/bulk-'+i,
    req({tenantId:'TENANT-A',idKey:'PRODUCT_UNITS'},'OP-BULK-'+i,hash('9'))
  ]))
});
const respond=(status,body)=>Response.json(body,{
  status,headers:{'Cache-Control':'no-store'}
});
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(FIXED,path))return respond(404,{error:'Not found'});
    if(request.method!=='POST')return respond(405,{error:'Method unavailable'});
    const fixed=FIXED[path];
    try{
      const result=await createAtomicSourceIdIssuer(env,fixed.tenantId)
        .allocate_({
          idKey:fixed.idKey,operationId:fixed.operationId,intentHash:fixed.intentHash
        });
      if(path==='/__m03_id__/a-lost'){
        // Commit succeeded, but client never receives that success response.
        return respond(503,{error:'Synthetic delivery failure'});
      }
      return respond(200,result);
    }catch{
      return respond(409,{error:'Synthetic ID issuance refused'});
    }
  }
};
