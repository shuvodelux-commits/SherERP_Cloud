/**
 * Inert local-only Workerd test shell. No operational business endpoints.
 * Two independent D1 bindings are inspected only through test harness env.
 */
export default {
  fetch(){
    return new Response('Not found',{
      status:404,
      headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}
    });
  }
};
