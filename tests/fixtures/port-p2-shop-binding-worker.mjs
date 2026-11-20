import { getCookie } from 'hono/cookie';
import { validateOwnerSession } from '../../src/auth/platform-owner-sessions.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.PORT_P2_FIXTURE !== 'true' || url.origin !== 'https://port-p2.example.test' ||
        url.pathname !== '/__port_p2__/sentinel' || request.method !== 'GET') {
      return new Response(null, { status: 404 });
    }
    if (url.search || request.headers.has('x-shop-id')) return new Response(null, { status: 400 });

    // RED adapter uses the current single-pilot entry point.
    const context = { req: { raw: request } };
    const token = getCookie(context, '__Host-shererp-owner-session');
    const [shop] = env.PORT_P2_ROSTER.shops;
    const session = await validateOwnerSession({
      CONTROL_DB: env.CONTROL_DB, PLATFORM_PILOT_DB: env[shop.binding],
      PLATFORM_PILOT_SHOP_ID: shop.shopId, PLATFORM_PILOT_D1_ID: shop.databaseId,
      PLATFORM_PILOT_MARKER: shop.databaseMarker
    }, token);
    if (!session) return new Response(null, { status: 401 });
    const row = await env[shop.binding].prepare('SELECT value FROM settings WHERE key=?').bind(env.PORT_P2_SENTINEL_ID).first();
    return Response.json(row, { headers: { 'Cache-Control': 'no-store' } });
  }
};
