/**
 * TEST-ONLY Worker: never named in any deploy or preview config.
 * Synthetic requests may supply a deterministic clock; production must not.
 */
import {loginWithD1,validateSessionWithD1,revokeSessionWithD1} from '../../src/auth/d1-auth-core.js';

const json=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export default {
  async fetch(request,env){
    if(request.method!=='POST') return json(405,{error:'Method forbidden'});
    const path=new URL(request.url).pathname;
    if(!['/__m04_test__/login','/__m04_test__/validate','/__m04_test__/logout'].includes(path))
      return json(404,{error:'Not found'});
    try {
      const raw=await request.json();
      if(!raw || typeof raw!=='object' || Array.isArray(raw))
        return json(400,{error:'Invalid test input'});
      const nowMs=raw.nowMs;
      if(path==='/__m04_test__/login')
        return json(200,await loginWithD1(env.DB,{phoneKey:raw.phoneKey,password:raw.password,nowMs}));
      if(path==='/__m04_test__/validate')
        return json(200,await validateSessionWithD1(env.DB,{token:raw.token,nowMs}));
      return json(200,await revokeSessionWithD1(env.DB,{token:raw.token,nowMs}));
    } catch {
      // Fail-closed and never reflect passwords, mobile or token.
      return json(500,{error:'Authentication backend failed'});
    }
  }
};
