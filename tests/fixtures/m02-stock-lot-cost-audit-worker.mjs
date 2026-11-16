// Isolated synthetic Workerd fixture. No RPC, import or posting routes.
export default {fetch(){return new Response('Not found',{status:404});}};
