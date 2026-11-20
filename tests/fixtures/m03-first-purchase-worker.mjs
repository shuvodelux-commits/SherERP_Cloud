/**
 * Isolated local Workerd D1 fixture: no request-based purchase or auth routes.
 * All synthetic transaction SQL is invoked by the local Node test harness.
 * Never imported by a public/preview/staging/production Worker.
 */
export default {
  async fetch() {
    return Response.json({error:'Not found'},{status:404,
      headers:{'Cache-Control':'no-store'}});
  }
};
