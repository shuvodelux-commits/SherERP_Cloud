import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildFirstShopCoreCandidate} from '../../scripts/m03-first-shop-core-activation.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const current=()=>({
 name:'shererp',main:'src/m03-owner-redemption-worker.js',
 workers_dev:true,preview_urls:false,
 assets:{directory:'dist-owner',binding:'ASSETS',run_worker_first:true},
 ratelimits:[{name:'OWNER_INGRESS',namespace_id:'654322',simple:{limit:100,period:60}}],
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
