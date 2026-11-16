// Nondeployable synthetic local Workerd fixture; never exposes import or RPC.
export default {fetch(){return new Response('Not found',{status:404});}};
