import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OWNER_READY_SHOP_MIGRATION_PLAN} from '../../src/db/m03-owner-ready-shop-migrations.js';
import {assessLiveOwnerPilot,parseLiveOwnerArgs,extractShopEvidence} from '../../scripts/m03-live-owner-readiness.mjs';

const dbId='00000000-0000-4000-8000-000000000201';
const shopId='00000000-0000-4000-8000-000000000101';
const marker='00000000-0000-4000-8000-000000000301';
const d1=(name,id)=>({name,type:'d1',id});
const variable=(name,text)=>({name,type:'plain_text',text});
const flags={
 OWNER_LOGIN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
 OWNER_CATALOG_ENABLED:'false',OWNER_CLEAN_PRODUCTS_ENABLED:'false',
 OWNER_WRITE_GRANTS_ENABLED:'false',OWNER_MVP_PURCHASE_ENABLED:'false',
 OWNER_MVP_POS_CASH_ENABLED:'false',OWNER_MVP_CASH_RETURN_ENABLED:'false'
};
function inputs({change={},shopChange={}}={}){
 const vars={...flags,PLATFORM_PILOT_SHOP_ID:shopId,PLATFORM_PILOT_D1_ID:dbId,
   PLATFORM_PILOT_MARKER:marker,...change};
 return {
   version:{resources:{bindings:[
     d1('CONTROL_DB','00000000-0000-4000-8000-000000000401'),
     d1('PLATFORM_PILOT_DB',dbId),
     ...Object.entries(vars).map(([name,text])=>variable(name,text))
   ]}},
   shop:{
     identity:{shop_id:shopId,database_id:dbId,database_marker:marker},
     receipts:OWNER_READY_SHOP_MIGRATION_PLAN.map(({name,checksum},i)=>({position:i+1,name,checksum})),
     baselineSealMatches:true,
     tables:['owner_mvp_cash_sessions','owner_mvp_purchase_receipts',
       'owner_mvp_sale_receipts','owner_mvp_sale_return_receipts',
       'owner_supplier_master','products','shop_owner_write_grant'],
     triggers:['owner_mvp_cash_close_guard'],
     supplierCloseIncludesPayments:false,
     hasBusinessRows:false,...shopChange
   }
 };
}
test('live Owner login-only release reports the exact disabled business gates, not a missing D1',()=>{
 const report=assessLiveOwnerPilot(inputs());
 assert.equal(report.status,'BLOCKED');
 assert.equal(report.authConfigured,true);
 assert.equal(report.shopIdentityVerified,true);
 assert.equal(report.baseline13Verified,true);
 assert.equal(report.coreReadConfigured,false);
 assert.equal(report.coreWriteConfigured,false);
 assert.ok(report.blockers.includes('OWNER_CATALOG_ENABLED_DISABLED'));
 assert.ok(report.blockers.includes('OWNER_WRITE_GRANTS_ENABLED_DISABLED'));
 assert.ok(report.blockers.includes('OWNER_MVP_POS_CASH_ENABLED_DISABLED'));
 assert.ok(report.blockers.includes('SUPPLIER_CASH_MIGRATION_0010_MISSING'));
 assert.ok(report.blockers.includes('SUPPLIER_CASH_RECONCILIATION_0011_MISSING'));
 assert.ok(!report.blockers.includes('SHOP_D1_MISSING'));
 assert.ok(!JSON.stringify(report).includes(dbId));
 assert.ok(!JSON.stringify(report).includes(shopId));
});
test('enablement flags alone do not create release permission or excuse missing SQL migration',()=>{
 const changed=Object.fromEntries(Object.keys(flags).map(k=>[k,'true']));
 const report=assessLiveOwnerPilot(inputs({change:{...changed,OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED:'true'}}));
 assert.equal(report.coreReadConfigured,true);
 assert.equal(report.coreWriteConfigured,true);
 assert.equal(report.status,'BLOCKED');
 assert.ok(report.blockers.includes('SUPPLIER_CASH_MIGRATION_0010_MISSING'));
 assert.ok(report.blockers.includes('SUPPLIER_CASH_RECONCILIATION_0011_MISSING'));
 assert.equal(report.productionReady,false);
});
test('wrong Shop D1 binding, marker, missing receipts, or altered baseline are always blocked',()=>{
 const invalid=[
   inputs({change:{PLATFORM_PILOT_MARKER:'00000000-0000-4000-8000-000000000302'}}),
   inputs({shopChange:{receipts:OWNER_READY_SHOP_MIGRATION_PLAN.slice(0,12)
      .map(({name,checksum},i)=>({position:i+1,name,checksum}))}}),
   inputs({shopChange:{baselineSealMatches:false}}),
   inputs({shopChange:{identity:null}})
 ];
 for(const sample of invalid){
   const r=assessLiveOwnerPilot(sample);
   assert.equal(r.status,'BLOCKED');
   assert.equal(r.productionReady,false);
 }
});
test('a verified additive Supplier Cash schema is recognized but still needs human go-live gates',()=>{
 const configured=Object.fromEntries(Object.keys(flags).map(k=>[k,'true']));
 const sample=inputs({change:{...configured,OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED:'true'},
   shopChange:{
     baselineSealMatches:true,
     tables:[...inputs().shop.tables,'owner_mvp_supplier_cash_payment_receipts',
       'owner_mvp_supplier_payment_cash_book'],
     triggers:['owner_mvp_cash_close_guard'],
     supplierCloseIncludesPayments:true
   }});
 const report=assessLiveOwnerPilot(sample);
 assert.equal(report.supplierCashConfigured,true);
 assert.equal(report.productionReady,false);
 assert.ok(report.releaseChecks.includes('M10_M11_RESTORE_REHEARSAL_REQUIRED'));
 assert.ok(report.releaseChecks.includes('AUTHENTICATED_TWO_SHOP_E2E_REQUIRED'));
});

test('even a complete 0010/0011 overlay cannot silently invalidate the pinned 13-step seal',()=>{
 const b=inputs();
 const report=assessLiveOwnerPilot(inputs({shopChange:{
   tables:[...b.shop.tables,'owner_mvp_supplier_cash_payment_receipts',
     'owner_mvp_supplier_payment_cash_book'],
   supplierCloseIncludesPayments:true,
   baselineSealMatches:false
 }}));
 assert.equal(report.baseline13Verified,false);
 assert.ok(report.blockers.includes('BASELINE_13_SCHEMA_SEAL_DRIFT'));
 assert.equal(report.productionReady,false);
});
test('strict live arguments never permit user-provided SQL, shell options or a guessed Worker version',()=>{
 assert.deepEqual(parseLiveOwnerArgs([
   '--version','00000000-0000-4000-8000-000000000501',
   '--shop-db','shererp-shop-001'
 ]),{versionId:'00000000-0000-4000-8000-000000000501',
   shopDbName:'shererp-shop-001'});
 for(const args of [
   ['--version','bad','--shop-db','shererp-shop-001'],
   ['--version','00000000-0000-4000-8000-000000000501',
     '--shop-db','shererp-shop-001;DROP TABLE shop_identity'],
   ['--shop-db','shererp-shop-001'],
   ['--version','00000000-0000-4000-8000-000000000501',
     '--shop-db','--remote']
 ])assert.throws(()=>parseLiveOwnerArgs(args));
});
test('ambiguous remote D1 reads fail closed, source SQL stays internal to the checker',()=>{
 assert.throws(()=>extractShopEvidence({identity:[],receipts:[],seal:[],schema:[]}));
 const evidence=extractShopEvidence({
   identity:[inputs().shop.identity],receipts:inputs().shop.receipts,
   seal:[{matches:1}],
   schema:[
     {name:'owner_mvp_supplier_cash_payment_receipts',type:'table',sql:'CREATE TABLE x'},
     {name:'owner_mvp_cash_close_guard',type:'trigger',
       sql:'CREATE TRIGGER owner_mvp_cash_close_guard ... owner_mvp_supplier_payment_cash_book'}
   ]
 });
 assert.equal(evidence.supplierCloseIncludesPayments,true);
 assert.equal(evidence.baselineSealMatches,true);
 assert.ok(!('schema' in evidence));
});
