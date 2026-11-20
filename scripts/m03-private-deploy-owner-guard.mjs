/**
 * Pure, fail-closed preflight. NEVER calls Cloudflare APIs or publishes.
 * The private publisher must read back actual live Cloudflare settings;
 * values supplied by a browser are never authoritative.
 */
const BAD=()=>{throw new Error('DEPLOY_OWNERSHIP_DENIED');};
const ACCOUNT=/^[0-9a-f]{32}$/;
const SHA=/^[0-9a-f]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BINDING=/^(CONTROL_DB|PLATFORM_PILOT_DB|SHOP_[A-Z0-9_]+)$/;
const NON_PROMOTING=/^npx wrangler(@[0-9]+[.][0-9]+[.][0-9]+)? versions upload --config wrangler[.]shop-user[.]jsonc$/;

function verifiedBindings(release){
  if(!Array.isArray(release?.bindings)||release.bindings.length<2)BAD();
  const names=new Set(),identities=new Set();
  for(const x of release.bindings){
    if(!x||typeof x.binding!=='string'||!BINDING.test(x.binding)||
       typeof x.databaseId!=='string'||!UUID.test(x.databaseId)||
       names.has(x.binding)||identities.has(x.databaseId))BAD();
    names.add(x.binding);
    identities.add(x.databaseId);
  }
  if(!names.has('CONTROL_DB')||!names.has('PLATFORM_PILOT_DB'))BAD();
  return new Map(release.bindings.map(b=>[b.binding,b.databaseId]));
}

/** Checks that an explicitly approved upload cannot orphan an existing shop. */
export function assertPrivateOwnerDeployOwnership({buildSettings,activeRelease,candidateRelease}={}){
  const s=buildSettings,a=activeRelease,c=candidateRelease;
  if(!s||!a||!c||
     !ACCOUNT.test(s.accountId)||s.workerName!=='shererp'||
     s.productionBranch!=='main'||s.approvedPublisher!=='private-provisioner'||
     !NON_PROMOTING.test(s.deployCommand)||
     !SHA.test(s.approvedCodeSha)||
     a.accountId!==s.accountId||c.accountId!==s.accountId||
     a.workerName!==s.workerName||c.workerName!==s.workerName||
     !SHA.test(a.codeSha)||c.codeSha!==s.approvedCodeSha||
     a.codeSha!==s.approvedCodeSha)BAD();

  const before=verifiedBindings(a);
  const next=verifiedBindings(c);
  for(const [binding,id] of before){
    if(next.get(binding)!==id)BAD();
  }
  return Object.freeze({
    allowed:true,retainedBindings:before.size,newBindings:next.size-before.size
  });
}
