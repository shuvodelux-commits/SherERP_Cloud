/**
 * Option A shared Worker D1 roster contract.
 * A Shop binding MUST be derived from the immutable, verified Shop UUID.
 * This is metadata construction only; it does not call Cloudflare APIs.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT=/^[0-9a-f]{32}$/;
const SHA=/^[0-9a-f]{40}$/;
const RECEIPT=/^[0-9a-f]{64}$/;
const BINDING=/^(CONTROL_DB|PLATFORM_PILOT_DB|SHOP_[0-9A-F]{32})$/;
const denied=()=>{throw Error('ROSTER_DENIED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function verifyReleaseRoster(release){
  if(!release||!ACCOUNT.test(release.accountId)||
    release.workerName!=='shererp'||!UUID.test(release.versionId)||
    !SHA.test(release.codeSha)||!Array.isArray(release.bindings)||
    !Array.isArray(release.shops)||release.bindings.length<2||
    release.shops.length!==release.bindings.length-1)denied();
  const bindingIds=new Set(),ids=new Set(),byName=new Map();
  for(const b of release.bindings){
    if(!b||!BINDING.test(b.binding)||!UUID.test(b.databaseId)||
      bindingIds.has(b.binding)||ids.has(b.databaseId))denied();
    bindingIds.add(b.binding);
    ids.add(b.databaseId);
    byName.set(b.binding,b.databaseId);
  }
  if(!byName.has('CONTROL_DB')||!byName.has('PLATFORM_PILOT_DB'))denied();
  const shopIds=new Set(),markers=new Set(),assignedBindings=new Set();
  for(const shop of release.shops){
    if(!shop||!UUID.test(shop.shopId)||!UUID.test(shop.databaseMarker)||
      shop.binding==='CONTROL_DB'||!BINDING.test(shop.binding)||
      shop.binding!== 'PLATFORM_PILOT_DB'&&
        shop.binding!=='SHOP_'+shop.shopId.replaceAll('-','').toUpperCase()||
      byName.get(shop.binding)!==shop.databaseId||
      shopIds.has(shop.shopId)||markers.has(shop.databaseMarker)||
      assignedBindings.has(shop.binding)||
      (shop.binding!=='PLATFORM_PILOT_DB'&&
        (shop.schemaRevision!=='owner-ready-v1'||!RECEIPT.test(shop.receiptDigest))))denied();
    shopIds.add(shop.shopId);
    markers.add(shop.databaseMarker);
    assignedBindings.add(shop.binding);
  }
  if(shopIds.size!==byName.size-1)denied();
  return true;
}

export function composeCandidateBindingRoster({activeRelease,placement,approvedCodeSha}={}){
  verifyReleaseRoster(activeRelease);
  const p=placement;
  if(approvedCodeSha!==activeRelease.codeSha||!p||
    p.accountId!==activeRelease.accountId||!UUID.test(p.shopId)||
    !UUID.test(p.databaseId)||!UUID.test(p.databaseMarker)||
    !RECEIPT.test(p.receiptDigest)||
    p.schemaRevision!=='owner-ready-v1'||
    p.verifiedIdentity!==true||p.verifiedMigrations!==13)denied();
  const name='SHOP_'+p.shopId.replaceAll('-','').toUpperCase();
  const candidate={
    ...activeRelease,
    bindings:[
      ...activeRelease.bindings.map(x=>({binding:x.binding,databaseId:x.databaseId})),
      {binding:name,databaseId:p.databaseId}
    ],
    shops:[
      ...activeRelease.shops.map(x=>({...x})),
      {shopId:p.shopId,binding:name,databaseId:p.databaseId,
        databaseMarker:p.databaseMarker,schemaRevision:p.schemaRevision,
        receiptDigest:p.receiptDigest}
    ]
  };
  verifyCompleteBindingRoster(activeRelease,candidate);
  return candidate;
}

export function verifyCompleteBindingRoster(activeRelease,candidateRelease){
  verifyReleaseRoster(activeRelease);
  verifyReleaseRoster(candidateRelease);
  if(activeRelease.accountId!==candidateRelease.accountId||
    activeRelease.workerName!==candidateRelease.workerName||
    activeRelease.codeSha!==candidateRelease.codeSha||
    candidateRelease.bindings.length<activeRelease.bindings.length||
    candidateRelease.shops.length<activeRelease.shops.length)denied();
  for(let i=0;i<activeRelease.bindings.length;i++){
    if(!same(activeRelease.bindings[i],candidateRelease.bindings[i]))denied();
  }
  for(let i=0;i<activeRelease.shops.length;i++){
    if(!same(activeRelease.shops[i],candidateRelease.shops[i]))denied();
  }
  return true;
}
