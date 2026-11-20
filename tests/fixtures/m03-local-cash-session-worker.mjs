/**
 * LOCAL WORKERD FIXTURE ONLY: no public/staging Worker, route or D1 binding.
 * A test-only clock endpoint is exclusively present in this nondeployable
 * fixture, never passed to any user-facing ERP operation.
 */
import {loginWithD1} from '../../src/auth/d1-auth-core.js';
import {createM03LocalCashSession} from '../../src/modules/m03-local-cash-session-lifecycle.js';

let deterministicTestClock=1_800_200_000_000;
const json=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export default {
  async fetch(request,env){
    if(request.method!=='POST')return json(405,{error:'Not allowed'});
    const route=new URL(request.url).pathname;
    const allow=new Set(['/__m03_cash_test__/clock','/__m03_cash_test__/login',
      '/__m03_cash_test__/start','/__m03_cash_test__/close',
      '/__m03_cash_test__/summary','/__m03_cash_test__/cash-intent']);
    if(!allow.has(route))return json(404,{error:'Not found'});
    let raw;
    try{raw=await request.json()}catch{return json(400,{error:'Invalid local JSON'})}
    if(!raw || typeof raw!=='object'||Array.isArray(raw))
      return json(400,{error:'Invalid local body'});
    if(route.endsWith('/clock')){
      if(!Number.isSafeInteger(raw.testNowMs)||raw.testNowMs<0)
        return json(400,{error:'Invalid test clock'});
      deterministicTestClock=raw.testNowMs;
      return json(200,{localClockSet:true});
    }
    if(route.endsWith('/login'))return json(200,await loginWithD1(env.DB,{
      phoneKey:raw.phoneKey,password:raw.password,nowMs:deterministicTestClock}));
    const lifecycle=createM03LocalCashSession(env.DB,{
      serverNowMs:()=>deterministicTestClock});
    try{
      if(route.endsWith('/start')){
        const {testInterruptAfterClaim,...input}=raw;
        const result=await lifecycle.start_(input,{
          interruptAfterClaim:testInterruptAfterClaim===true});
        return json(result.needsResume?202:200,result);
      }
      if(route.endsWith('/close')){
        const {testInterruptAfterClaim,...input}=raw;
        const result=await lifecycle.close_(input,{
          interruptAfterClaim:testInterruptAfterClaim===true});
        return json(result.needsResume?202:200,result);
      }
      if(route.endsWith('/summary'))
        return json(200,await lifecycle.summary_(raw));
      return json(200,await lifecycle.cashIntent_(raw));
    }catch{
      // Never leak a different actor's receipt, grant, token or role fields.
      return json(403,{error:'Denied'});
    }
  }
};
