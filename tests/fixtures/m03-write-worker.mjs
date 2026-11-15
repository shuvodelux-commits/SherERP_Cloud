/** Separate local-only M03 write-test Worker. NOT imported by src/index.js. */
import {createLegacyCatalogAppendAdapter} from '../../src/db/legacy-catalog-append.js';
import {createLegacyCatalogReadAdapter} from '../../src/db/legacy-catalog-read.js';

const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const FIXTURES=Object.freeze({
  '/__m03_write_test__/append-category-a':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',
    row:Object.freeze({'Category ID':'CAT-W-A','Category Name':'Hardware','Status':'Active','Created At':''})
  }),
  '/__m03_write_test__/append-category-b':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',
    row:Object.freeze({'Category ID':'CAT-W-B','Category Name':'Hardware','Status':'Active','Created At':''})
  }),
  '/__m03_write_test__/append-category-c':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',
    row:Object.freeze({'Category ID':'CAT-W-C','Category Name':'Hardware','Status':'Active','Created At':''})
  }),
  '/__m03_write_test__/append-unit-a':Object.freeze({
    sheet:'PRODUCT_UNITS',
    row:Object.freeze({'Unit ID':'UNIT-W-A','Unit Name':'Feet','Status':'Active','Created At':''})
  }),
  '/__m03_write_test__/append-unit-b':Object.freeze({
    sheet:'PRODUCT_UNITS',
    row:Object.freeze({'Unit ID':'UNIT-W-B','Unit Name':'Gira','Status':'Active','Created At':''})
  })
});

export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(request.method==='POST') {
      if(!Object.hasOwn(FIXTURES,path)) return json(405,{error:'Method unavailable'});
      const fixed=FIXTURES[path]; // only fixed synthetic values; never request body
      try {
        const rowIndex=await createLegacyCatalogAppendAdapter(env).appendRow_(fixed.sheet,fixed.row);
        return json(200,{rowIndex});
      } catch {
        return json(500,{error:'Synthetic D1 append refused'});
      }
    }
    if(request.method!=='GET') return json(405,{error:'Method unavailable'});
    if(path==='/__m03_write_test__/categories') {
      try {
        const rows=await createLegacyCatalogReadAdapter(env).getAllRows_('PRODUCT_CATEGORIES');
        return json(200,{rows});
      } catch {
        return json(500,{error:'Synthetic D1 read refused'});
      }
    }
    return json(404,{error:'Not found'});
  }
};
