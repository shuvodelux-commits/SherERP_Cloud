import {handleRpc} from '../../src/rpc/handler.js';
import {createD1LegacyAuthRpc} from '../../src/auth/d1-legacy-rpc.js';
import {normalizeLegacyStaffPhoneSearch} from '../../src/auth/staff-phone-identity.js';
import {createM04AppShellRpcBridge} from '../../src/rpc/internal-m04-shell-bridge.js';

// Synthetic local-only Workerd test fixture, NEVER public or deployable.
// Time and phone normalization are trusted server-owned dependencies.
const NOW=1_800_400_000_000;
export default {
  async fetch(request,env){
    if(new URL(request.url).pathname!=='/__m04_test__/login-shell-rpc')
      return new Response('Not found',{status:404});
    const authAdapter=createD1LegacyAuthRpc(env.DB,{
      now:()=>NOW,normalizeMobile:normalizeLegacyStaffPhoneSearch
    });
    const appShellBridge=createM04AppShellRpcBridge(env,{now:()=>NOW});
    return handleRpc(request,{authAdapter,appShellBridge});
  }
};
