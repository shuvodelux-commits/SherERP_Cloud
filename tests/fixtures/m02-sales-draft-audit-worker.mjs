// Synthetic nondeployable local-only test Worker. No public D1 import or RPC.
export default {fetch(){return new Response('Not found',{status:404});}};
