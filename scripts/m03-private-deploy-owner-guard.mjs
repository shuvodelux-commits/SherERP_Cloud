import {verifyCompleteBindingRoster} from '../src/provisioning/verified-binding-roster.js';

/**
 * Pure, fail-closed preflight. NEVER calls Cloudflare APIs or publishes.
 * The private publisher must read back actual live Cloudflare settings;
 * values supplied by a browser are never authoritative.
 */
const BAD=()=>{throw new Error('DEPLOY_OWNERSHIP_DENIED');};
const ACCOUNT=/^[0-9a-f]{32}$/;
const SHA=/^[0-9a-f]{40}$/;
const NON_PROMOTING=/^npx wrangler(@[0-9]+[.][0-9]+[.][0-9]+)? versions upload --config wrangler[.]shop-user[.]jsonc$/;

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

  // Compare the FULL verified binding + Shop identity roster, not only D1 IDs.
  // A candidate retaining every D1 binding could otherwise silently delete,
  // reassign or rewrite the corresponding Shop/marker while passing preflight.
  try{verifyCompleteBindingRoster(a,c);}
  catch{BAD();}
  return Object.freeze({
    allowed:true,retainedBindings:a.bindings.length,
    newBindings:c.bindings.length-a.bindings.length
  });
}
