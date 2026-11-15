/** Test-only M03 Settings D1 harness. Never exposes Settings or RPC routes. */
export default {fetch(){return new Response('Not found',{status:404});}};
