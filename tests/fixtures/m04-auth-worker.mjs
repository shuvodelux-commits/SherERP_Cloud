/**
 * TEST-ONLY Worker: never named in any deploy or preview config.
 * Synthetic requests may supply a deterministic clock; production must not.
 */
import {loginWithD1,validateSessionWithD1,revokeSessionWithD1} from '../../src/auth/d1-auth-core.js';
import {createD1LegacyAuthRpc} from '../../src/auth/d1-legacy-rpc.js';

const json=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
// Pure test fixture normalization only. Actual staging must use reviewed #39.
const testPhone=value=>{
  if(typeof value!=='string')return '';
  const bn='০১২৩৪৫৬৭৮৯';
  let digits=value.replace(/[০-৯]/g,d=>String(bn.indexOf(d))).replace(/\D/g,'');
  if(/^8801[3-9]\d{8}$/.test(digits))digits='0'+digits.slice(3);
  else if(/^1[3-9]\d{8}$/.test(digits))digits='0'+digits;
  return digits;
};
export default {
  async fetch(request,env){
    if(request.method!=='POST') return json(405,{error:'Method forbidden'});
    const path=new URL(request.url).pathname;
    if(!['/__m04_test__/login','/__m04_test__/validate','/__m04_test__/logout','/__m04_test__/rpc'].includes(path))
      return json(404,{error:'Not found'});
    try {
      const raw=await request.json();
      if(!raw || typeof raw!=='object' || Array.isArray(raw))
        return json(400,{error:'Invalid test input'});
      const nowMs=raw.nowMs;
      if(path==='/__m04_test__/rpc'){
        if(typeof raw.fnName!=='string' || !['login','validateSession','logout'].includes(raw.fnName))
          return json(404,{error:'Not found'});
        if(!Array.isArray(raw.args) || raw.args.length!==(raw.fnName==='login'?2:1))
          return json(400,{error:'Invalid test RPC args'});
        const adapter=createD1LegacyAuthRpc(env.DB,{now:()=>nowMs,normalizeMobile:testPhone});
        return json(200,await adapter[raw.fnName](...raw.args));
      }
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
