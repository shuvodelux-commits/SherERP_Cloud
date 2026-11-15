/**
 * NONDEPLOYABLE local Workerd actor-authorized Product master proof.
 * Fixed server-side tokens, time, source names and operations only.
 * Incoming request body/query never supplies actor, SQL, time or tenant.
 */
import {createM04AuthorizedProductMasterCreator} from '../../src/modules/m04-authorized-product-master-create.js';
const NOW=1_800_000_000_000;
const T=Object.freeze({
  admin:'a'.repeat(64),staff:'b'.repeat(64),
  denied:'c'.repeat(64),alternate:'d'.repeat(64),string:'e'.repeat(64)
});
const routes=Object.freeze({
  '/__m04_master__/admin-tools':['createCategory_','admin','OP-TOOLS','Tools'],
  '/__m04_master__/admin-tools-replay':['createCategory_','admin','OP-TOOLS',' Tools '],
  '/__m04_master__/different-actor-replay':['createCategory_','alternate','OP-TOOLS','Tools'],
  '/__m04_master__/staff-unit':['createUnit_','staff','OP-UNIT','গিরা'],
  '/__m04_master__/denied':['createCategory_','denied','OP-SECRET','Electrical'],
  '/__m04_master__/string-grant':['createCategory_','string','OP-STRING','Tape'],
  '/__m04_master__/inactive-wire':['createCategory_','staff','OP-WIRE',' wIrE '],
  '/__m04_master__/admin-lost':['createCategory_','admin','OP-LOST','Tape'],
  '/__m04_master__/admin-lost-retry':['createCategory_','admin','OP-LOST','Tape'],
  '/__m04_master__/staff-revoked':['createUnit_','staff','OP-REVOKED','Feet'],
  '/__m04_master__/admin-fault':['createCategory_','admin','OP-FAULT','Fault'],
  '/__m04_master__/race-a':['createCategory_','staff','OP-RACE-A','Latch'],
  '/__m04_master__/race-b':['createCategory_','admin','OP-RACE-B','latch']
});
const json=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(routes,path))return json(404,{error:'Not found'});
    if(request.method!=='POST')return json(405,{error:'POST required'});
    try{
      const [method,actor,operationId,name]=routes[path];
      const creator=createM04AuthorizedProductMasterCreator(env,{businessId:'BUS-A'});
      const result=await creator[method]({token:T[actor],nowMs:NOW,operationId,name});
      if(path==='/__m04_master__/admin-lost')
        return json(503,{error:'Synthetic response lost after commit'});
      return json(200,result);
    }catch{
      return json(409,{error:'Authorized master mutation refused'});
    }
  }
};
