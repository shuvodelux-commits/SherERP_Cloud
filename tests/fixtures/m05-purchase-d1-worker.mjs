/** Local test-only Worker: no financial HTTP/RPC can be invoked. */
export default {fetch(){return new Response('Not Found',{status:404});}};
