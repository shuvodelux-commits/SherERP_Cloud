#!/usr/bin/env node
/**
 * M03 non-deploying documentary preflight for the existing STAGING D1,
 * before any proposed 0003/0004 authentication-only schema promotion.
 *
 * Input: non-sensitive, read-only Cloudflare D1 list + exact sqlite_master
 * table/trigger and d1_migrations SELECT results. It never issues SQL, uses
 * credentials, writes D1 or authorizes application deployment.
 */
import {validateStagingConfig} from './check-staging-d1.mjs';
import {assertExactD1Resource} from './guard-remote-staging.mjs';

const rejected=()=>new Error('M03 staging auth prefix rejected');
const TABLES=Object.freeze([
 'd1_migrations','parties','party_identity_review','party_legacy_links',
 'party_roles','product_categories','product_units','settings',
]);
const TRIGGERS=Object.freeze([
 'trg_party_cross_source_verification',
 'trg_party_legacy_identity_immutable',
 'trg_party_legacy_link_delete_forbidden',
 'trg_party_role_delete_forbidden',
]);
const MIGRATIONS=Object.freeze([
 '0001_core_catalog.sql','0002_party_identity.sql',
]);
const NEXT=Object.freeze([
 '0003_auth_core.sql','0004_auth_source_provenance.sql',
]);

function own(obj,key){
 if(!obj||typeof obj!=='object')throw rejected();
 const d=Object.getOwnPropertyDescriptor(obj,key);
 if(!d||!Object.hasOwn(d,'value')||d.enumerable!==true)throw rejected();
 return d.value;
}
function exactObject(obj,keys){
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(obj)))throw rejected();
 const seen=Reflect.ownKeys(obj);
 if(seen.length!==keys.length||
    seen.some(x=>typeof x!=='string'||!keys.includes(x)))throw rejected();
 const out=Object.create(null);
 for(const key of keys)out[key]=own(obj,key);
 return out;
}
function exactArray(items){
 if(!Array.isArray(items)||Object.getPrototypeOf(items)!==Array.prototype||
    items.length>100||Reflect.ownKeys(items).length!==items.length+1)throw rejected();
 const output=[];
 for(let i=0;i<items.length;i++)output.push(own(items,String(i)));
 return output;
}
function sourceResult(result,rowKeys){
 const pieces=exactArray(result);
 if(pieces.length!==1)throw rejected();
 const wrapper=exactObject(pieces[0],['results','success','meta']);
 if(wrapper.success!==true)throw rejected();
 const changed=own(wrapper.meta,'changed_db');
 const written=own(wrapper.meta,'rows_written');
 if(changed!==false||written!==0)throw rejected();
 const rows=exactArray(wrapper.results);
 return rows.map(record=>exactObject(record,rowKeys));
}
function sameOrder(left,right){
 return left.length===right.length && left.every((name,i)=>name===right[i]);
}
function resourceList(raw){
 const list=exactArray(raw);
 return list.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(item)))throw rejected();
  const name=own(item,'name'),uuid=own(item,'uuid');
  if(typeof name!=='string'||typeof uuid!=='string')throw rejected();
  return {name,uuid};
 });
}

/** Only validates a metadata assertion; never authorizes remote migration. */
export function assessExistingStagingForAuthPrefix(input){
 try{
  const source=exactObject(input,[
   'staging','preview','resources','tables','triggers','migrations',
  ]);
  validateStagingConfig(source.staging,source.preview);
  assertExactD1Resource(resourceList(source.resources));
  const tables=sourceResult(source.tables,['name']).map(x=>x.name);
  const triggers=sourceResult(source.triggers,['name']).map(x=>x.name);
  const migrations=sourceResult(source.migrations,['id','name']);
  if(!sameOrder(tables,TABLES)||!sameOrder(triggers,TRIGGERS)||
     migrations.length!==2||
     migrations.some((row,i)=>row.id!==i+1||row.name!==MIGRATIONS[i]))throw rejected();
  return Object.freeze({
   reportVersion:1,
   scope:'M03-existing-staging-auth-prefix-read-only-rehearsal',
   existingMigrationCount:2,
   existingApplicationTables:7,
   existingPartyTriggers:4,
   existingAuthTables:0,
   nextReviewedAuthMigrations:NEXT,
   documentaryPrefixMatch:true,
   recoveryBookmarkAttested:false,
   staffIdentityReviewApproved:false,
   remoteMigrationAuthorized:false,
   staffImportAuthorized:false,
   publicAuthenticationEnabled:false,
   productionReady:false,
  });
 }catch{throw rejected();}
}
