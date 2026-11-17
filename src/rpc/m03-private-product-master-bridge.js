import {createM04AuthorizedProductMasterCreator}
  from '../modules/m04-authorized-product-master-create.js';

/**
 * M03 Run 4: server-only composition of M04's CURRENT-SQL authorized writer.
 * NONDEPLOYABLE. Public src/index.js does not import this bridge.
 * Trusted server context supplies businessId and time; neither may come
 * from the RPC body. M04's INSERT...SELECT remains the authority gate.
 */
const METHODS=Object.freeze({
  addProductCategory:'createCategory_',
  addProductUnit:'createUnit_'
});
const TOKEN=/^[0-9a-f]{64}$/;
const OPERATION=/^[A-Z0-9][A-Z0-9_-]{0,127}$/;

function exactRecord(obj,keys){
  if(!obj||typeof obj!=='object'||Array.isArray(obj) ||
     ![Object.prototype,null].includes(Object.getPrototypeOf(obj)))
    return false;
  const actual=Reflect.ownKeys(obj);
  if(actual.length!==keys.length ||
     actual.some(key=>typeof key!=='string'||!keys.includes(key)))
    return false;
  return keys.every(key=>{
    const prop=Object.getOwnPropertyDescriptor(obj,key);
    return prop?.enumerable===true && Object.hasOwn(prop,'value');
  });
}

export function createM03PrivateProductMasterBridge(env,{businessId,now=Date.now}={}){
  if(typeof now!=='function')
    throw new TypeError('Invalid trusted server clock');
  // This creator validates the server-owned single-business identity and D1.
  const writer=createM04AuthorizedProductMasterCreator(env,{businessId});
  return Object.freeze({
    async invoke(request){
      if(!exactRecord(request,['fnName','token','operationId','name']) ||
         !Object.hasOwn(METHODS,request.fnName) ||
         typeof request.token!=='string'||!TOKEN.test(request.token) ||
         typeof request.operationId!=='string'||!OPERATION.test(request.operationId) ||
         typeof request.name!=='string'||request.name.length>256){
        throw new TypeError('Invalid or unapproved private Product master RPC');
      }
      const nowMs=now();
      if(!Number.isSafeInteger(nowMs)||nowMs<0||
         !Number.isSafeInteger(nowMs+12*60*60*1000))
        throw new TypeError('Invalid trusted server clock');
      // Fixed method map, no client-selected exports, actor, role, time or DB.
      const fn=writer[METHODS[request.fnName]];
      return await fn({
        token:request.token,operationId:request.operationId,
        name:request.name,nowMs
      });
    }
  });
}
