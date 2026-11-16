/**
 * NONDEPLOYABLE M03 internal HTTP / real-D1 authorization proof.
 *
 * Only the fixture-owned test path mounts the explicit Day Book bridge.
 * /api/rpc and all other routes are deliberately absent. Never point a
 * public Wrangler config, deployment or production Worker to this file.
 */
import {handleRpc} from '../../src/rpc/handler.js';
import {createM03DayBookRpcBridge}
  from '../../src/rpc/internal-daybook-bootstrap.js';

const NOW=1_800_000_000_000;
export default {
  async fetch(request,env){
    if(new URL(request.url).pathname!=='/__m03_test__/daybook-http')
      return Response.json({error:'Not found'},{status:404});
    const dayBookBridge=createM03DayBookRpcBridge(env,{now:()=>NOW});
    return handleRpc(request,{dayBookBridge});
  }
};
