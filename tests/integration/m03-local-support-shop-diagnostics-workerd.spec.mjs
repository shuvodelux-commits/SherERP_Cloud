/** Real disposable Workerd/Control D1 + two physically separate Shop D1s. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {
  LOCAL_SUPPORT_READ_DDL,issueLocalSupportReadGrant,revokeLocalSupportReadGrant,
} from '../../src/modules/m03-local-support-read-grants.js';
import {inspectLocalSupportShop} from '../../src/modules/m03-local-support-shop-diagnostics.js';

const ADMIN='1'.repeat(64);
const REASON='Investigate catalogue setup without customer or money data';
const ORIGIN='https://accounts.google.com';

async function setup(t){
  const cfg=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  const shops=['SUPPORT_A_DB','SUPPORT_B_DB'].map((binding)=>({
    binding,shopId:crypto.randomUUID(),databaseId:crypto.randomUUID(),databaseMarker:crypto.randomUUID(),
  }));
  cfg.d1_databases.push(...shops.map(s=>({
    binding:s.binding,database_id:s.databaseId,database_name:'m03-diagnostics-'+s.binding.toLowerCase(),remote:false,
  })));
  const harness=createTestHarness({workers:[{config:cfg}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(cfg.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const env=await worker.getEnv();
  const controlDb=env.CONTROL_DB;
  async function apply(db,path){
    const sql=await readFile(path,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(stmt=>db.prepare(stmt)));
  }
  await apply(controlDb,'staging-migrations/platform-onboarding/0001_shop_reservations.sql');
  await apply(controlDb,'staging-migrations/platform-onboarding/0002_shop_bindings.sql');
  const now=Date.now();
  const adminHash=await hashOpaqueSessionToken(ADMIN);
  await controlDb.batch([
    controlDb.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind('a'.repeat(64),'b'.repeat(43),ORIGIN,'admin-subject',now-2000,now+598000),
    controlDb.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind(ORIGIN,'admin-subject','a'.repeat(64),now-1500),
    controlDb.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    controlDb.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind('c'.repeat(64),'d'.repeat(43),now+600000),
    controlDb.prepare('INSERT INTO platform_login_attempts VALUES (?,?)')
      .bind('c'.repeat(64),now-700),
    controlDb.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?, ?,1,1,1,?,?)`)
      .bind(adminHash,'c'.repeat(64),now-400,now+600000),
  ]);
  for(const s of shops){
    await apply(env[s.binding],'staging-migrations/shop-identity/0001_shop_identity.sql');
    await env[s.binding].prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker).run();
    await apply(env[s.binding],'migrations/0001_core_catalog.sql');
    await controlDb.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(s.shopId,crypto.randomUUID(),'Fixture '+s.binding,'admin-subject',now-200).run();
    await controlDb.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker,'admin-subject',now-100).run();
  }
  // Deliberately unequal counts, so cross-Shop accidental reads are observable.
  for(const [index,kind,number] of [[0,'product_categories',2],[0,'product_units',1],[1,'product_categories',1],[1,'product_units',2]]){
    const db=env[shops[index].binding];
    for(let i=0;i<number;i++){
      if(kind==='product_categories'){
        await db.prepare('INSERT INTO product_categories(category_id,category_name) VALUES (?,?)')
          .bind('CAT-'+i,'Category '+i).run();
      }else{
        await db.prepare('INSERT INTO product_units(unit_id,unit_name) VALUES (?,?)')
          .bind('UNT-'+i,'Unit '+i).run();
      }
    }
  }
  for(const statement of LOCAL_SUPPORT_READ_DDL)await controlDb.prepare(statement).run();
  const scope=i=>({...shops[i],shopDb:env[shops[i].binding]});
  const issue=i=>issueLocalSupportReadGrant(controlDb,scope(i),{
    operationId:crypto.randomUUID(),reason:REASON,sessionToken:ADMIN,
  });
  const inspect=(i,grant,more={})=>inspectLocalSupportShop(controlDb,scope(i),{
    eventId:crypto.randomUUID(),sessionToken:ADMIN,supportToken:grant?.supportToken,...more,
  });
  const audit=async()=>(await controlDb.prepare('SELECT event_type,shop_id FROM m03_local_support_events ORDER BY rowid').all()).results;
  return {controlDb,env,shops,scope,issue,inspect,audit,adminHash};
}

test('read-only diagnostic counts are Shop-specific, authorized once and lack customer/money data',async t=>{
  const x=await setup(t);
  const first=await x.issue(0),second=await x.issue(1);
  assert.equal(first.status,'created');
  assert.equal(second.status,'created');
  const resultA=await x.inspect(0,first),resultB=await x.inspect(1,second);
  assert.deepEqual(resultA,{
    status:'ok',shopId:x.shops[0].shopId,catalog:{status:'available',categories:2,units:1},
  });
  assert.deepEqual(resultB,{
    status:'ok',shopId:x.shops[1].shopId,catalog:{status:'available',categories:1,units:2},
  });
  const serialized=JSON.stringify([resultA,resultB]);
  for(const forbidden of ['Category 0','Unit 0','invoice','balance','customer',
    'supportToken','databaseMarker','databaseId']){
    assert.equal(serialized.includes(forbidden),false,forbidden);
  }
  assert.deepEqual((await x.audit()).map(row=>row.event_type),['START','START','READ','READ']);
});

test('cross-Shop, physical D1 swap, invalid grant and altered marker disclose no diagnostics',async t=>{
  const x=await setup(t);
  const first=await x.issue(0);
  assert.equal(first.status,'created');
  assert.deepEqual(await x.inspect(1,first),{status:'denied'});
  assert.deepEqual(await x.inspect(0,first,{supportToken:'f'.repeat(64)}),{status:'denied'});
  assert.deepEqual(await x.inspect(0,first,{eventId:'wrong'}),{status:'invalid'});
  const swapped={...x.scope(0),shopDb:x.env[x.shops[1].binding]};
  assert.deepEqual(await inspectLocalSupportShop(x.controlDb,swapped,{
    eventId:crypto.randomUUID(),sessionToken:ADMIN,supportToken:first.supportToken,
  }),{status:'denied'});
  const badMarker={...x.scope(0),databaseMarker:x.shops[1].databaseMarker};
  assert.deepEqual(await inspectLocalSupportShop(x.controlDb,badMarker,{
    eventId:crypto.randomUUID(),sessionToken:ADMIN,supportToken:first.supportToken,
  }),{status:'denied'});
  assert.deepEqual((await x.audit()).map(row=>row.event_type),['START']);
});

test('one-time read event cannot be reused and revoked support grant denies future diagnostics',async t=>{
  const x=await setup(t),g=await x.issue(0);
  const eventId=crypto.randomUUID();
  assert.equal((await x.inspect(0,g,{eventId})).status,'ok');
  assert.deepEqual(await x.inspect(0,g,{eventId}),{status:'denied'});
  assert.deepEqual(await revokeLocalSupportReadGrant(x.controlDb,x.scope(0),{
    operationId:g.operationId,sessionToken:ADMIN,
  }),{status:'revoked'});
  assert.deepEqual(await x.inspect(0,g),{status:'denied'});
  assert.deepEqual((await x.audit()).map(row=>row.event_type),['START','READ','END']);
});

test('MFA rotation and revoked Admin session fail closed despite unexpired support grant',async t=>{
  const x=await setup(t),g=await x.issue(0);
  assert.equal(g.status,'created');
  await x.controlDb.prepare('UPDATE platform_admin_auth SET factor_version=2 WHERE singleton=1').run();
  assert.deepEqual(await x.inspect(0,g),{status:'denied'});
  assert.deepEqual((await x.audit()).map(row=>row.event_type),['START']);
});

test('missing catalog schema is not represented as a zero-count or ERP-ready shop',async t=>{
  const x=await setup(t),g=await x.issue(0);
  await x.env[x.shops[0].binding].prepare('DROP TABLE product_units').run();
  const result=await x.inspect(0,g);
  assert.deepEqual(result,{
    status:'schema-incomplete',shopId:x.shops[0].shopId,catalog:{status:'missing'},
  });
  assert.equal('units' in result.catalog,false);
  assert.equal('categories' in result.catalog,false);
  assert.deepEqual((await x.audit()).map(row=>row.event_type),['START','READ']);
});
