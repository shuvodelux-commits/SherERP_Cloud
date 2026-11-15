/** Test-only M04 Worker with no public auth or posting endpoints. */
export default {fetch(){return new Response('Not found',{status:404});}};
