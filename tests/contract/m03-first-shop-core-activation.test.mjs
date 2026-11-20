import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildFirstShopCoreCandidate,prepareFirstShopCoreCandidate} from '../../scripts/m03-first-shop-core-activation.mjs';
import {buildLoginOnlyProfileFromLiveVersion} from '../../scripts/m03-first-shop-live-base.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const current=()=>({
 name:'shererp',main:'src/m03-owner-redemption-worker.js',
 workers_dev:true,preview_urls:false,
 assets:{directory:'dist-owner',binding:'ASSETS',run_worker_first:true},
 ratelimits:[{name:'OWNER_INGRESS',namespace_id:'654322',simple:{limit:20,period:60}}],
 d1_databases:[
  {binding:'CONTROL_DB',database_id:uuid(1),database_name:'control-test'},
  {binding:'PLATFORM_PILOT_DB',database_id:uuid(2),database_name:'shop-test'}
 ],
 vars:{
  OWNER_AUTH_ORIGIN:'https://shererp.hisab.workers.dev',
  PLATFORM_AUTH_ORIGIN:'https://admin.hisab.workers.dev',
  PLATFORM_OWNER_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
  PLATFORM_PILOT_SHOP_ID:uuid(3),PLATFORM_PILOT_D1_ID:uuid(2),
  PLATFORM_PILOT_MARKER:uuid(4),
  OWNER_LOGIN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
  OWNER_GMAIL_SIGNUP_ENABLED:'true',OWNER_REDEMPTION_ENABLED:'false',
  OWNER_SUPPORT_AUDIT_ENABLED:'false',
  OWNER_CATALOG_ENABLED:'false',OWNER_CLEAN_PRODUCTS_ENABLED:'false',
  OWNER_WRITE_GRANTS_ENABLED:'false',OWNER_MVP_PURCHASE_ENABLED:'false',
  OWNER_MVP_POS_CASH_ENABLED:'false',OWNER_MVP_CASH_RETURN_ENABLED:'false'
 }
});
const blockers=[
 'OWNER_CATALOG_ENABLED_DISABLED','OWNER_CLEAN_PRODUCTS_ENABLED_DISABLED',
 'OWNER_WRITE_GRANTS_ENABLED_DISABLED','OWNER_MVP_PURCHASE_ENABLED_DISABLED',
 'OWNER_MVP_POS_CASH_ENABLED_DISABLED','OWNER_MVP_CASH_RETURN_ENABLED_DISABLED',
 'SUPPLIER_CASH_MIGRATION_0010_MISSING',
 'SUPPLIER_CASH_RECONCILIATION_0011_MISSING',
 'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED_DISABLED'
];
const evidence=()=>({
 status:'BLOCKED',productionReady:false,authConfigured:true,
 shopIdentityVerified:true,baseline13Verified:true,coreReadConfigured:false,
 coreWriteConfigured:false,supplierCashConfigured:false,blockers
});
const approval='FIRST_SHOP_CORE_MVP_TEST_ONLY';
test('RED: prepare only the existing first-Shop Product/Purchase/Cash/POS core release',()=>{
 const base=current(),core=buildFirstShopCoreCandidate(base,evidence(),approval);
 assert.equal(core.name,'shererp');
 assert.equal(core.vars.OWNER_CATALOG_ENABLED,'true');
 assert.equal(core.vars.OWNER_CLEAN_PRODUCTS_ENABLED,'true');
 assert.equal(core.vars.OWNER_WRITE_GRANTS_ENABLED,'true');
 assert.equal(core.vars.OWNER_MVP_PURCHASE_ENABLED,'true');
 assert.equal(core.vars.OWNER_MVP_POS_CASH_ENABLED,'true');
 assert.equal(core.vars.OWNER_MVP_CASH_RETURN_ENABLED,'false');
 assert.equal(core.vars.OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED,'false');
 assert.equal(core.vars.OWNER_SUPPORT_AUDIT_ENABLED,'false');
 assert.deepEqual(core.d1_databases,base.d1_databases);
 assert.deepEqual(core.ratelimits,base.ratelimits);
 assert.deepEqual(core.assets,base.assets);
 assert.equal(base.vars.OWNER_CATALOG_ENABLED,'false','never mutate login-only input');
});
test('RED: no activation without exact approved Shop binding and 13 receipts',()=>{
 const malformed=[
  {baseline13Verified:false},
  {shopIdentityVerified:false},
  {authConfigured:false},
  {status:'CHECKS_REQUIRED'},
  {blockers:[...blockers,'UNKNOWN_UNREVIEWED_SCHEMA']},
  {blockers:blockers.slice(0,-1)}
 ];
 for(const mutation of malformed)assert.throws(()=>buildFirstShopCoreCandidate(
   current(),{...evidence(),...mutation},approval));
});
const migratedBlockers=blockers.filter(x=>
 !['SUPPLIER_CASH_MIGRATION_0010_MISSING',
   'SUPPLIER_CASH_RECONCILIATION_0011_MISSING'].includes(x));
const migratedEvidence=()=>({...evidence(),
 approvedSupplierOverlayVerified:true,blockers:migratedBlockers});

test('core-only first-Shop release accepts the exact approved 0010+0011 overlay',()=>{
 const base=current();
 const core=buildFirstShopCoreCandidate(base,migratedEvidence(),approval);
 assert.equal(core.vars.OWNER_CATALOG_ENABLED,'true');
 assert.equal(core.vars.OWNER_MVP_POS_CASH_ENABLED,'true');
 assert.equal(core.vars.OWNER_MVP_CASH_RETURN_ENABLED,'false');
 assert.equal(core.vars.OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED,'false');
 assert.deepEqual(core.d1_databases,base.d1_databases);
 assert.equal(base.vars.OWNER_CATALOG_ENABLED,'false','do not modify signed input');
});

test('core release rejects incomplete, contradictory and unverified migrated schema evidence',()=>{
 for(const changed of [
   {approvedSupplierOverlayVerified:false},
   {approvedSupplierOverlayVerified:undefined},
   {approvedSupplierOverlayVerified:'true'},
   {blockers:[...migratedBlockers,'SUPPLIER_CASH_MIGRATION_0010_MISSING']},
   {blockers:[...blockers],approvedSupplierOverlayVerified:true},
   {blockers:migratedBlockers.slice(1)},
   {blockers:[...migratedBlockers,'BASELINE_13_SCHEMA_SEAL_DRIFT']},
   {baseline13Verified:false}
 ]){
   assert.throws(()=>buildFirstShopCoreCandidate(
     current(),{...migratedEvidence(),...changed},approval));
 }
 assert.throws(()=>buildFirstShopCoreCandidate(current(),
   {...evidence(),approvedSupplierOverlayVerified:true},approval),
   'old missing-migration report may not falsely claim approved overlay');
});

test('RED: no generic multi-shop, swapped binding, public preview, or writable returns',()=>{
 const changes=[
  b=>b.d1_databases.push({binding:'SHOP_A',database_id:uuid(5),database_name:'shop-other'}),
  b=>b.d1_databases[1].database_id=uuid(5),
  b=>b.preview_urls=true,
  b=>b.name='shererp-staging',
  b=>b.vars.OWNER_MVP_CASH_RETURN_ENABLED='true',
  b=>b.vars.OWNER_WRITE_GRANTS_ENABLED='true',
  b=>b.vars.OWNER_AUTH_ORIGIN='https://evil.example',
  b=>b.main='src/index.js'
 ];
 for(const mutate of changes){
  const b=current();mutate(b);
  assert.throws(()=>buildFirstShopCoreCandidate(b,evidence(),approval));
 }
 assert.throws(()=>buildFirstShopCoreCandidate(current(),evidence(),'wrong'));
});

test('RED: derive same private one-Shop profile from actual Wrangler version bindings',()=>{
 const base=current();
 const bindings=[
  {name:'ASSETS',type:'assets'},
  ...base.d1_databases.map(db=>({name:db.binding,type:'d1',database_id:db.database_id})),
  ...base.ratelimits.map(x=>({...x,type:'ratelimit'})),
  ...Object.entries(base.vars).map(([name,text])=>({name,type:'plain_text',text}))
 ];
 const profile=buildLoginOnlyProfileFromLiveVersion(
  {resources:{bindings}},'0123456789abcdef0123456789abcdef');
 const core=buildFirstShopCoreCandidate(profile,evidence(),approval);
 assert.equal(core.vars.OWNER_MVP_POS_CASH_ENABLED,'true');
 assert.equal(core.vars.OWNER_MVP_CASH_RETURN_ENABLED,'false');
 assert.equal(profile.d1_databases[1].database_id,base.d1_databases[1].database_id);
 assert.equal(profile.vars.PLATFORM_PILOT_MARKER,base.vars.PLATFORM_PILOT_MARKER);
 assert.equal(profile.preview_urls,false);
 for(const corrupt of [
  bindings.filter(b=>b.name!=='OWNER_INGRESS'),
  bindings.map(b=>b.name==='PLATFORM_PILOT_DB'?{...b,database_id:uuid(9)}:b),
  [...bindings,{name:'UNREVIEWED_SHOP',type:'d1',database_id:uuid(10)}],
  bindings.map(b=>b.name==='OWNER_MVP_POS_CASH_ENABLED'?{...b,text:'true'}:b)
 ]){
  assert.throws(()=>buildLoginOnlyProfileFromLiveVersion(
   {resources:{bindings:corrupt}},'0123456789abcdef0123456789abcdef'));
 }
});

test('RED: private config nested under .wrangler uses correct Worker and asset paths',async t=>{
 const root=await mkdtemp(join(tmpdir(),'m03-core-candidate-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const path=await prepareFirstShopCoreCandidate(current(),evidence(),approval,root);
 const config=JSON.parse(await readFile(path,'utf8'));
 assert.equal(config.main,'../../src/m03-owner-redemption-worker.js');
 assert.equal(config.assets.directory,'../../dist-owner');
 assert.deepEqual(config.d1_databases.map(x=>x.binding),['CONTROL_DB','PLATFORM_PILOT_DB']);
 await assert.rejects(prepareFirstShopCoreCandidate(current(),evidence(),approval,root),
   /EEXIST/,'immutable candidate cannot be silently replaced');
});
