/**
 * Private, loopback-only M04 staff import transport.
 * Never import this module from src/index.js or the public RPC registry.
 * A reviewed, separate local Wrangler operator supplies the single private
 * D1 binding and an ephemeral token; this file NEVER deploys a Worker.
 *
 * Secret-bearing request bodies must not be logged, cached, or echoed.
 * The imported rows are written only by the existing SQL-atomic M04 helper.
 */
import {prepareAdminFirstLegacyStaffEnrollment} from './m04-admin-first-enrollment.js';
import {importLegacyStaffSnapshotWithD1} from './d1-offline-staff-import.js';

const PATH='/_private/m04/staff-import-once';
const STAGING_ID='aa04618e-1639-4cb9-bdf5-7b967d8b968b';
const TEST_ID='00000000-0000-0000-0000-000000000022';
const MAX_BYTES=64*1024;

const headers={
 'cache-control':'no-store',
 'content-type':'application/json; charset=utf-8',
 'x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer',
};
const json=(status,object)=>new Response(JSON.stringify(object),{status,headers});
const hidden=()=>new Response('',{status:404,headers:{'cache-control':'no-store'}});
const rejected=()=>json(409,{accepted:false});
const ownExact=(obj,keys)=>{
 if(!obj||typeof obj!=='object'||Array.isArray(obj))return false;
 const values=Reflect.ownKeys(obj);
 return Object.getPrototypeOf(obj)===Object.prototype &&
   values.length===keys.length&&
   values.every(k=>typeof k==='string'&&keys.includes(k));
};
function sameToken(actual,expected){
 if(typeof actual!=='string'||typeof expected!=='string'||expected.length<40||
    expected.length>256||actual.length>256)return false;
 let mismatch=actual.length^expected.length;
 for(let i=0;i<expected.length;i++)
  mismatch|=(actual.charCodeAt(i)||0)^expected.charCodeAt(i);
 return mismatch===0;
}
function allowedEnvironment(env){
 if(!env||typeof env!=='object'||!env.DB||typeof env.DB.batch!=='function')return false;
 const scope=env.M04_PRIVATE_SCOPE;
 const uuid=env.M04_D1_UUID;
 return (scope==='synthetic-workerd-only'&&uuid===TEST_ID)||
   (scope==='private-staging-one-shot'&&uuid===STAGING_ID);
}
function loopbackOnly(request){
 try{
  const url=new URL(request.url);
  return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&
   url.pathname===PATH&&url.search===''&&
   request.method==='POST'&&request.headers.get('origin')===null&&
   request.headers.get('cookie')===null&&
   request.headers.get('content-type')==='application/json';
 }catch{return false;}
}

/** Import requests must originate from the reviewed local operator process. */
export async function handlePrivateM04Import(request,env){
 if(!allowedEnvironment(env)||!loopbackOnly(request))return hidden();
 const bearer=request.headers.get('authorization');
 const token=env.M04_IMPORT_TOKEN;
 if(!sameToken(typeof bearer==='string'&&bearer.startsWith('Bearer ')?bearer.slice(7):'',token))
  return hidden();

 try{
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))return rejected();
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>MAX_BYTES)return rejected();
  const input=JSON.parse(raw);
  if(!ownExact(input,['first','confirmation']))return rejected();
  const prepared=prepareAdminFirstLegacyStaffEnrollment(input.first,input.confirmation);
  // The existing importer owns the single database batch and exact readback.
  // D1's nonempty-store claim prevents a second/concurrent successful import.
  const outcome=await importLegacyStaffSnapshotWithD1(env.DB,prepared.snapshot);
  if(!outcome.imported||!outcome.readbackMatch||
     outcome.counts?.users!==prepared.report.importableUsers||
     outcome.counts?.roles!==prepared.report.sourceRoles||
     outcome.counts?.legacyCredentials!==prepared.report.importableUsers)
   return rejected();
  return json(200,{
   imported:true,
   originalUsers:prepared.report.originalUsers,
   importedUsers:outcome.counts.users,
   importedRoles:outcome.counts.roles,
   pendingLegacyCredentials:outcome.counts.legacyCredentials,
   deferredOwnerUsers:prepared.report.deferredOwnerUsers,
   sourceTwoPassMatch:prepared.report.sourceTwoPassMatch,
   readbackMatch:true,
   publicAuthenticationEnabled:false,
   productionReady:false,
  });
 }catch{
  // An error must never disclose SQL, source identity, credential, or token.
  return rejected();
 }
}
export default {fetch:handlePrivateM04Import};
