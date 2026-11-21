#!/usr/bin/env node
/**
 * M11: pure, private, read-only parity check before an Owner UI-only refresh.
 * All output uses fixed codes: no Shop IDs, OAuth client, binding values,
 * account numbers, financial rows or live config should reach CI logs.
 * This tool NEVER authorizes an upload, a flag change or a finance release.
 */
import {lstat,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SHA=/^[a-f0-9]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRUE_FLAGS=Object.freeze([
 'OWNER_LOGIN_ENABLED','OWNER_GMAIL_SIGNUP_ENABLED',
 'OWNER_DASHBOARD_BOOTSTRAP_ENABLED','OWNER_CATALOG_ENABLED',
 'OWNER_CLEAN_PRODUCTS_ENABLED','OWNER_WRITE_GRANTS_ENABLED',
 'OWNER_MVP_PURCHASE_ENABLED','OWNER_MVP_POS_CASH_ENABLED'
]);
const FALSE_FLAGS=Object.freeze([
 'OWNER_MVP_CASH_RETURN_ENABLED','OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED',
 'OWNER_REDEMPTION_ENABLED','OWNER_SUPPORT_AUDIT_ENABLED'
]);
const TEXT_KEYS=Object.freeze([
 ...TRUE_FLAGS,...FALSE_FLAGS,'OWNER_AUTH_ORIGIN','PLATFORM_AUTH_ORIGIN',
 'PLATFORM_PILOT_D1_ID','PLATFORM_PILOT_SHOP_ID','PLATFORM_PILOT_MARKER',
 'PLATFORM_OWNER_CLIENT_ID'
]);
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/** Pure strict comparison. The matching result remains *not deployable*. */
export function auditOwnerCoreRefresh({liveVersion,candidate,mainSha,releaseSha}={}){
 const problems=new Set();
 const add=x=>problems.add(x);
 if(typeof mainSha!=='string'||!SHA.test(mainSha)||
    typeof releaseSha!=='string'||!SHA.test(releaseSha)||mainSha!==releaseSha)
   add('M11_REFRESH_SHA_PIN_INVALID');
 if(!isObject(candidate)||candidate.name!=='shererp'||
   candidate.main!=='src/m03-owner-redemption-worker.js'||
   candidate.workers_dev!==true||candidate.preview_urls!==false||
   candidate.keep_vars!==false||candidate.assets?.directory!=='dist-owner'||
   candidate.assets?.binding!=='ASSETS'||candidate.assets?.run_worker_first!==true||
   candidate.routes!==undefined||candidate.route!==undefined||
   candidate.triggers!==undefined||!isObject(candidate.vars))
   add('M11_REFRESH_PROFILE_INVALID');
 const variables=isObject(candidate?.vars)?candidate.vars:{};
 if(!same(Object.keys(variables).sort(),[...TEXT_KEYS].sort())||
   TRUE_FLAGS.some(k=>variables[k]!=='true')||
   FALSE_FLAGS.some(k=>variables[k]!=='false')||
   variables.OWNER_AUTH_ORIGIN!=='https://shererp.hisab.workers.dev'||
   variables.PLATFORM_AUTH_ORIGIN!=='https://admin.hisab.workers.dev'||
   !UUID.test(variables.PLATFORM_PILOT_D1_ID)||
   !UUID.test(variables.PLATFORM_PILOT_SHOP_ID)||
   !UUID.test(variables.PLATFORM_PILOT_MARKER)||
   new Set([variables.PLATFORM_PILOT_D1_ID,variables.PLATFORM_PILOT_SHOP_ID,
     variables.PLATFORM_PILOT_MARKER]).size!==3)
   add('M11_REFRESH_VARIABLES_INVALID');
 const db=Array.isArray(candidate?.d1_databases)?candidate.d1_databases:[];
 const rate=Array.isArray(candidate?.ratelimits)?candidate.ratelimits:[];
 if(db.length!==2||db[0]?.binding!=='CONTROL_DB'||
   db[1]?.binding!=='PLATFORM_PILOT_DB'||
   !UUID.test(db[0]?.database_id)||!UUID.test(db[1]?.database_id)||
   db[0]?.database_id===db[1]?.database_id||
   variables.PLATFORM_PILOT_D1_ID!==db[1]?.database_id)
   add('M11_REFRESH_D1_CONFIG_INVALID');
 if(rate.length!==1||rate[0]?.name!=='OWNER_INGRESS'||
   !/^[0-9]{1,15}$/.test(rate[0]?.namespace_id)||
   !isObject(rate[0]?.simple))
   add('M11_REFRESH_RATE_CONFIG_INVALID');
 const bindings=liveVersion?.resources?.bindings;
 const map=new Map();
 if(!Array.isArray(bindings)||bindings.length===0){
   add('M11_REFRESH_LIVE_ROSTER_INVALID');
 }else{
   for(const b of bindings){
     if(!isObject(b)||typeof b.name!=='string'||map.has(b.name)||
       !['assets','d1','ratelimit','plain_text'].includes(b.type)){
       add('M11_REFRESH_LIVE_ROSTER_INVALID');
     }else map.set(b.name,b);
   }
 }
 const expected=new Set(['ASSETS','CONTROL_DB','PLATFORM_PILOT_DB','OWNER_INGRESS',...TEXT_KEYS]);
 if(map.size!==expected.size||[...map.keys()].some(k=>!expected.has(k))||
    [...expected].some(k=>!map.has(k)))
   add('M11_REFRESH_BINDING_ROSTER_DRIFT');
 if(map.get('ASSETS')?.type!=='assets')add('M11_REFRESH_ASSETS_BINDING_DRIFT');
 for(const d of db){
   if(!isObject(d)||typeof d.binding!=='string')continue;
   const current=map.get(d.binding);
   if(current?.type!=='d1'||current.database_id!==d.database_id||
      current.id!==d.database_id)
     add('M11_REFRESH_D1_BINDING_DRIFT');
 }
 for(const l of rate){
   if(!isObject(l)||typeof l.name!=='string')continue;
   const current=map.get(l.name);
   if(current?.type!=='ratelimit'||String(current.namespace_id)!==String(l.namespace_id)||
      !same(current.simple,l.simple))
     add('M11_REFRESH_RATE_BINDING_DRIFT');
 }
 for(const k of TEXT_KEYS){
   const current=map.get(k);
   if(current?.type!=='plain_text'||current.text!==variables[k])
     add('M11_REFRESH_VARIABLE_BINDING_DRIFT');
 }
 const blockers=[...problems].sort();
 return Object.freeze({
   status:blockers.length?'BLOCKED':'MATCHES_LIVE',
   checksLiveBindings:!blockers.length,
   authorizesDeployment:false,productionReady:false,
   blockers:Object.freeze(blockers)
 });
}

async function privateJson(path){
 if(typeof path!=='string'||path.length===0)throw Error('M11_REFRESH_INPUT_INVALID');
 const st=await lstat(resolve(path));
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.size>65536)
   throw Error('M11_REFRESH_INPUT_INVALID');
 const data=JSON.parse(await readFile(resolve(path),'utf8'));
 if(!isObject(data))throw Error('M11_REFRESH_INPUT_INVALID');
 return data;
}

async function main(args){
 if(args.length!==8||args[0]!=='--live-version'||args[2]!=='--candidate'||
   args[4]!=='--main-sha'||args[6]!=='--release-sha')
   throw Error('M11_REFRESH_INPUT_INVALID');
 const liveVersion=await privateJson(args[1]);
 const candidate=await privateJson(args[3]);
 const result=auditOwnerCoreRefresh({
   liveVersion,candidate,mainSha:args[5],releaseSha:args[7]
 });
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.status!=='MATCHES_LIVE')process.exitCode=2;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main(process.argv.slice(2)).catch(()=>{
   process.stderr.write('M11_REFRESH_INPUT_INVALID; no deployment performed\n');
   process.exitCode=2;
 });
}
