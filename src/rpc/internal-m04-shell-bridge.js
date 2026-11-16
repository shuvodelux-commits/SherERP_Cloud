import {createM04LoginShellReader} from '../modules/m04-login-shell-reader.js';

// A trusted, non-public composition boundary. Only the server injects a D1
// binding and now() clock. A caller's nowMs/actor/role/SQL is never consulted.
const UNAVAILABLE='Authenticated app shell unavailable or access denied';
export function createM04AppShellRpcBridge(env,{now=Date.now}={}){
  if(typeof now!=='function')throw new TypeError('Trusted M04 server clock required');
  const reader=createM04LoginShellReader(env);
  return Object.freeze({
    async invoke({token}={}){
      try{
        const nowMs=now();
        if(!Number.isSafeInteger(nowMs)||nowMs<0)
          throw new Error(UNAVAILABLE);
        return await reader.getAppShellData({token,nowMs});
      }catch{
        throw new Error(UNAVAILABLE);
      }
    }
  });
}
