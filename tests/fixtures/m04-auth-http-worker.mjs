/**
 * NONDEPLOYABLE M04 HTTP transport proof. Uses ONLY test-only auth D1 schema.
 * Fixed clock and phone normalizer are fixture-owned; never from request.
 */
import {handleRpc} from '../../src/rpc/handler.js';
import {createD1LegacyAuthRpc} from '../../src/auth/d1-legacy-rpc.js';

const FIXED_NOW=1_800_400_000_000;
function testPhone(value){
  if(typeof value!=='string')return '';
  const bn='০১২৩৪৫৬৭৮৯';
  let digits=value.replace(/[০-৯]/g,d=>String(bn.indexOf(d))).replace(/\D/g,'');
  if(/^8801[3-9]\d{8}$/.test(digits))digits='0'+digits.slice(3);
  else if(/^1[3-9]\d{8}$/.test(digits))digits='0'+digits;
  return digits;
}
export default {
  async fetch(request,env){
    if(new URL(request.url).pathname!=='/__m04_test__/http-rpc')
      return new Response('Not found',{status:404});
    // No public URL routes or direct dynamic handler lookup.
    const adapter=createD1LegacyAuthRpc(env.DB,{now:()=>FIXED_NOW,normalizeMobile:testPhone});
    return handleRpc(request,{authAdapter:adapter});
  }
};
