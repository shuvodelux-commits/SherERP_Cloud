// Nondeployable local-only Workerd/D1 fixture; no HTTP import or public RPC.
export default {fetch(){return new Response('Not found',{status:404});}};
