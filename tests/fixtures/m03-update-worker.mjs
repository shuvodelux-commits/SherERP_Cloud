/**
 * Nondeployable, fixed-fixture M03 Worker for real local D1 guarded updates.
 * Never imported by src/index.js. Request bodies and query params are ignored.
 */
import {createGuardedCatalogUpdateAdapter} from '../../src/db/legacy-catalog-update.js';

const fixtures=Object.freeze({
  '/__m03_update_test__/category-status':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',rowIndex:2,
    fields:Object.freeze({Status:'Inactive'}),
    precondition:Object.freeze({sourceId:'CAT-UP-1',name:'Electrical',status:'Active'})
  }),
  '/__m03_update_test__/category-noop':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',rowIndex:3,
    fields:Object.freeze({Status:'Active'}),
    precondition:Object.freeze({sourceId:'CAT-UP-2',name:'Hardware',status:'Active'})
  }),
  '/__m03_update_test__/wrong-category-id':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',rowIndex:2,
    fields:Object.freeze({Status:'Inactive'}),
    precondition:Object.freeze({sourceId:'CAT-UP-2',name:'Hardware',status:'Active'})
  }),
  '/__m03_update_test__/unit-rename':Object.freeze({
    sheet:'PRODUCT_UNITS',rowIndex:3,
    fields:Object.freeze({'Unit Name':'গিরা'}),
    precondition:Object.freeze({sourceId:'UNT-UP-2',name:'Feet',status:'Active'})
  }),
  '/__m03_update_test__/unit-1-status':Object.freeze({
    sheet:'PRODUCT_UNITS',rowIndex:2,
    fields:Object.freeze({Status:'Inactive'}),
    precondition:Object.freeze({sourceId:'UNT-UP-1',name:'Pcs',status:'Active'})
  }),
  '/__m03_update_test__/unit-1-name':Object.freeze({
    sheet:'PRODUCT_UNITS',rowIndex:2,
    fields:Object.freeze({'Unit Name':'Pieces'}),
    precondition:Object.freeze({sourceId:'UNT-UP-1',name:'Pcs',status:'Active'})
  }),
  '/__m03_update_test__/category-after-corruption':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',rowIndex:2,
    fields:Object.freeze({'Category Name':'Rewritten'}),
    precondition:Object.freeze({sourceId:'CAT-UP-1',name:'Electrical',status:'Inactive'})
  })
});
const json=(status,body)=>Response.json(body,{
  status,headers:{'Cache-Control':'no-store'}
});

export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(fixtures,path))return json(404,{error:'Not found'});
    if(request.method!=='POST')return json(405,{error:'Method unavailable'});
    const fixed=fixtures[path];
    try{
      await createGuardedCatalogUpdateAdapter(env).updateRowFields_(
        fixed.sheet,fixed.rowIndex,fixed.fields,fixed.precondition
      );
      return json(200,{updated:true});
    }catch{
      return json(409,{error:'Synthetic guarded catalog update refused'});
    }
  }
};
