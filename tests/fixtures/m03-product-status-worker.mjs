/** Test-only fixed ProductSettings status scenarios. Never deploy or wire to RPC. */
import {createProductMasterStatusWorkflow} from '../../src/modules/product-master-status-workflow.js';
const actions=Object.freeze({
  '/__m03_status__/activate-category':Object.freeze(['setCategoryStatus_','CAT-A','Active']),
  '/__m03_status__/delete-category':Object.freeze(['setCategoryStatus_','CAT-B','Inactive']),
  '/__m03_status__/activate-unit':Object.freeze(['setUnitStatus_','UNT-A','Active']),
  '/__m03_status__/delete-unit':Object.freeze(['setUnitStatus_','UNT-B','Inactive']),
  '/__m03_status__/missing-category':Object.freeze(['setCategoryStatus_','CAT-MISSING','Active'])
});
const json=(status,result)=>Response.json(result,{status,headers:{'Cache-Control':'no-store'}});
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(actions,path))return json(404,{error:'Not found'});
    if(request.method!=='POST')return json(405,{error:'Method unavailable'});
    const [name,id,status]=actions[path];
    try{
      const service=createProductMasterStatusWorkflow(env);
      return json(200,await service[name](id,status));
    }catch{
      return json(409,{error:'Synthetic guarded ProductSettings status change refused'});
    }
  }
};
