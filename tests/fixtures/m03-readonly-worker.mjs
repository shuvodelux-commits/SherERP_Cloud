/** Test-only Worker entry point. Never deployed or imported by the real ERP Worker. */
import {createCatalogReader} from '../../src/db/read-only-catalog.js';
import {resolveLegacyPartyId} from '../../src/db/party-identity-read.js';
import {createLegacyCatalogReadAdapter} from '../../src/db/legacy-catalog-read.js';
import {createProductMasterOptionsReader} from '../../src/modules/product-master-options.js';
import {createProductMasterCreatePreflight} from '../../src/modules/product-master-create-preflight.js';
import {createReportsBootstrapD1Reader} from '../../src/modules/reports-bootstrap-d1-read.js';

const json=(status, value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

export default {
  async fetch(request, env) {
    if(request.method !== 'GET') return json(405,{error:'GET required'});
    const url=new URL(request.url);
    try {
      if(url.pathname==='/__m03_test__/categories') {
        const limit=url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50;
        return json(200,{rows:await createCatalogReader(env).listCategories(limit)});
      }
      if(url.pathname==='/__m03_test__/units') {
        const limit=url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50;
        return json(200,{rows:await createCatalogReader(env).listUnits(limit)});
      }
      if(url.pathname==='/__m03_test__/reports-bootstrap') {
        // Trusted shop time is supplied by the test server, not request query params.
        return json(200,await createReportsBootstrapD1Reader(env).getBootstrap('2026-11-15'));
      }
      if(url.pathname==='/__m03_test__/category-create-preflight') {
        // Fixed original name; reject external query/body input by ignoring it.
        return json(200,await createProductMasterCreatePreflight(env).checkCategoryName_(' দড়ি '));
      }
      if(url.pathname==='/__m03_test__/unit-create-preflight') {
        return json(200,await createProductMasterCreatePreflight(env).checkUnitName_('pCs'));
      }
      if(url.pathname==='/__m03_test__/new-category-create-preflight') {
        return json(200,await createProductMasterCreatePreflight(env).checkCategoryName_('New Electric'));
      }
      if(url.pathname==='/__m03_test__/product-bootstrap-references') {
        return json(200,await createProductMasterOptionsReader(env).getBootstrapReferences());
      }
      if(url.pathname==='/__m03_test__/product-master-options') {
        return json(200,await createProductMasterOptionsReader(env).getOptions());
      }
      if(url.pathname==='/__m03_test__/legacy-rows') {
        const sheet=url.searchParams.get('sheet');
        return json(200,{rows:await createLegacyCatalogReadAdapter(env).getAllRows_(sheet)});
      }
      if(url.pathname==='/__m03_test__/legacy-find') {
        const sheet=url.searchParams.get('sheet');
        const column=url.searchParams.get('column');
        const value=url.searchParams.get('value');
        return json(200,{match:await createLegacyCatalogReadAdapter(env).findRow_(sheet,column,value)});
      }
      if(url.pathname==='/__m03_test__/party-id') {
        const source=url.searchParams.get('source');
        const id=url.searchParams.get('id');
        const partyId=await resolveLegacyPartyId(env,source,id);
        return json(200,{partyId});
      }
      return json(404,{error:'Not found'});
    } catch(error) {
      if(error instanceof RangeError || error instanceof TypeError || /^Column not found:/.test(error.message)) return json(400,{error:'Invalid test request'});
      return json(500,{error:'Test Worker D1 query failed'});
    }
  }
};
