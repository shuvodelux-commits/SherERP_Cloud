/** Separate local-only M03 write-test Worker. NOT imported by src/index.js. */
import {createLegacyCatalogAppendAdapter} from '../../src/db/legacy-catalog-append.js';
import {createLegacyCatalogReadAdapter} from '../../src/db/legacy-catalog-read.js';
import {createLegacyCatalogActivationAdapter} from '../../src/db/legacy-catalog-activation.js';

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
  }),
  '/__m03_write_test__/batch-categories':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',
    rows:Object.freeze([
      Object.freeze({'Category ID':'CAT-W-BATCH-1','Category Name':'Hardware','Status':'Active','Created At':''}),
      Object.freeze({'Category ID':'CAT-W-BATCH-2','Category Name':'বাংলা','Status':'Active','Created At':''})
    ])
  }),
  '/__m03_write_test__/batch-conflict':Object.freeze({
    sheet:'PRODUCT_CATEGORIES',
    rows:Object.freeze([
      Object.freeze({'Category ID':'CAT-W-BATCH-UNCOMMITTED','Category Name':'New','Status':'Active','Created At':''}),
      Object.freeze({'Category ID':'CAT-W-A','Category Name':'Duplicate existing ID','Status':'Active','Created At':''})
    ])
  })
});

// Only synthetic, immutable test actions; never accept client-selected IDs or SQL.
const ACTIVATIONS=Object.freeze({
  '/__m03_write_test__/activate-category-2':Object.freeze(['PRODUCT_CATEGORIES',3,'CAT-2','Inactive']),
  '/__m03_write_test__/activate-unit-1':Object.freeze(['PRODUCT_UNITS',2,'UNIT-1','Inactive']),
});

export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(request.method==='POST') {
      if(Object.hasOwn(ACTIVATIONS,path)) {
        try {
          const rowIndex=await createLegacyCatalogActivationAdapter(env).activate_(...ACTIVATIONS[path]);
          return json(200,{rowIndex});
        } catch {
          return json(500,{error:'Synthetic D1 activation refused'});
        }
      }
      if(!Object.hasOwn(FIXTURES,path)) return json(405,{error:'Method unavailable'});
      const fixed=FIXTURES[path]; // only fixed synthetic values; never request body
      try {
        const writer=createLegacyCatalogAppendAdapter(env);
        if(fixed.rows) {
          await writer.appendRows_(fixed.sheet,fixed.rows);
          return json(200,{inserted:fixed.rows.length});
        }
        const rowIndex=await writer.appendRow_(fixed.sheet,fixed.row);
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
