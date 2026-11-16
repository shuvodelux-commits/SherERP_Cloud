/** Local-only M02/M04 real-schema RPC integration proof. Never deployed publicly. */
import {handleRpc} from '../../src/rpc/handler.js';
import {createD1LegacyAuthRpc} from '../../src/auth/d1-legacy-rpc.js';
import {normalizeLegacyStaffPhoneSearch} from '../../src/auth/staff-phone-identity.js';

const FIXED_NOW=1_800_500_000_000;
export default {
  async fetch(request,env) {
    if(new URL(request.url).pathname!=='/__integration__/rpc')
      return new Response('Not found',{status:404});
    const authAdapter=createD1LegacyAuthRpc(env.DB,{
      now:()=>FIXED_NOW,normalizeMobile:normalizeLegacyStaffPhoneSearch,
    });
    return handleRpc(request,{authAdapter});
  },
};
