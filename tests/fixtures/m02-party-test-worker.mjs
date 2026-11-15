// Isolated synthetic-only M02 local-D1 test fixture.
// Deliberately provides NO RPC, financial, auth or data endpoints.
export default {
  fetch() {
    return new Response('Not Found', {status:404,headers:{'Content-Type':'text/plain'}});
  }
};