// M07-B2: local-only synthetic Workerd host, no public purchase return RPC.
export default {fetch(){return new Response('Not Found',{status:404});}};
