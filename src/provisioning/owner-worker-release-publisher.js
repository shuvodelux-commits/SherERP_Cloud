/**
 * Option A Worker Versions publisher choreography — provider-injected.
 * No HTTP endpoint and no direct Cloudflare mutation in this module.
 * A future private service is responsible for a DURABLE, exclusive D1 lease,
 * Cloudflare API version upload/activation and exact independent readback.
 */
import {composeCandidateBindingRoster,verifyCompleteBindingRoster}
  from './verified-binding-roster.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const deny=()=>{throw Error('PUBLISH_DENIED');};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export async function publishShopBinding({
  provider,expectedActive,placement,approvedCodeSha,lease
}={}){
  if(!lease||lease.holder!=='private-provisioner'||!UUID.test(lease.token)||
    !Number.isSafeInteger(lease.expiresAtMs)||lease.expiresAtMs<=Date.now()||
    !provider||typeof provider.readActiveRelease!=='function'||
    typeof provider.uploadCandidate!=='function'||
    typeof provider.readVersion!=='function'||
    typeof provider.promoteVersion!=='function')deny();

  let candidate;
  try{candidate=composeCandidateBindingRoster({
    activeRelease:expectedActive,placement,approvedCodeSha
  });}catch{deny();}

  const matchesActive=async()=>{
    const actual=await provider.readActiveRelease();
    verifyCompleteBindingRoster(expectedActive,actual);
    if(actual.versionId!==expectedActive.versionId||
      !equal(actual.bindings,expectedActive.bindings)||
      !equal(actual.shops,expectedActive.shops))deny();
  };
  try{await matchesActive();}catch{deny();}
  let uploaded;
  try{uploaded=await provider.uploadCandidate({
    candidate,expectedActiveVersionId:expectedActive.versionId,
    leaseToken:lease.token
  });}
  catch{throw Error('UPLOAD_OUTCOME_UNKNOWN');}
  const newVersion=uploaded?.versionId;
  if(!UUID.test(newVersion)||newVersion===expectedActive.versionId)deny();

  const verifyPublished=async()=>{
    const version=await provider.readVersion(newVersion);
    if(!version||version.versionId!==newVersion||
      !equal(version.bindings,candidate.bindings)||
      !equal(version.shops,candidate.shops)||
      version.accountId!==candidate.accountId||
      version.workerName!==candidate.workerName||
      version.codeSha!==approvedCodeSha)deny();
    return version;
  };
  try{await verifyPublished();await matchesActive();}
  catch{deny();}

  try{
    await provider.promoteVersion({
      versionId:newVersion,expectedActiveVersionId:expectedActive.versionId,
      leaseToken:lease.token
    });
  }catch{
    // An API timeout may occur AFTER promotion. Read back before deciding.
    // Never blindly send the same promotion again.
  }
  try{
    const live=await provider.readActiveRelease();
    if(live?.versionId!==newVersion)throw Error('missing active version');
    await verifyPublished();
    if(!equal(live.bindings,candidate.bindings)||
      !equal(live.shops,candidate.shops)||
      live.codeSha!==approvedCodeSha)throw Error('roster drift');
  }catch{throw Error('PUBLISH_OUTCOME_UNKNOWN');}
  return {
    status:'published',versionId:newVersion,
    binding:candidate.shops.at(-1).binding,
    shopId:placement.shopId
  };
}
