/** Convert a read-only Wrangler version view to the original exact login-only profile. */
import {buildShopUserDeployment} from './build-shop-user-deploy.mjs';
const invalid=()=>{throw new Error('First-Shop source Worker binding mismatch')};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuid=x=>typeof x==='string'&&UUID.test(x);

/**
 * Convert ONLY the live login-only Worker bindings into the already reviewed
 * generated deployment config. The JSON must come from Wrangler versions view
 * in the same Cloudflare account; no secrets, D1 rows or browser input.
 */
export function buildLoginOnlyProfileFromLiveVersion(version,accountId){
  const bindings=version?.resources?.bindings;
  if(!/^[a-f0-9]{32}$/.test(accountId)||!Array.isArray(bindings)||
     !bindings.length||new Set(bindings.map(b=>b?.name)).size!==bindings.length)
    invalid();
  const b=new Map(bindings.map(x=>[x.name,x]));
  const c=b.get('CONTROL_DB'),s=b.get('PLATFORM_PILOT_DB');
  const ingress=b.get('OWNER_INGRESS'),assets=b.get('ASSETS');
  if(c?.type!=='d1'||s?.type!=='d1'||
     !uuid(c.database_id)||!uuid(s.database_id)||
     ingress?.type!=='ratelimit'||assets?.type!=='assets')invalid();
  const plain=Object.fromEntries(bindings.filter(x=>x.type==='plain_text')
    .map(x=>[x.name,x.text]));
  if(Object.keys(plain).some(k=>typeof plain[k]!=='string'))invalid();
  const approvedBindings=new Set([
    'ASSETS','CONTROL_DB','PLATFORM_PILOT_DB','OWNER_INGRESS',
    ...Object.keys(plain)
  ]);
  if(bindings.some(x=>!approvedBindings.has(x.name)||
      !['plain_text','d1','ratelimit','assets'].includes(x.type)))invalid();
  const env={
    WORKERS_CI:'1',WORKERS_CI_BRANCH:'main',
    SHERERP_OWNER_LOGIN_RELEASE:'OWNER_LOGIN_ONLY_APPROVED',
    SHERERP_ACCOUNT_ID:accountId,
    SHERERP_CONTROL_DB_NAME:'shererp-admin-control-v2',
    SHERERP_CONTROL_DB_ID:c.database_id,
    SHERERP_SHOP_DB_NAME:'shererp-shop-001',
    SHERERP_SHOP_DB_ID:s.database_id,
    SHERERP_OWNER_GOOGLE_CLIENT_ID:plain.PLATFORM_OWNER_CLIENT_ID,
    SHERERP_SHOP_ID:plain.PLATFORM_PILOT_SHOP_ID,
    SHERERP_SHOP_MARKER:plain.PLATFORM_PILOT_MARKER,
    SHERERP_OWNER_RATE_LIMIT_NAMESPACE:String(ingress.namespace_id)
  };
  let profile;
  try{profile=buildShopUserDeployment(env);}catch{invalid();}
  // The live authenticated Owner version must already be exactly the
  // generated source profile; unknown vars/ bindings may not be dropped.
  if(JSON.stringify(Object.entries(plain).sort())!==
     JSON.stringify(Object.entries(profile.vars).sort())||
     profile.d1_databases[0].database_id!==c.database_id||
     profile.d1_databases[1].database_id!==s.database_id||
     profile.ratelimits[0].namespace_id!==String(ingress.namespace_id)||
     JSON.stringify(profile.ratelimits[0].simple)!==
       JSON.stringify(ingress.simple))invalid();
  return profile;
}
