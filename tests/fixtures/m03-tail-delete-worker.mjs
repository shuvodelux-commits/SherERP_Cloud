/** Nondeployable synthetic M03 tail-only delete test Worker; never imported by src/index.js. */
import {createLegacyCatalogTailDeleteAdapter} from '../../src/db/legacy-catalog-tail-delete.js';
import {createLegacyCatalogAppendAdapter} from '../../src/db/legacy-catalog-append.js';

const DELETIONS=Object.freeze({
  '/__m03_tail__/category-middle':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',rowIndex:3,
    precondition:Object.freeze({sourceId:'CAT-D2',name:'Hardware',status:'Active'})
  }),
  '/__m03_tail__/category-wrong-id':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',rowIndex:4,
    precondition:Object.freeze({sourceId:'CAT-NOT-REAL',name:'বাংলা',status:'Inactive'})
  }),
  '/__m03_tail__/category-tail':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',rowIndex:4,
    precondition:Object.freeze({sourceId:'CAT-D3',name:'বাংলা',status:'Inactive'})
  }),
  '/__m03_tail__/category-new-tail':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',rowIndex:4,
    precondition:Object.freeze({sourceId:'CAT-D4',name:'বাংলা',status:'Active'})
  }),
  '/__m03_tail__/unit-tail':Object.freeze({
    sheet:'PRODUCT_UNITS',rowIndex:3,
    precondition:Object.freeze({sourceId:'UNT-D2',name:'Feet',status:'Inactive'})
  }),
  '/__m03_tail__/unit-sole':Object.freeze({
    sheet:'PRODUCT_UNITS',rowIndex:2,
    precondition:Object.freeze({sourceId:'UNT-D1',name:'Pcs',status:'Active'})
  })
});
const APPEND_PATH='/__m03_tail__/append-fresh-category';
const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(DELETIONS,path)&&path!==APPEND_PATH)return json(404,{error:'Not found'});
    if(request.method!=='POST')return json(405,{error:'Method unavailable'});
    try{
      if(path===APPEND_PATH){
        const rowIndex=await createLegacyCatalogAppendAdapter(env).appendRow_('PRODUCT_CATEGORIES',{
          'Category ID':'CAT-D4','Category Name':'বাংলা','Status':'Active','Created At':''
        });
        return json(200,{rowIndex});
      }
      const fixed=DELETIONS[path]; // request body/query never controls table, ID or values
      await createLegacyCatalogTailDeleteAdapter(env).deleteLastRow_(
        fixed.sheet,fixed.rowIndex,fixed.precondition
      );
      return json(200,{deleted:true});
    }catch{
      return json(409,{error:'Synthetic guarded D1 tail deletion refused'});
    }
  }
};
