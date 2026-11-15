/** NONDEPLOYABLE fixed route proof. No client names, ids or SQL accepted. */
import {createM03AtomicProductMasterCreator} from '../../src/modules/m03-product-master-atomic-create.js';

const actions=Object.freeze({
  '/__m03_atomic_master__/category-tools':Object.freeze(['createCategory_','OP-TOOLS','Tools']),
  '/__m03_atomic_master__/category-tools-retry':Object.freeze(['createCategory_','OP-TOOLS',' Tools ']),
  '/__m03_atomic_master__/category-tools-collision':Object.freeze(['createCategory_','OP-TOOLS','Wrong Name']),
  '/__m03_atomic_master__/category-duplicate':Object.freeze(['createCategory_','OP-DUP','eLeCtRiCaL']),
  '/__m03_atomic_master__/category-reuse':Object.freeze(['createCategory_','OP-REUSE',' wIrE ']),
  '/__m03_atomic_master__/unit-gira':Object.freeze(['createUnit_','OP-UNIT','গিরা']),
  '/__m03_atomic_master__/category-race-a':Object.freeze(['createCategory_','OP-RACE-A','Latch']),
  '/__m03_atomic_master__/category-race-b':Object.freeze(['createCategory_','OP-RACE-B','latch']),
  '/__m03_atomic_master__/category-lost':Object.freeze(['createCategory_','OP-LOST','Tape']),
  '/__m03_atomic_master__/category-lost-retry':Object.freeze(['createCategory_','OP-LOST','Tape']),
  '/__m03_atomic_master__/category-fault':Object.freeze(['createCategory_','OP-FAULT','Fault'])
});
const json=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

export default {
  async fetch(request,env){
    const route=new URL(request.url).pathname;
    if(!Object.hasOwn(actions,route))return json(404,{error:'Not found'});
    if(request.method!=='POST')return json(405,{error:'POST required'});
    try{
      const [method,operationId,name]=actions[route];
      const service=createM03AtomicProductMasterCreator(env,{businessId:'BUS-A'});
      const result=await service[method]({operationId,name});
      if(route==='/__m03_atomic_master__/category-lost')
        return json(503,{error:'Simulated lost response after committed insert'});
      return json(200,result);
    }catch{
      return json(409,{error:'Guarded source master creation refused'});
    }
  }
};
