/** Test-only Worker entry point. Never deployed or imported by the real ERP Worker. */
import {createCatalogReader} from '../../src/db/read-only-catalog.js';
import {resolveLegacyPartyId} from '../../src/db/party-identity-read.js';

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
      if(url.pathname==='/__m03_test__/party-id') {
        const source=url.searchParams.get('source');
        const id=url.searchParams.get('id');
        const partyId=await resolveLegacyPartyId(env,source,id);
        return json(200,{partyId});
      }
      return json(404,{error:'Not found'});
    } catch(error) {
      if(error instanceof RangeError || error instanceof TypeError) return json(400,{error:'Invalid test request'});
      return json(500,{error:'Test Worker D1 query failed'});
    }
  }
};
