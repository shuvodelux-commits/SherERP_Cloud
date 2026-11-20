/** Local-only HTTP boundary against real disposable Workerd Control + two Shop D1s. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {createTestHarness,unstable_splitSqlQuery} from 'wrangler';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';
import {LOCAL_SUPPORT_READ_DDL} from '../../src/modules/m03-local-support-read-grants.js';
import {handleLocalSupportHttpRequest} from '../../src/modules/m03-local-support-http-contract.js';

const ORIGIN='https://platform.example.test';
const COOKIE='__Host-shererp-platform-session';
const TOKEN='1'.repeat(64);
const REASON='Read-only inspection of shop catalog configuration';

async function createLocalRequestContext(t){
  const config=JSON.parse(await readFile('wrangler.m03-platform-auth-local-test.jsonc','utf8'));
  const shops=['SUPPORT_HTTP_A','SUPPORT_HTTP_B'].map(binding=>({
    binding,shopId:crypto.randomUUID(),databaseId:crypto.randomUUID(),
    databaseMarker:crypto.randomUUID(),
  }));
  config.d1_databases.push(...shops.map(s=>({
    binding:s.binding,database_id:s.databaseId,database_name:'support-http-'+s.binding.toLowerCase(),remote:false,
  })));
  const harness=createTestHarness({workers:[{config}]});
  t.after(()=>harness.close());
  await harness.listen();
  const worker=harness.getWorker(config.name);
  await worker.applyD1Migrations('CONTROL_DB');
  const bindings=await worker.getEnv();
  const db=bindings.CONTROL_DB;
  async function apply(target,path){
    const sql=await readFile(path,'utf8');
    await target.batch(unstable_splitSqlQuery(sql).map(text=>target.prepare(text)));
  }
  await apply(db,'staging-migrations/platform-onboarding/0001_shop_reservations.sql');
  await apply(db,'staging-migrations/platform-onboarding/0002_shop_bindings.sql');
  const now=Date.now();
  const adminHash=await hashOpaqueSessionToken(TOKEN);
  await db.batch([
    db.prepare('INSERT INTO platform_setup_tickets VALUES (?,?,?,?,?,?,NULL)')
      .bind('a'.repeat(64),'b'.repeat(43),'https://accounts.google.com','test-admin',now-1000,now+599000),
    db.prepare('INSERT INTO platform_first_superadmin VALUES (1,?,?,?,?)')
      .bind('https://accounts.google.com','test-admin','a'.repeat(64),now-900),
    db.prepare('INSERT INTO platform_admin_auth VALUES (1,1,1)'),
    db.prepare('INSERT INTO platform_login_challenges VALUES (?,?,?)')
      .bind('c'.repeat(64),'d'.repeat(43),now+60000),
    db.prepare('INSERT INTO platform_login_attempts VALUES (?,?)')
      .bind('c'.repeat(64),now-200),
    db.prepare(`INSERT INTO platform_admin_sessions
      (token_hash,binding_hash,singleton,factor_version,otp_step,issued_at_ms,expires_at_ms)
      VALUES (?, ?,1,1,1,?,?)`)
      .bind(adminHash,'c'.repeat(64),now-100,now+60000),
  ]);
  for(const [i,s] of shops.entries()){
    const shopDb=bindings[s.binding];
    await apply(shopDb,'staging-migrations/shop-identity/0001_shop_identity.sql');
    await shopDb.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker).run();
    await apply(shopDb,'migrations/0001_core_catalog.sql');
    const categoryCount=i===0?2:1;
    for(let n=0;n<categoryCount;n++)
      await shopDb.prepare('INSERT INTO product_categories(category_id,category_name) VALUES (?,?)')
        .bind('CAT-'+n,'Hidden Category '+n).run();
    for(let n=0;n<2-i;n++)
      await shopDb.prepare('INSERT INTO product_units(unit_id,unit_name) VALUES (?,?)')
        .bind('UNIT-'+n,'Hidden Unit '+n).run();
    await db.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(s.shopId,crypto.randomUUID(),'Fixture '+i,'test-admin',now-90).run();
    await db.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)')
      .bind(s.shopId,s.databaseId,s.databaseMarker,'test-admin',now-80).run();
  }
  for(const sql of LOCAL_SUPPORT_READ_DDL)await db.prepare(sql).run();
  const env={CONTROL_DB:db,SUPPORT_TEST_MODE_ENABLED:true,
    SUPPORT_TEST_ORIGIN:ORIGIN,SUPPORT_TEST_SHOPS:shops.map(s=>({
      ...s,shopDb:bindings[s.binding],
    }))};
  const audit=async()=>(await db.prepare('SELECT event_type,shop_id FROM m03_local_support_events ORDER BY rowid').all()).results;
  async function send(route,payload,options={}){
    const method=options.method||'POST';
    const headers={
      Origin:options.origin??ORIGIN,'Content-Type':options.contentType??'application/json',
      ...(!options.noCookie?{Cookie:COOKIE+'='+(options.cookie??TOKEN)}:{}),
    };
    const url=ORIGIN+route;
    const body=options.rawBody??(payload===undefined?undefined:JSON.stringify(payload));
    const req=new Request(url,{method,headers,body:method==='POST'?body:undefined});
    const res=await handleLocalSupportHttpRequest(req,options.env||env);
    return {status:res.status,headers:res.headers,body:await res.json()};
  }
  return {env,db,shops,send,audit,adminHash};
}
const start=(id,operationId=crypto.randomUUID(),reason=REASON)=>({shopId:id,operationId,reason});
const diagnostics=(shopId,supportToken,eventId=crypto.randomUUID())=>({shopId,supportToken,eventId});
const end=(shopId,operationId)=>({shopId,operationId});

test('HTTP is not routable without test-only flag or from wrong origin, method or URL',async t=>{
  const x=await createLocalRequestContext(t);
  const payload=start(x.shops[0].shopId);
  assert.equal((await x.send('/__m03_support_local__/start',payload,{
    env:{...x.env,SUPPORT_TEST_MODE_ENABLED:false},
  })).status,404);
  assert.equal((await x.send('/__m03_support_local__/start',payload,{origin:'https://evil.example.test'})).status,403);
  assert.equal((await x.send('/__m03_support_local__/start',payload,{method:'GET'})).status,405);
  assert.equal((await x.send('/__m03_support_local__/start?secret=1',payload)).status,400);
  assert.equal((await x.send('/__m03_support_local__/extra',payload)).status,404);
  assert.equal((await x.send('/__m03_support_local__/start',payload,{noCookie:true})).status,401);
  assert.equal((await x.send('/__m03_support_local__/start',payload,{cookie:'f'.repeat(64)})).status,403);
  assert.deepEqual(await x.audit(),[]);
});

test('two-Shop POST start, diagnostics and end use verified bindings and emit immutable audit',async t=>{
  const x=await createLocalRequestContext(t);
  for(const [i,s] of x.shops.entries()){
    const op=crypto.randomUUID();
    const begun=await x.send('/__m03_support_local__/start',start(s.shopId,op));
    assert.equal(begun.status,201);
    assert.equal(begun.headers.get('Cache-Control'),'no-store');
    assert.equal(begun.headers.get('X-Content-Type-Options'),'nosniff');
    assert.equal(begun.body.status,'created');
    assert.equal(begun.body.operationId,op);
    assert.match(begun.body.supportToken,/^[0-9a-f]{64}$/);
    const inspected=await x.send('/__m03_support_local__/diagnostics',diagnostics(s.shopId,begun.body.supportToken));
    assert.equal(inspected.status,200);
    assert.deepEqual(inspected.body,{
      status:'ok',shopId:s.shopId,catalog:{
        status:'available',categories:i===0?2:1,units:2-i,
      },
    });
    for(const secret of [begun.body.supportToken,s.databaseId,s.databaseMarker,'Hidden Category','Hidden Unit'])
      assert.equal(JSON.stringify(inspected.body).includes(secret),false,'No private payload in diagnostic response');
    const stopped=await x.send('/__m03_support_local__/end',end(s.shopId,op));
    assert.deepEqual(stopped.body,{status:'revoked'});
    assert.equal(stopped.status,200);
    assert.equal((await x.send('/__m03_support_local__/diagnostics',
      diagnostics(s.shopId,begun.body.supportToken))).status,403);
  }
  assert.deepEqual((await x.audit()).map(event=>event.event_type),
    ['START','READ','END','START','READ','END']);
  assert.notEqual((await x.audit())[0].shop_id,(await x.audit())[3].shop_id);
});

test('operation replay does not leak a second bearer and tokens cannot read other shops',async t=>{
  const x=await createLocalRequestContext(t),op=crypto.randomUUID();
  const a=await x.send('/__m03_support_local__/start',start(x.shops[0].shopId,op));
  assert.equal(a.status,201);
  const retry=await x.send('/__m03_support_local__/start',start(x.shops[0].shopId,op));
  assert.deepEqual(retry.body,{status:'replayed'});
  assert.equal(retry.status,200);
  assert.equal((await x.send('/__m03_support_local__/start',start(x.shops[0].shopId,op,REASON+' changed'))).status,403);
  assert.equal((await x.send('/__m03_support_local__/diagnostics',
    diagnostics(x.shops[1].shopId,a.body.supportToken))).status,403);
  assert.deepEqual((await x.audit()).map(e=>e.event_type),['START']);
});

test('malformed, extra DB binding fields, oversized input and reused READ event all fail closed',async t=>{
  const x=await createLocalRequestContext(t);
  const s=x.shops[0];
  const startPayload=start(s.shopId);
  const wrong=await x.send('/__m03_support_local__/start',{...startPayload,databaseId:s.databaseId});
  assert.equal(wrong.status,400);
  assert.equal((await x.send('/__m03_support_local__/start',startPayload,{rawBody:'{broken'})).status,400);
  assert.equal((await x.send('/__m03_support_local__/start',startPayload,{contentType:'text/plain'})).status,415);
  assert.equal((await x.send('/__m03_support_local__/start',startPayload,{rawBody:'a'.repeat(2100)})).status,413);
  assert.deepEqual(await x.audit(),[]);
  const a=await x.send('/__m03_support_local__/start',startPayload);
  assert.equal(a.status,201);
  const eventId=crypto.randomUUID(),payload=diagnostics(s.shopId,a.body.supportToken,eventId);
  assert.equal((await x.send('/__m03_support_local__/diagnostics',payload)).status,200);
  assert.equal((await x.send('/__m03_support_local__/diagnostics',payload)).status,403);
  assert.deepEqual((await x.audit()).map(z=>z.event_type),['START','READ']);
});

test('rotated MFA or mismatched physical D1 binding denies HTTP start/inspect',async t=>{
  const x=await createLocalRequestContext(t),s=x.shops[0];
  const a=await x.send('/__m03_support_local__/start',start(s.shopId));
  assert.equal(a.status,201);
  const forged={...x.env,SUPPORT_TEST_SHOPS:[
    {...x.env.SUPPORT_TEST_SHOPS[0],shopDb:x.env.SUPPORT_TEST_SHOPS[1].shopDb},
    x.env.SUPPORT_TEST_SHOPS[1],
  ]};
  assert.equal((await x.send('/__m03_support_local__/diagnostics',
    diagnostics(s.shopId,a.body.supportToken),{env:forged})).status,403);
  await x.db.prepare('UPDATE platform_admin_auth SET factor_version=2 WHERE singleton=1').run();
  assert.equal((await x.send('/__m03_support_local__/diagnostics',
    diagnostics(s.shopId,a.body.supportToken))).status,403);
  assert.equal((await x.send('/__m03_support_local__/start',start(x.shops[1].shopId))).status,403);
  assert.deepEqual((await x.audit()).map(z=>z.event_type),['START']);
});
