import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createTestHarness} from 'wrangler';
import ownerWorker from '../../src/m03-owner-redemption-worker.js';
import {issueOwnerSession,revokeOwnerSession,validateOwnerSession} from '../../src/auth/platform-owner-sessions.js';
import {buildOwnerFrontend} from '../../scripts/build-owner-frontend.mjs';

test('Owner frontend is a separate compiled copy with no staff password login or business RPC transport',{concurrency:false},async()=>{
  const outputDir=await mkdtemp(join(tmpdir(),'shererp-owner-frontend-'));
  try{
    const result=await buildOwnerFrontend({outputDir});
    const html=await readFile(result.indexPath,'utf8');
    assert.match(html,/id="owner-data-notice"/);
    assert.match(html,/Business data is not connected/);
    assert.doesNotMatch(html,/id="loginMobile"|id="loginPassword"/);
    assert.match(html,/\/api\/owner\/auth\/session/);
    assert.match(html,/Shop business data is not connected yet\./);
    assert.doesNotMatch(html,/fetch\('\/api\/rpc'/);
    assert.doesNotMatch(html,/owner-cookie-session/);
  }finally{
    await rm(outputDir,{recursive:true,force:true});
  }
});

test('Owner app rejects an unsigned request before serving app assets',async()=>{
  const origin='https://owner.example.test';
  const response=await ownerWorker.fetch(new Request(origin+'/app'),{
    OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
    PLATFORM_OWNER_CLIENT_ID:'654-example.apps.googleusercontent.com',
    OWNER_LOGIN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
    OWNER_INGRESS:{async limit(){return {success:true};}},
    CONTROL_DB:{prepare(){throw new Error('Unauthenticated requests must not query D1.');}},
  });
  assert.equal(response.status,302);
  assert.equal(response.headers.get('location'),'/');
  assert.equal(response.headers.get('cache-control'),'no-store');
  const staticEntry=await ownerWorker.fetch(new Request(origin+'/index.html'),{
    OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
    PLATFORM_OWNER_CLIENT_ID:'654-example.apps.googleusercontent.com',
    OWNER_LOGIN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
    OWNER_INGRESS:{async limit(){return {success:true};}},
    CONTROL_DB:{prepare(){throw new Error('Unsigned static requests must not query D1.');}},
  });
  assert.equal(staticEntry.status,401);
  const unsignedModule=await ownerWorker.fetch(
    new Request(origin+'/m05-products/m01-products-preview-controller.mjs'),{
      OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
      PLATFORM_OWNER_CLIENT_ID:'654-example.apps.googleusercontent.com',
      OWNER_LOGIN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
      OWNER_INGRESS:{async limit(){return {success:true};}},
      CONTROL_DB:{prepare(){throw new Error('Unsigned module requests must not query D1.');}},
    });
  assert.equal(unsignedModule.status,401);
});

test('Owner session serves ERP app and source navigation, then revocation removes access',{concurrency:false},async()=>{
  await buildOwnerFrontend({outputDir:'dist-owner'});
  const configPath='./wrangler.m03-owner-auth-staging.jsonc';
  const cfg=JSON.parse(await readFile(configPath,'utf8'));
  const origin='https://owner.example.test';
  const shopId='22222222-2222-4222-8222-222222222222';
  const marker='03b2c8f6-ea89-44a7-9032-3e4f17c8c94e';
  const harness=createTestHarness({workers:[{configPath,vars:{
    OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
    PLATFORM_OWNER_CLIENT_ID:'654-example.apps.googleusercontent.com',
    PLATFORM_PILOT_SHOP_ID:shopId,PLATFORM_PILOT_D1_ID:cfg.d1_databases[1].database_id,
    PLATFORM_PILOT_MARKER:marker,OWNER_LOGIN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
    OWNER_CATALOG_ENABLED:'true',
  }}]});
  try{
    await harness.listen();
    const worker=harness.getWorker(cfg.name);
    const env=await worker.getEnv();
    const signInPage=await worker.fetch(origin+'/');
    assert.equal(signInPage.status,200);
    const signInHtml=await signInPage.text();
    assert.match(signInHtml,/Shop Owner sign-in/);
    assert.match(signInHtml,/data-owner-erp="enabled"/);
    const directAppAsset=await worker.fetch(origin+'/owner-erp.html',{redirect:'manual'});
    assert.equal(directAppAsset.status,404);
    const rpc=await worker.fetch(origin+'/api/rpc',{method:'POST',headers:{
      Origin:origin,'Content-Type':'application/json',
    },body:JSON.stringify({fnName:'completeSale',args:[]})});
    assert.equal(rpc.status,404);
    const apply=async(db,dir,names)=>{
      for(const name of names){
        const sql=await readFile(`${dir}/${name}.sql`,'utf8');
        await db.batch(sql.split('-- next statement').map(value=>value.trim()).filter(Boolean).map(value=>db.prepare(value)));
      }
    };
    await apply(env.CONTROL_DB,'staging-migrations/platform-onboarding',[
      '0001_shop_reservations','0002_shop_bindings','0003_owner_invitations',
      '0004_first_shop_owner','0005_owner_sessions','0006_owner_login_challenges',
    ]);
    await apply(env.PLATFORM_PILOT_DB,'staging-migrations/shop-identity',['0001_shop_identity']);
    const dbId=cfg.d1_databases[1].database_id;
    const operationId='a2ad79ce-2f78-470d-80c7-a8fe8de98480';
    await env.CONTROL_DB.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)')
      .bind(shopId,operationId,'Test shop','fixture-admin',Date.now()).run();
    await env.CONTROL_DB.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)')
      .bind(shopId,dbId,marker,'fixture-admin',Date.now()).run();
    await env.PLATFORM_PILOT_DB.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)')
      .bind(shopId,dbId,marker).run();
    const inviteHash='c'.repeat(64);
    await env.CONTROL_DB.prepare('INSERT INTO platform_owner_invitations VALUES (?,?,?,?,?,?,?)')
      .bind(inviteHash,shopId,'https://accounts.google.com','fixture-owner','fixture-admin',Date.now(),Date.now()+600000).run();
    await env.CONTROL_DB.prepare('INSERT INTO platform_first_shop_owners VALUES (?,?,?,?,?)')
      .bind(shopId,inviteHash,'https://accounts.google.com','fixture-owner',Date.now()).run();
    const sessionToken=await issueOwnerSession(env,{issuer:'https://accounts.google.com',subject:'fixture-owner'});
    assert.equal(typeof sessionToken,'string');
    const cookie=`__Host-shererp-owner-session=${sessionToken}`;
    const app=await worker.fetch(origin+'/app',{headers:{Cookie:cookie}});
    assert.equal(app.status,200);
    assert.equal(app.headers.get('cache-control'),'no-store');
    assert.match(app.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    assert.match(await app.text(),/owner-data-notice/);

    const shell=await worker.fetch(origin+'/api/owner/app-shell',{headers:{Cookie:cookie}});
    assert.equal(shell.status,200);
    const payload=await shell.json();
    assert.equal(payload.data.shopName,'Test shop');
    assert.ok(payload.data.navItems.some(item=>item.label==='Sales'));
    assert.ok(payload.data.navItems.some(item=>item.label==='Products'));
    const module=await worker.fetch(origin+'/m05-products/m01-products-preview-controller.mjs',{headers:{Cookie:cookie}});
    assert.equal(module.status,200);
    assert.equal(module.headers.get('cache-control'),'no-store');

    const catalogPath=origin+'/api/owner/catalog';
    const catalog=()=>worker.fetch(catalogPath,{headers:{Cookie:cookie}});
    assert.equal((await catalog()).status,503);
    const productMigration=await readFile('migrations/0012_legacy_product_snapshots.sql','utf8');
    const productTable=productMigration.match(/CREATE TABLE legacy_product_snapshots \([\s\S]*?\) STRICT;/)[0];
    await env.PLATFORM_PILOT_DB.prepare(productTable).run();
    await env.PLATFORM_PILOT_DB.prepare(`INSERT INTO legacy_product_snapshots
      (source_profile,legacy_sheet_row,product_id,product_name,current_stock_text)
      VALUES ('canonical',2,'P1','Fixture Product','99')`).run();
    const catalogResponse=await catalog();
    assert.equal(catalogResponse.status,200);
    assert.equal(catalogResponse.headers.get('cache-control'),'no-store');
    assert.deepEqual(await catalogResponse.json(),{data:[
      {productId:'P1',name:'Fixture Product',brand:'',category:'',unit:'',listedPrice:''},
    ]});
    assert.equal(await revokeOwnerSession(env,sessionToken),true);
    assert.equal(await validateOwnerSession(env,sessionToken),null);
    assert.equal((await catalog()).status,401);
  }finally{
    await harness.close();
  }
});
