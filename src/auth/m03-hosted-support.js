/**
 * Hosted, authenticated READ-ONLY first-Shop Support Mode.
 * Reuses the reviewed local 5-minute grants, audit events and catalog
 * diagnostics, but NEVER trusts the browser for database selection.
 * Hosted pilot binds exactly one Shop D1. Arbitrary tenants remain disabled.
 */
import {verifiedPreboundPilot} from './m03-hosted-prebound-pilot.js';
import {issueLocalSupportReadGrant,revokeLocalSupportReadGrant} from
  '../modules/m03-local-support-read-grants.js';
import {inspectLocalSupportShop} from '../modules/m03-local-support-shop-diagnostics.js';

const FIELDS=Object.freeze({
  start:['shopId','operationId','reason'],
  diagnostics:['shopId','eventId','supportToken'],
  end:['shopId','operationId'],
});
const RESP={
  invalid:{status:400,body:{error:'Invalid support request'}},
  denied:{status:403,body:{error:'Support access denied'}},
  unavailable:{status:503,body:{error:'Support unavailable'}},
};

const validBody=(body,fields)=>body!==null&&typeof body==='object'&&
  !Array.isArray(body)&&Object.keys(body).length===fields.length&&
  fields.every(key=>Object.hasOwn(body,key)&&typeof body[key]==='string');

export function hostedSupportEnabled(env){
  return env?.PLATFORM_HOSTED_SUPPORT_ENABLED==='true'&&
    env.PLATFORM_HOSTED_PILOT_ENABLED==='true'&&
    env.PLATFORM_SHOP_RESERVATION_ENABLED==='true';
}

async function readyPilot(env,shopId){
  if(!hostedSupportEnabled(env))return null;
  const pilot=await verifiedPreboundPilot(env);
  if(!pilot||pilot.shopId!==shopId)return null;
  const row=await env.CONTROL_DB.prepare(`SELECT 1
    FROM platform_shop_provisioning p
    JOIN platform_shop_bindings b ON b.shop_id=p.shop_id
    WHERE p.shop_id=? AND p.stage='ready'
      AND p.database_id=? AND p.database_marker=?
      AND b.database_id=p.database_id AND b.database_marker=p.database_marker`)
    .bind(shopId,pilot.databaseId,pilot.databaseMarker).first();
  return row?pilot:null;
}

export async function hostedSupportRequest(env,action,body,sessionToken){
  const fields=FIELDS[action];
  if(!fields)return {status:404,body:{error:'Not found'}};
  if(!validBody(body,fields))return RESP.invalid;
  if(!sessionToken)return {status:401,body:{error:'Sign in to use Support Mode'}};
  try{
    // SQL verifies the *current* platform MFA-backed session and immutable
    // binding for each action; no operation is authorized by a stale UI flag.
    const scope=await readyPilot(env,body.shopId);
    if(!scope)return RESP.denied;
    let result;
    if(action==='start'){
      result=await issueLocalSupportReadGrant(env.CONTROL_DB,scope,{
        operationId:body.operationId,reason:body.reason,sessionToken,
      });
      if(result.status==='created')return {status:201,body:result};
      if(result.status==='replayed')return {status:200,body:{status:'replayed'}};
    }else if(action==='diagnostics'){
      result=await inspectLocalSupportShop(env.CONTROL_DB,scope,{
        eventId:body.eventId,supportToken:body.supportToken,sessionToken,
      });
      if(['ok','schema-incomplete'].includes(result?.status))
        return {status:200,body:result};
    }else{
      result=await revokeLocalSupportReadGrant(env.CONTROL_DB,scope,{
        operationId:body.operationId,sessionToken,
      });
      if(result.status==='revoked')return {status:200,body:{status:'revoked'}};
    }
    return result?.status==='invalid'?RESP.invalid:RESP.denied;
  }catch{
    // No SQLite details, Owner token, Shop ID or provider secrets leak.
    return RESP.unavailable;
  }
}
