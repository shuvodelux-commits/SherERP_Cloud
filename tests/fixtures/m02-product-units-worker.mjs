// Nondeployable local Workerd/D1 test fixture: no HTTP import or RPC surface.
export default {
  fetch(){return new Response('Not found',{status:404});}
};
