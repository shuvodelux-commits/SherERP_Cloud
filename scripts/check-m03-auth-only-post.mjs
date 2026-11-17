#!/usr/bin/env node
/**
 * Read-only post-apply metadata proof for the M03 auth-only private staging
 * schema. This is NOT permission to migrate, deploy or import staff.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AUTH_ONLY_SQL} from './prepare-m03-auth-only-bundle.mjs';

const fail=()=>new Error('M03 auth-only post-apply rejected');
const CORE=Object.freeze([
 'settings','product_categories','product_units','parties',
 'party_roles','party_legacy_links','party_identity_review',
]);
const AUTH=Object.freeze([
 'auth_users','auth_roles','auth_sessions','auth_legacy_credentials',
 'auth_login_throttle',
]);
const PARTY_TRIGGERS=Object.freeze([
 'trg_party_cross_source_verification',
 'trg_party_legacy_identity_immutable',
 'trg_party_legacy_link_delete_forbidden',
 'trg_party_role_delete_forbidden',
]);
const PROVENANCE=Object.freeze([
 'auth_roles.source_created_at_iso',
 'auth_users.source_created_at_iso',
 'auth_users.source_created_by',
 'auth_users.source_last_login_iso',
]);
const keyValue=(obj,key)=>{
 const descriptor=Object.getOwnPropertyDescriptor(obj,key);
 if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)
  throw fail();
 return descriptor.value;
};
function own(obj,keys){
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(obj)))throw fail();
 const found=Reflect.ownKeys(obj);
 if(found.length!==keys.length||
    found.some(k=>typeof k!=='string'||!keys.includes(k)))throw fail();
 const result=Object.create(null);
 for(const key of keys)result[key]=keyValue(obj,key);
 return result;
}
function arr(value){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
    value.length>100||Reflect.ownKeys(value).length!==value.length+1)
   throw fail();
 return Array.from({length:value.length},(_,i)=>keyValue(value,String(i)));
}
function rows(result,keys){
 const q=arr(result);
 if(q.length!==1)throw fail();
 const wrapper=own(q[0],['results','success','meta']);
 if(wrapper.success!==true)throw fail();
 const meta=wrapper.meta;
 if(!meta||typeof meta!=='object'||Array.isArray(meta)||
    keyValue(meta,'changed_db')!==false||
    keyValue(meta,'rows_written')!==0)throw fail();
 return arr(wrapper.results).map(row=>own(row,keys));
}
function same(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i]);}
function sourceTriggers(){
 const text=AUTH_ONLY_SQL.slice(2)
  .map(x=>readFileSync(new URL('../migrations/'+x.name,import.meta.url),'utf8'))
  .join('\n');
 const names=Array.from(text.matchAll(/\bCREATE\s+TRIGGER\s+([a-z][a-z0-9_]*)/gi),m=>m[1]);
 if(names.length<10||new Set(names).size!==names.length)throw fail();
 return [...PARTY_TRIGGERS,...names].sort();
}
/** Accept only the exact D1 read-only metadata proof after a reviewed apply. */
export function assessM03AuthOnlyPostApply(input){
 try{
  const obj=own(input,['migrations','tables','triggers','columns','emptyAuth']);
  const migrations=rows(obj.migrations,['id','name']);
  const expected=AUTH_ONLY_SQL.map(x=>x.name);
  if(migrations.length!==4||migrations.some((x,i)=>x.id!==i+1||x.name!==expected[i]))
    throw fail();
  const tables=rows(obj.tables,['name']).map(x=>x.name);
  if(!same(tables,[...CORE,'d1_migrations',...AUTH].sort()))throw fail();
  const triggers=rows(obj.triggers,['name']).map(x=>x.name);
  if(!same(triggers,sourceTriggers()))throw fail();
  const fields=rows(obj.columns,['table_name','name'])
   .map(x=>x.table_name+'.'+x.name);
  if(!same(fields,PROVENANCE))throw fail();
  const counts=rows(obj.emptyAuth,['users','roles','legacy_credentials','sessions','throttle']);
  if(counts.length!==1||Object.values(counts[0]).some(x=>x!==0))throw fail();
  return Object.freeze({
   reportVersion:1,
   scope:'M03-auth-only-schema-after-apply-documentary-verification',
   documentaryPostSchemaMatch:true,
   appliedMigrationCount:4,
   preservedCoreTableCount:7,
   preservedPartyTriggerCount:4,
   authTableCount:5,
   authSourceProvenanceColumns:4,
   authRecordsCreatedBySchema:0,
   remoteMigrationAuthorized:false,
   staffImportAuthorized:false,
   publicAuthenticationEnabled:false,
   productionReady:false,
  });
 }catch{throw fail();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw fail();
  const r=assessM03AuthOnlyPostApply(JSON.parse(readFileSync(resolve(process.argv[2]),'utf8')));
  process.stdout.write(JSON.stringify(r)+'\n');
 }catch{
  process.stderr.write('M03 auth-only post-apply rejected\n');
  process.exitCode=2;
 }
}
