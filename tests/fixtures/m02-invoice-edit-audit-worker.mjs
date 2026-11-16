// PR-only synthetic local Workerd fixture; no public import/RPC endpoints.
export default {fetch(){return new Response('Not found',{status:404});}};
