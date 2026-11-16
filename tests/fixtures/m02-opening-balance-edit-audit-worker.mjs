// PR-only nondeployable test Worker. No source import or public RPC.
export default {fetch(){return new Response('Not found',{status:404});}};
