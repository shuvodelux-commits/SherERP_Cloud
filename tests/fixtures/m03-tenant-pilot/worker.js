// Synthetic Workerd fixture only. No production authentication or provisioning.
const shopBindings=new Map([['a','SHOP_A'],['b','SHOP_B']]);

export default {
  async fetch(request,env){
    const shop=new URL(request.url).pathname.slice(1);
    const binding=shopBindings.get(shop);
    if(!binding)return new Response(null,{status:404});

    const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization')??'')?.[1];
    if(!token)return new Response(null,{status:403});
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    const tokenHash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    const allowed=await env.CONTROL.prepare(`
      SELECT 1 AS authorized
      FROM sessions s
      JOIN memberships m ON m.user_id=s.user_id
      JOIN tenants t ON t.id=m.tenant_id
      WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>? AND t.id=? AND t.active=1
    `).bind(tokenHash,Date.now(),shop).first();
    if(!allowed)return new Response(null,{status:403});

    const row=await env[binding].prepare('SELECT value FROM shop_marker WHERE id=?').bind(shop).first();
    return row?Response.json(row):new Response(null,{status:503});
  },
};
