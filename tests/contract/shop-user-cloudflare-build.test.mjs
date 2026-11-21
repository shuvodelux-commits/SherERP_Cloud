import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildShopUserDeployment,writeShopUserDeployment}
  from '../../scripts/build-shop-user-deploy.mjs';

const buildEnv=()=>({
  WORKERS_CI:'1',
  WORKERS_CI_BRANCH:'main',
  SHERERP_OWNER_LOGIN_RELEASE:'OWNER_LOGIN_ONLY_APPROVED',
  SHERERP_ACCOUNT_ID:'0123456789abcdef0123456789abcdef',
  SHERERP_CONTROL_DB_NAME:'shop-control',
  SHERERP_CONTROL_DB_ID:'11111111-1111-4111-8111-111111111111',
  SHERERP_SHOP_DB_NAME:'shop-first',
  SHERERP_SHOP_DB_ID:'22222222-2222-4222-8222-222222222222',
  SHERERP_SHOP_ID:'33333333-3333-4333-8333-333333333333',
  SHERERP_SHOP_MARKER:'44444444-4444-4444-8444-444444444444',
  SHERERP_OWNER_GOOGLE_CLIENT_ID:'123-fixture.apps.googleusercontent.com',
  SHERERP_OWNER_RATE_LIMIT_NAMESPACE:'654322'
});

test('builds root Wrangler profile for the existing shop URL and Google Owner login',()=>{
  const config=buildShopUserDeployment(buildEnv());
  assert.equal(config.name,'shererp');
  assert.equal(config.account_id,buildEnv().SHERERP_ACCOUNT_ID);
  assert.equal(config.main,'src/m03-owner-redemption-worker.js');
  assert.equal(config.assets.directory,'dist-owner');
  assert.equal(config.assets.binding,'ASSETS');
  assert.equal(config.assets.run_worker_first,true);
  assert.equal(config.vars.OWNER_AUTH_ORIGIN,'https://shererp.hisab.workers.dev');
  assert.equal(config.vars.PLATFORM_AUTH_ORIGIN,'https://admin.hisab.workers.dev');
  assert.equal(config.vars.OWNER_LOGIN_ENABLED,'true');
  assert.equal(config.vars.OWNER_GMAIL_SIGNUP_ENABLED,'true');
  assert.equal(config.vars.OWNER_DASHBOARD_BOOTSTRAP_ENABLED,'true');
  assert.equal(config.vars.OWNER_REDEMPTION_ENABLED,'false');
  assert.equal(config.vars.PLATFORM_OWNER_CLIENT_ID,buildEnv().SHERERP_OWNER_GOOGLE_CLIENT_ID);
  assert.equal(config.workers_dev,true);
  assert.equal(config.preview_urls,false);
  assert.equal(config.keep_vars,false);
});

test('binds only the verified pilot and control D1 tuples, no source-money writes',()=>{
  const config=buildShopUserDeployment(buildEnv());
  assert.deepEqual(config.d1_databases.map(item=>item.binding),['CONTROL_DB','PLATFORM_PILOT_DB']);
  assert.deepEqual(config.d1_databases.map(item=>item.database_id),[
    buildEnv().SHERERP_CONTROL_DB_ID,buildEnv().SHERERP_SHOP_DB_ID
  ]);
  assert.deepEqual(config.d1_databases.map(item=>item.migrations_dir),[
    'staging-migrations/platform-onboarding','staging-migrations/shop-identity'
  ]);
  assert.equal(config.vars.PLATFORM_PILOT_SHOP_ID,buildEnv().SHERERP_SHOP_ID);
  assert.equal(config.vars.PLATFORM_PILOT_MARKER,buildEnv().SHERERP_SHOP_MARKER);
  assert.equal(config.ratelimits[0].name,'OWNER_INGRESS');
  for(const key of ['OWNER_CATALOG_ENABLED','OWNER_CLEAN_PRODUCTS_ENABLED',
    'OWNER_WRITE_GRANTS_ENABLED','OWNER_MVP_PURCHASE_ENABLED',
    'OWNER_MVP_POS_CASH_ENABLED','OWNER_MVP_CASH_RETURN_ENABLED','OWNER_SUPPORT_AUDIT_ENABLED']){
    assert.equal(config.vars[key],'false',key);
  }
  assert.equal(JSON.stringify(config).includes('SHERERP_OWNER_LOGIN_RELEASE'),false);
  assert.equal(JSON.stringify(config).includes('PLATFORM_TOTP_SECRET'),false);
});

test('fails closed outside approved Cloudflare production branch or without authorization',()=>{
  for(const patch of [
    {WORKERS_CI_BRANCH:'feature/login'},
    {WORKERS_CI_BRANCH:''},
    {WORKERS_CI_BRANCH:undefined},
    {WORKERS_CI:'0'},
    {WORKERS_CI:undefined},
    {SHERERP_OWNER_LOGIN_RELEASE:'yes'},
    {SHERERP_OWNER_LOGIN_RELEASE:undefined}
  ])assert.throws(()=>buildShopUserDeployment({...buildEnv(),...patch}),/Shop-user deployment/);
});

test('fails closed with invalid, missing or conflicting IDs, Google client or configuration',()=>{
  for(const patch of [
    {SHERERP_ACCOUNT_ID:''},
    {SHERERP_CONTROL_DB_ID:buildEnv().SHERERP_SHOP_DB_ID},
    {SHERERP_SHOP_DB_ID:'00000000-0000-0000-0000-000000000000'},
    {SHERERP_SHOP_MARKER:''},
    {SHERERP_SHOP_ID:'not-uuid'},
    {SHERERP_OWNER_GOOGLE_CLIENT_ID:'demo-secret'},
    {SHERERP_OWNER_RATE_LIMIT_NAMESPACE:'0'},
    {CLOUDFLARE_ACCOUNT_ID:'ffffffffffffffffffffffffffffffff'}
  ])assert.throws(()=>buildShopUserDeployment({...buildEnv(),...patch}),/Shop-user deployment/);
});

test('build output is ignored, private, idempotent and refuses altered existing config',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shererp-shop-deploy-'));
  try{
    const file=await writeShopUserDeployment(buildEnv(),dir);
    assert.equal(file,join(dir,'wrangler.shop-user.jsonc'));
    assert.equal((await stat(file)).mode&0o077,0);
    assert.equal(JSON.parse(await readFile(file,'utf8')).name,'shererp');
    assert.equal(await writeShopUserDeployment(buildEnv(),dir),file);
    const different={...buildEnv(),SHERERP_SHOP_MARKER:'55555555-5555-4555-8555-555555555555'};
    await assert.rejects(()=>writeShopUserDeployment(different,dir),/Refusing to overwrite/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('never follows a preexisting symlink nor overwrites arbitrary file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shererp-shop-symlink-'));
  try{
    const target=join(dir,'target.txt');
    await writeFile(target,'preserve');
    await symlink(target,join(dir,'wrangler.shop-user.jsonc'));
    await assert.rejects(()=>writeShopUserDeployment(buildEnv(),dir),/Refusing to overwrite/);
    assert.equal(await readFile(target,'utf8'),'preserve');
  }finally{await rm(dir,{recursive:true,force:true});}
});

const approvedReadiness=()=>({
 status:'BLOCKED',productionReady:false,authConfigured:true,
 shopIdentityVerified:true,baseline13Verified:true,
 coreReadConfigured:false,coreWriteConfigured:false,supplierCashConfigured:false,
 blockers:[
  'OWNER_CATALOG_ENABLED_DISABLED','OWNER_CLEAN_PRODUCTS_ENABLED_DISABLED',
  'OWNER_WRITE_GRANTS_ENABLED_DISABLED','OWNER_MVP_PURCHASE_ENABLED_DISABLED',
  'OWNER_MVP_POS_CASH_ENABLED_DISABLED','OWNER_MVP_CASH_RETURN_ENABLED_DISABLED',
  'SUPPLIER_CASH_MIGRATION_0010_MISSING',
  'SUPPLIER_CASH_RECONCILIATION_0011_MISSING',
  'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED_DISABLED'
 ]
});
const coreApprovedEnv=()=>({
 ...buildEnv(),
 WORKERS_CI_COMMIT_SHA:'a'.repeat(40),
 SHERERP_FIRST_SHOP_CORE_RELEASE:'FIRST_SHOP_CORE_MVP_TEST_ONLY',
 SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT:'a'.repeat(40),
 SHERERP_FIRST_SHOP_CORE_READINESS_JSON:JSON.stringify(approvedReadiness())
});
test('RED: only the exact pinned production SHA and D1 evidence activate first-Shop core',()=>{
 const config=buildShopUserDeployment(coreApprovedEnv());
 for(const flag of ['OWNER_CATALOG_ENABLED','OWNER_CLEAN_PRODUCTS_ENABLED',
   'OWNER_WRITE_GRANTS_ENABLED','OWNER_MVP_PURCHASE_ENABLED',
   'OWNER_MVP_POS_CASH_ENABLED'])assert.equal(config.vars[flag],'true');
 for(const flag of ['OWNER_MVP_CASH_RETURN_ENABLED',
   'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED','OWNER_SUPPORT_AUDIT_ENABLED',
   'OWNER_REDEMPTION_ENABLED'])assert.equal(config.vars[flag],'false');
 assert.equal(config.workers_dev,true);
 assert.equal(config.preview_urls,false);
 assert.deepEqual(config.d1_databases.map(b=>b.binding),
   ['CONTROL_DB','PLATFORM_PILOT_DB']);
});
test('RED: future main builds and unverifiable first-Shop release fail instead of silently reverting',()=>{
 const env=coreApprovedEnv();
 for(const patch of [
   {WORKERS_CI_COMMIT_SHA:'b'.repeat(40)},
   {SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT:'b'.repeat(40)},
   {SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT:'invalid'},
   {SHERERP_FIRST_SHOP_CORE_READINESS_JSON:'{}'},
   {SHERERP_FIRST_SHOP_CORE_READINESS_JSON:'not json'},
   {SHERERP_FIRST_SHOP_CORE_READINESS_JSON:JSON.stringify({
      ...approvedReadiness(),shopIdentityVerified:false
   })},
   {SHERERP_FIRST_SHOP_CORE_RELEASE:'UNKNOWN'},
   {WORKERS_CI_BRANCH:'feature/personal'}
 ])assert.throws(()=>buildShopUserDeployment({...env,...patch}),/Shop-user deployment/);
 assert.throws(()=>buildShopUserDeployment({
   ...buildEnv(),SHERERP_FIRST_SHOP_CORE_RELEASE:'FIRST_SHOP_CORE_MVP_TEST_ONLY'
 }),/Shop-user deployment/);
});

test('GitHub-to-Cloudflare release accepts the fully pinned reviewed Supplier overlay but never enables Supplier Pay',()=>{
 const r=approvedReadiness();
 const patched={...r,approvedSupplierOverlayVerified:true,
  blockers:r.blockers.filter(code=>![
   'SUPPLIER_CASH_MIGRATION_0010_MISSING',
   'SUPPLIER_CASH_RECONCILIATION_0011_MISSING'
  ].includes(code))};
 const env={...coreApprovedEnv(),SHERERP_FIRST_SHOP_CORE_READINESS_JSON:JSON.stringify(patched)};
 const c=buildShopUserDeployment(env);
 assert.equal(c.vars.OWNER_MVP_PURCHASE_ENABLED,'true');
 assert.equal(c.vars.OWNER_MVP_CASH_RETURN_ENABLED,'false');
 assert.equal(c.vars.OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED,'false');
 for(const bad of [false,null,undefined]){
  const candidate={...patched,approvedSupplierOverlayVerified:bad};
  assert.throws(()=>buildShopUserDeployment({
   ...env,SHERERP_FIRST_SHOP_CORE_READINESS_JSON:JSON.stringify(candidate)
  }),/Shop-user deployment/);
 }
});

// TDD RED: an already activated first Shop has two approved disabled flags,
// not the seven pre-activation blockers. Do not reuse stale release evidence.
const activeCoreReadiness=()=>({
 status:'BLOCKED',productionReady:false,authConfigured:true,
 shopIdentityVerified:true,baseline13Verified:true,
 approvedSupplierOverlayVerified:true,coreReadConfigured:true,
 coreWriteConfigured:false,supplierCashConfigured:false,
 blockers:[
  'OWNER_MVP_CASH_RETURN_ENABLED_DISABLED',
  'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED_DISABLED'
 ],
 releaseChecks:[
  'APPROVED_PRIVATE_PUBLISHER_REQUIRED',
  'AUTHENTICATED_TWO_SHOP_E2E_REQUIRED',
  'M10_M11_RESTORE_REHEARSAL_REQUIRED',
  'FULL_ORIGINAL_RPC_PARITY_REQUIRED',
  'INDEPENDENT_ACCOUNTING_SECURITY_REVIEW_REQUIRED'
 ]
});
const refreshApprovedEnv=()=>({
 ...coreApprovedEnv(),
 SHERERP_FIRST_SHOP_CORE_RELEASE:'FIRST_SHOP_CORE_MVP_REFRESH',
 SHERERP_FIRST_SHOP_CORE_READINESS_JSON:JSON.stringify(activeCoreReadiness())
});

test('existing first-Shop core refresh accepts only current two-blocker D1 proof and preserves exact bindings',()=>{
 const initial=buildShopUserDeployment(coreApprovedEnv());
 const refresh=buildShopUserDeployment(refreshApprovedEnv());
 assert.deepEqual(refresh,initial,'refresh never changes existing first-Shop runtime authorities');
 assert.deepEqual(refresh.d1_databases.map(d=>d.database_id),[
  buildEnv().SHERERP_CONTROL_DB_ID,buildEnv().SHERERP_SHOP_DB_ID
 ]);
 for(const flag of ['OWNER_MVP_CASH_RETURN_ENABLED',
   'OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED','OWNER_SUPPORT_AUDIT_ENABLED',
   'OWNER_REDEMPTION_ENABLED'])assert.equal(refresh.vars[flag],'false');
});

test('existing core refresh rejects stale core evidence, forbidden money features, wrong owner and SHA',()=>{
 const input=refreshApprovedEnv();
 for(const patch of [
   {SHERERP_FIRST_SHOP_CORE_RELEASE:'FIRST_SHOP_CORE_MVP_TEST_ONLY'},
   {SHERERP_FIRST_SHOP_CORE_RELEASE:'OTHER'},
   {SHERERP_DEPLOYMENT_OWNER:'PRIVATE_PROVISIONER'},
   {WORKERS_CI_COMMIT_SHA:'b'.repeat(40)},
   {SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT:'b'.repeat(40)},
   {WORKERS_CI_BRANCH:'feature/changed'},
   {SHERERP_SHOP_DB_ID:buildEnv().SHERERP_CONTROL_DB_ID}
 ])assert.throws(()=>buildShopUserDeployment({...input,...patch}),/Shop-user deployment/);
 for(const evidencePatch of [
   {approvedSupplierOverlayVerified:false},
   {shopIdentityVerified:false},
   {baseline13Verified:false},
   {coreReadConfigured:false},
   {coreWriteConfigured:true},
   {supplierCashConfigured:true},
   {productionReady:true},
   {status:'CHECKS_REQUIRED'},
   {blockers:[]},
   {blockers:['OWNER_MVP_CASH_RETURN_ENABLED_DISABLED']},
   {blockers:['OWNER_MVP_CASH_RETURN_ENABLED_DISABLED','OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED_DISABLED','UNKNOWN']},
   {releaseChecks:[]},
   {releaseChecks:undefined}
 ])assert.throws(()=>buildShopUserDeployment({
   ...input,SHERERP_FIRST_SHOP_CORE_READINESS_JSON:JSON.stringify({
     ...activeCoreReadiness(),...evidencePatch
   })
 }),/Shop-user deployment/);
 assert.throws(()=>buildShopUserDeployment({
   ...coreApprovedEnv(),SHERERP_FIRST_SHOP_CORE_RELEASE:'FIRST_SHOP_CORE_MVP_REFRESH'
 }),/Shop-user deployment/,'pre-activation proof cannot authorize an active-core refresh');
});

// M11 / #690: never publish raw protected Build values while explaining why
// a merged Owner frontend has not been deployed.
test('M11 RED: pin mismatch has an actionable code without exposing the protected values',()=>{
 const env={...refreshApprovedEnv(),
   WORKERS_CI_COMMIT_SHA:'b'.repeat(40),
   SHERERP_OWNER_GOOGLE_CLIENT_ID:'SECRET_CANARY.apps.googleusercontent.com'};
 assert.throws(()=>buildShopUserDeployment(env),error=>
   error.code==='RELEASE_COMMIT_PIN_MISMATCH' &&
   !error.message.includes('SECRET_CANARY') &&
   !error.message.includes(env.WORKERS_CI_COMMIT_SHA));
});

test('M11 RED: blocked Builds report distinguishes incomplete commit pin and malformed readiness safely',()=>{
 const env=refreshApprovedEnv();
 for(const [patch,code] of [
   [{WORKERS_CI_COMMIT_SHA:undefined},'RELEASE_COMMIT_PIN_INVALID'],
   [{SHERERP_FIRST_SHOP_CORE_READINESS_JSON:'TOP_SECRET_CANARY'},'RELEASE_READINESS_JSON_INVALID'],
   [{SHERERP_FIRST_SHOP_CORE_READINESS_JSON:JSON.stringify(approvedReadiness())},'RELEASE_READINESS_PROFILE_MISMATCH'],
   [{SHERERP_DEPLOYMENT_OWNER:'PRIVATE_PROVISIONER'},'RELEASE_OWNED_BY_PRIVATE_PROVISIONER']
 ])assert.throws(()=>buildShopUserDeployment({...env,...patch}),error=>
   error.code===code && !error.message.includes('TOP_SECRET_CANARY'));
});

test('M11 RED: bad account and manifest are reported without leaking business identity',()=>{
 const env=refreshApprovedEnv();
 for(const [patch,code] of [
   [{CLOUDFLARE_ACCOUNT_ID:'f'.repeat(32)},'RELEASE_CLOUDFLARE_ACCOUNT_MISMATCH'],
   [{SHERERP_SHOP_ID:'SENSITIVE_CANARY'},'RELEASE_SHOP_MANIFEST_INVALID'],
   [{WORKERS_CI_BRANCH:'test'},'RELEASE_BUILD_CONTEXT_INVALID']
 ])assert.throws(()=>buildShopUserDeployment({...env,...patch}),error=>
   error.code===code&&!error.message.includes('SENSITIVE_CANARY'));
});
