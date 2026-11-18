const AUDIENCE=/^[0-9a-f]{64}$/;
const EMAIL=/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+$/;

/**
 * Internal staging-only identity read. The caller must pass the Cloudflare
 * ExecutionContext from a direct Access-protected Worker invocation.
 * Request headers, cookies and JSON cannot substitute for that context.
 * Workers Static Assets do not forward ctx.access.
 */
export async function resolveAccessAdministrator(ctx,env){
  const access=ctx?.access;
  const audience=env?.M04_ACCESS_AUDIENCE;
  const email=env?.M04_ACCESS_ADMIN_EMAIL;
  const userId=env?.M04_ACCESS_ADMIN_USER_ID;
  if(typeof audience!=='string' || !AUDIENCE.test(audience) ||
     typeof email!=='string' || email.length>254 || !EMAIL.test(email) ||
     typeof userId!=='string' || userId.length>256 || userId.trim()!==userId || !userId ||
     access?.aud!==audience || typeof access.getIdentity!=='function' ||
     typeof env.DB?.prepare!=='function')return null;

  const identity=await access.getIdentity();
  if(typeof identity?.email!=='string' || identity.email.toLowerCase()!==email)return null;

  return await env.DB.prepare(`
    SELECT user_id AS id, full_name AS name, role_name AS role
    FROM auth_users
    WHERE user_id=? AND status='Active' AND role_name='Administrator'
  `).bind(userId).first();
}
