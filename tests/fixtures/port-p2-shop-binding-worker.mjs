import { getCookie } from 'hono/cookie';
import { resolvePortP2OwnerShop } from '../../src/auth/port-p2-owner-shop-binding.js';

// This entry point is only used by the disposable Workerd test harness.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.PORT_P2_FIXTURE !== 'true' || url.origin !== 'https://port-p2.example.test' ||
        url.pathname !== '/__port_p2__/sentinel' || request.method !== 'GET') {
      return new Response(null, { status: 404 });
    }
    if (url.search || request.headers.has('x-shop-id')) return new Response(null, { status: 400 });

    const token = getCookie({ req: { raw: request } }, '__Host-shererp-owner-session');
    const scope = await resolvePortP2OwnerShop(env, token, env.PORT_P2_ROSTER);
    if (scope.status !== 'ready') return new Response(null, { status: scope.status === 'denied' ? 401 : 503 });
    const row = await scope.shopDb.prepare('SELECT value FROM settings WHERE key=?')
      .bind(env.PORT_P2_SENTINEL_ID).first();
    return Response.json(row, { headers: { 'Cache-Control': 'no-store' } });
  }
};
