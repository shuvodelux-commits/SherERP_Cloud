/**
 * Option A: adapt the existing private Admin Create/Resume UI to the isolated
 * Cloudflare service-bound Shop Provisioner. Never expose the binding or its
 * internal shared key to the browser. Default disabled; pilot remains intact.
 */
import {validatePlatformSuperAdminSession} from './platform-superadmin-session.js';
import {readLocalProvisioning,listLocalProvisioning} from './port-p4-local-provisioning.js';
import {readHostedShopCreate} from '../provisioning/hosted-shop-create.js';

const KEY=/^[A-Za-z0-9_-]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HOST='https://provisioner.internal/internal/shops/';
const ACTIONS=new Set(['reserve','status','advance']);
const STATE=Object.freeze({
  reserved:'reserved',creating:'allocating',
  'outcome-unknown':'allocating','database-created':'allocated'
});
const failed=stage=>
  stage==='capacity'||stage==='reconciliation'?'database-creation':null;

export function hostedShopServiceEnabled(env){
  return env?.PLATFORM_PRIVATE_PROVISIONER_ENABLED==='true'&&
    env.PLATFORM_SHOP_RESERVATION_ENABLED==='true'&&
    env.PLATFORM_SHOP_DIRECTORY_ENABLED==='true'&&
    env.PLATFORM_HOSTED_PILOT_ENABLED!=='true'&&
    env.PLATFORM_LOCAL_PROVISIONING_ENABLED!=='true'&&
    typeof env.PLATFORM_PRIVATE_PROVISIONER?.fetch==='function'&&
    typeof env.CONTROL_DB?.prepare==='function'&&
    KEY.test(env.PLATFORM_PROVISIONER_INTERNAL_KEY);
}

async function callService(env,sessionToken,action,body){
  if(!hostedShopServiceEnabled(env)||!ACTIONS.has(action))return {code:503};
  // Double-authorize at the Admin boundary; the private service independently
  // rechecks the same active MFA session after the service-binding hop.
  if(!await validatePlatformSuperAdminSession(env.CONTROL_DB,sessionToken))
    return {code:401};
  let response;
  try{
    response=await env.PLATFORM_PRIVATE_PROVISIONER.fetch(
      new Request(HOST+action,{
        method:'POST',headers:{
          'Content-Type':'application/json',
          'x-platform-admin-session':sessionToken,
          'x-provisioner-key':env.PLATFORM_PROVISIONER_INTERNAL_KEY
        },body:JSON.stringify(body)
      })
    );
  }catch{return {code:503};}
  if(!response||!Number.isSafeInteger(response.status))return {code:503};
  // The private response isn't evidence by itself. State is read exclusively
  // from the Admin-scoped immutable Control D1 journal after the call.
  if([400,401,409].includes(response.status))return {code:response.status};
  if(![200,202].includes(response.status))return {code:503};
  return {code:response.status};
}

export async function readHostedShopSetup(env,sessionToken,operationId){
  if(!hostedShopServiceEnabled(env))return {code:503};
  if(!UUID.test(operationId))return {code:400};
  const [local,journal]=await Promise.all([
    readLocalProvisioning(env.CONTROL_DB,sessionToken,operationId),
    readHostedShopCreate(env.CONTROL_DB,sessionToken,operationId)
  ]);
  if(local.code!==200)return local;
  if(journal.code!==200)return {code:503};
  if(journal.body.operationId!==local.body.operationId||
     journal.body.shopId!==local.body.shopId||
     !Object.hasOwn(STATE,journal.body.state))return {code:503};
  // A future private reconciler may mark the verified operation Ready. Never
  // infer Ready from a created D1 or a service-supplied string.
  return {code:200,body:{
    ...local.body,
    status:local.body.status==='ready'?'ready':STATE[journal.body.state],
    failedStage:local.body.status==='ready'?null:failed(journal.body.failedStage)
  }};
}

export async function hostedShopOperation(env,sessionToken,action,body){
  if(!hostedShopServiceEnabled(env))return {code:503};
  if(!body||typeof body!=='object'||Array.isArray(body))return {code:400};
  if(action==='reserve'){
    if(Object.keys(body).sort().join(',')!=='displayName,operationId,ownerEmail')
      return {code:400};
  }else if(action==='resume'){
    if(Object.keys(body).join(',')!=='operationId')return {code:400};
  }else return {code:400};
  const operationId=body.operationId;
  if(!UUID.test(operationId))return {code:400};
  const task=action==='reserve'?'reserve':
    env.PLATFORM_HOSTED_D1_CREATE_APPROVED==='true'?'advance':'status';
  const outcome=await callService(env,sessionToken,task,body);
  if(![200,202].includes(outcome.code))return outcome;
  const verified=await readHostedShopSetup(env,sessionToken,operationId);
  return verified.code===200?{...verified,code:outcome.code}:verified;
}

export async function listHostedShopSetups(env,sessionToken){
  if(!hostedShopServiceEnabled(env))return {code:503};
  const roster=await listLocalProvisioning(env.CONTROL_DB,sessionToken);
  if(roster.code!==200)return roster;
  if(roster.body.shops.length===0)return roster;
  const operations=roster.body.shops.map(shop=>shop.operationId);
  const placeholders=operations.map(()=>'?').join(',');
  // Filter by the already authorized, bounded (max 50) roster, and never
  // show raw D1 IDs, provider receipts or private worker names.
  const result=await env.CONTROL_DB.prepare(`SELECT operation_id AS operationId,
    state,failed_stage AS failedStage
    FROM platform_hosted_shop_create_journal
    WHERE operation_id IN (${placeholders})`).bind(...operations).all();
  if(result.success!==true)return {code:503};
  const states=new Map(result.results.map(row=>[row.operationId,row]));
  return {code:200,body:{shops:roster.body.shops.map(shop=>{
    const journal=states.get(shop.operationId);
    if(!journal||shop.status==='ready')return shop;
    if(!Object.hasOwn(STATE,journal.state))throw Error('Unreviewed shop stage');
    return {...shop,status:STATE[journal.state],
      failedStage:failed(journal.failedStage)};
  })}};
}
