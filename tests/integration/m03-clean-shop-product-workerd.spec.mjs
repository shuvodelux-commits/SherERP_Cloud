import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {issueOwnerSession,validateOwnerSession,revokeOwnerSession} from '../../src/auth/platform-owner-sessions.js';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {publishCurrentOwnerWriteSession} from '../../src/auth/platform-owner-write-session.js';

test('a new Owner creates a first zero-stock product in an empty shop without archive rows or cross-shop access',async()=>{
  const {worker,ownerA,ownerB,SHOP_A_DB,SHOP_B_DB,close}=await startCleanShopHarness();
  try{
    const request=(shop,token,input)=>{
      const origin=`https://${shop}.example.test`;
      const headers=token?{Cookie:`__Host-shererp-owner-session=${token}`}:{ };
      return worker.fetch(origin+'/__clean_shop__/products',input?{
        method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input),
      }:{headers});
    };
    const draft={operationId:crypto.randomUUID(),name:'Fixture wrench',unit:'pcs',purchasePrice:'8.25',sellingPrice:'12.50'};
    assert.deepEqual(await (await request('a',ownerA.token)).json(),{data:[]});
    assert.equal((await request('a',null,draft)).status,401);
    assert.equal((await request('b',ownerA.token,draft)).status,401);
    assert.equal((await request('a',ownerA.token,{...draft,stock:'3'})).status,400);
    const [first,retry]=await Promise.all([request('a',ownerA.token,draft),request('a',ownerA.token,draft)]);
    assert.deepEqual([first.status,retry.status].sort(),[200,201]);
    const {data:created}=await first.json();
    assert.deepEqual(await retry.json(),{data:created});
    assert.equal((await request('a',ownerA.token,{...draft,name:'Changed product'})).status,409);
    assert.equal((await request('a',ownerA.token,{...draft,operationId:crypto.randomUUID(),name:'FIXTURE WRENCH'})).status,409);
    assert.deepEqual(await (await request('a',ownerA.token)).json(),{data:[{
      id:created.id,name:draft.name,unit:draft.unit,purchasePrice:'8.25',sellingPrice:'12.50',stock:'0',
    }]});
    assert.deepEqual(await (await request('b',ownerB.token)).json(),{data:[]});
    assert.equal((await request('a',ownerB.token)).status,401);
    const other=await request('b',ownerB.token,{...draft,sellingPrice:'14.50'});
    assert.equal(other.status,201);
    assert.equal((await other.json()).data.id,created.id);
    assert.equal((await (await request('a',ownerA.token)).json()).data[0].sellingPrice,'12.50');
    assert.equal((await (await request('b',ownerB.token)).json()).data[0].sellingPrice,'14.50');
    assert.equal((await SHOP_A_DB.prepare('SELECT count(*) AS n FROM legacy_product_snapshots').first()).n,0);
    assert.equal((await SHOP_B_DB.prepare('SELECT count(*) AS n FROM legacy_product_snapshots').first()).n,0);
    await SHOP_A_DB.prepare('UPDATE shop_owner_write_grant SET enabled=0').run();
    assert.equal((await validateOwnerSession(ownerA.env,ownerA.token)).role,'Owner');
    assert.equal((await request('a',ownerA.token,{...draft,name:'New after revoke',operationId:crypto.randomUUID()})).status,409);
    assert.equal((await request('a',ownerA.token,draft)).status,409);
    // B still has an active Shop D1 grant. Fail the Control D1 step after
    // logout has reached the Shop D1, then retry with the same cookie.
    const control=ownerB.env.CONTROL_DB;
    const generation=async owner=>(await control.prepare(
      'SELECT generation FROM platform_owner_session_generation WHERE shop_id=?',
    ).bind(owner.env.PLATFORM_PILOT_SHOP_ID).first()).generation;
    assert.equal(await generation(ownerB),1);
    await control.prepare(`CREATE TRIGGER fixture_refuse_logout
      BEFORE DELETE ON platform_shop_owner_sessions BEGIN SELECT RAISE(ABORT,'fixture'); END;`).run();
    const logout=()=>worker.fetch('https://b.example.test/__clean_shop__/logout',{
      method:'POST',headers:{Origin:'https://b.example.test',Cookie:`__Host-shererp-owner-session=${ownerB.token}`},
    });
    assert.equal((await logout()).status,503);
    assert.equal(await generation(ownerB),1);
    assert.equal((await validateOwnerSession(ownerB.env,ownerB.token)).role,'Owner');
    assert.equal((await request('b',ownerB.token,{...draft,name:'Blocked',operationId:crypto.randomUUID()})).status,409);
    await control.prepare('DROP TRIGGER fixture_refuse_logout').run();
    assert.equal((await logout()).status,200);
    assert.equal(await generation(ownerB),2);
    assert.equal((await request('b',ownerB.token)).status,401);
    const replacement=await issueOwnerSession(ownerB.env,{issuer:'https://accounts.google.com',subject:'fixture-owner-b'});
    assert.equal(typeof replacement,'string');
    assert.equal(await generation(ownerB),3);
    assert.equal(await generation(ownerA),1);
    assert.equal(await publishCurrentOwnerWriteSession(ownerA.env,replacement),false);
    assert.equal(await publishCurrentOwnerWriteSession({...ownerB.env,PLATFORM_PILOT_DB:SHOP_A_DB},replacement),false);
    assert.equal(await publishCurrentOwnerWriteSession(ownerB.env,replacement),true);
    assert.equal(await publishCurrentOwnerWriteSession(ownerB.env,ownerB.token),false);
    const nextDraft={...draft,name:'Replacement session product',operationId:crypto.randomUUID()};
    assert.equal((await request('b',ownerB.token,nextDraft)).status,401);
    assert.equal((await request('b',replacement,nextDraft)).status,201);
    await SHOP_B_DB.prepare('UPDATE shop_owner_write_grant SET enabled=0').run();
    assert.equal(await publishCurrentOwnerWriteSession(ownerB.env,replacement),false);
    assert.equal((await request('b',replacement,{...nextDraft,name:'Late grant',operationId:crypto.randomUUID()})).status,409);
    await control.prepare('UPDATE platform_shop_owner_sessions SET issued_at_ms=issued_at_ms+1 WHERE shop_id=?')
      .bind(ownerB.env.PLATFORM_PILOT_SHOP_ID).run();
    assert.equal(await generation(ownerB),3);
    const rotated=await issueOwnerSession(ownerB.env,{issuer:'https://accounts.google.com',subject:'fixture-owner-b'});
    assert.equal(typeof rotated,'string');
    assert.equal(await generation(ownerB),4);
    assert.equal(await validateOwnerSession(ownerB.env,replacement),null);
    await assert.rejects(control.prepare('UPDATE platform_shop_owner_access SET enabled=0 WHERE shop_id=?')
      .bind(ownerB.env.PLATFORM_PILOT_SHOP_ID).run(),/Fence Owner/);
    assert.equal(await revokeOwnerSession(ownerB.env,rotated),true);
    await control.prepare('UPDATE platform_shop_owner_access SET enabled=0 WHERE shop_id=?')
      .bind(ownerB.env.PLATFORM_PILOT_SHOP_ID).run();
    assert.equal(await generation(ownerB),5);
    assert.equal(await validateOwnerSession(ownerB.env,rotated),null);
    assert.equal(await publishCurrentOwnerWriteSession(ownerB.env,rotated),false);
    const logoutA=await worker.fetch('https://a.example.test/__clean_shop__/logout',{
      method:'POST',headers:{Origin:'https://a.example.test',Cookie:`__Host-shererp-owner-session=${ownerA.token}`},
    });
    assert.equal(logoutA.status,200);
    assert.equal((await request('a',ownerA.token,{...draft,operationId:crypto.randomUUID()})).status,401);
    assert.equal((await SHOP_A_DB.prepare('SELECT count(*) AS n FROM products').first()).n,1);
  }finally{
    await close();
  }
});

test('Owner candidate logout closes the write generation before acknowledging sign-out',async()=>{
  const {ownerA,SHOP_A_DB,SHOP_B_DB,close}=await startCleanShopHarness();
  try{
    const {default:app}=await import('../../src/m03-owner-redemption-worker.js');
    const env={...ownerA.env,OWNER_WRITE_GRANTS_ENABLED:'true',OWNER_LOGIN_ENABLED:'true',
      OWNER_AUTH_ORIGIN:'https://owner.example.test',PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
      PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',OWNER_INGRESS:{limit:async()=>({success:true})}};
    const response=await app.request(env.OWNER_AUTH_ORIGIN+'/api/owner/auth/logout',{
      method:'POST',headers:{Origin:env.OWNER_AUTH_ORIGIN,Cookie:'__Host-shererp-owner-session='+ownerA.token},
    },env);
    assert.equal(response.status,200);
    assert.equal((await SHOP_A_DB.prepare('SELECT enabled FROM shop_owner_write_grant').first()).enabled,0);
    assert.equal((await SHOP_B_DB.prepare('SELECT enabled FROM shop_owner_write_grant').first()).enabled,1);
  }finally{await close();}
});

test('withdrawal fences a reserved generation before its first Shop publication',async()=>{
  const {ownerA,SHOP_A_DB,close}=await startCleanShopHarness();
  try{
    const env=ownerA.env;
    const {pilotShopConfiguration}=await import('../../src/auth/platform-shop-binding.js');
    const {publishOwnerWriteGrant}=await import('../../src/db/shop-owner-write-grant.js');
    await revokeOwnerSession(env,ownerA.token);
    // Obtain a read-only session, then simulate a temporarily unavailable Shop
    // during its upgrade. The durable Control claim must survive the failure.
    const token=await issueOwnerSession({...env,OWNER_WRITE_GRANTS_ENABLED:'false'},
      {issuer:'https://accounts.google.com',subject:'fixture-owner-a'});
    await SHOP_A_DB.prepare(`CREATE TRIGGER fixture_pause_publish BEFORE UPDATE ON shop_owner_write_grant
      WHEN NEW.enabled=1 BEGIN SELECT RAISE(ABORT,'publication pending'); END;`).run();
    await assert.rejects(publishCurrentOwnerWriteSession(env,token),/publication pending/);
    const claim=await env.CONTROL_DB.prepare('SELECT generation FROM platform_owner_grant_claim WHERE shop_id=?')
      .bind(env.PLATFORM_PILOT_SHOP_ID).first();
    await assert.rejects(revokeOwnerSession({...env,OWNER_WRITE_GRANTS_ENABLED:'false'},token),/Fence Owner/);
    assert.equal(await revokeOwnerSession(env,token),true);
    await SHOP_A_DB.prepare('DROP TRIGGER fixture_pause_publish').run();
    assert.equal(await publishOwnerWriteGrant(SHOP_A_DB,pilotShopConfiguration(env),token,claim.generation),false);
    assert.deepEqual(await SHOP_A_DB.prepare('SELECT generation,enabled FROM shop_owner_write_grant').first(),
      {generation:claim.generation,enabled:0});
  }finally{await close();}
});

test('private Owner candidate posts a source-ID product once and reads it from the operational catalog',async()=>{
  const {ownerA,ownerB,SHOP_A_DB,SHOP_B_DB,close}=await startCleanShopHarness();
  try{
    const {default:app}=await import('../../src/m03-owner-redemption-worker.js');
    const origin='https://owner.example.test';
    const env={...ownerA.env,OWNER_CLEAN_PRODUCTS_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
      OWNER_LOGIN_ENABLED:'true',OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
      PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',OWNER_INGRESS:{limit:async()=>({success:true})}};
    const request=(body,{bindings=env,token=ownerA.token,requestOrigin=origin}={})=>app.request(
      origin+'/api/owner/catalog',{
        headers:{Cookie:'__Host-shererp-owner-session='+token,
          ...(body?{Origin:requestOrigin,'Content-Type':'application/json'}:{})},
        ...(body?{method:'POST',body:JSON.stringify(body)}:{}),
      },bindings);
    const draft={operationId:crypto.randomUUID(),name:'Fixture wrench',brand:'',category:'',unit:'pcs',
      purchasePrice:'8.25',sellingPrice:'12.50',stock:'0',minStock:'0',barcode:'',productType:'Standard',components:[]};
    assert.equal((await request(draft,{bindings:{...env,OWNER_CLEAN_PRODUCTS_ENABLED:'false'}})).status,404);
    assert.equal((await request(draft,{token:ownerB.token})).status,401);
    assert.equal((await request(draft,{bindings:{...env,PLATFORM_PILOT_DB:SHOP_B_DB}})).status,401);
    assert.equal((await request(draft,{requestOrigin:'https://other.example.test'})).status,403);
    assert.equal((await request({...draft,stock:'1'})).status,400);
    const responses=await Promise.all([request(draft),request(draft)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
    for(const response of responses){
      assert.deepEqual(await response.json(),{success:true,data:{id:'PRD-000001'}});
    }
    assert.equal((await request({...draft,name:'Changed'})).status,409);
    assert.equal((await request({...draft,operationId:crypto.randomUUID(),name:'fixture WRENCH'})).status,409);
    const catalog=await (await request()).json();
    assert.equal(catalog.mode,'operational');
    assert.deepEqual(catalog.data,[{productId:'PRD-000001',name:'Fixture wrench',brand:'',category:'Uncategorized',
      unit:'pcs',listedPrice:'12.50',savedPurchasePrice:'8.25',stockAtBackup:null,stock:'0'}]);
    assert.equal((await SHOP_A_DB.prepare('SELECT count(*) AS n FROM owner_product_create_receipts').first()).n,1);
    assert.equal((await SHOP_B_DB.prepare('SELECT count(*) AS n FROM products').first()).n,0);

    await SHOP_A_DB.prepare(`CREATE TRIGGER fixture_reject_product BEFORE INSERT ON products
      BEGIN SELECT RAISE(ABORT,'fixture product write failed'); END;`).run();
    const next={...draft,name:'Fixture hammer',operationId:crypto.randomUUID()};
    assert.equal((await request(next)).status,503);
    assert.equal((await SHOP_A_DB.prepare('SELECT count(*) AS n FROM owner_product_create_receipts').first()).n,1);
    await SHOP_A_DB.prepare('DROP TRIGGER fixture_reject_product').run();
    const saved=await request(next);
    assert.equal(saved.status,201);
    assert.equal((await saved.json()).data.id,'PRD-000002');
    await SHOP_A_DB.prepare('UPDATE shop_owner_write_grant SET enabled=0').run();
    assert.equal((await request(next)).status,403);
    assert.equal((await request({...next,name:'Spanner',operationId:crypto.randomUUID()})).status,403);
    assert.equal((await SHOP_A_DB.prepare('SELECT count(*) AS n FROM products').first()).n,2);
    const currentToken=await issueOwnerSession(env,{issuer:'https://accounts.google.com',subject:'fixture-owner-a'});
    const replay=await request(next,{token:currentToken});
    assert.equal(replay.status,200);
    assert.equal((await replay.json()).data.id,'PRD-000002');

    // A late import makes this clean-only route refuse both reads and writes.
    // Turning the candidate flag off still exposes the original backup path.
    await SHOP_A_DB.prepare(`INSERT INTO legacy_product_snapshots
      (source_profile,legacy_sheet_row,product_id,product_name) VALUES ('canonical',2,'PRD-009000','Archived product')`).run();
    assert.equal((await request(undefined,{token:currentToken})).status,503);
    assert.equal((await request({...draft,operationId:crypto.randomUUID()},{token:currentToken})).status,503);
    const backup=await request(undefined,{token:currentToken,bindings:{...env,OWNER_CLEAN_PRODUCTS_ENABLED:'false'}});
    assert.deepEqual((await backup.json()).data.map(row=>row.productId),['PRD-009000']);
  }finally{await close();}
});


test('the clean-shop receipt migration rolls back when a historical catalog already exists',async()=>{
  const {SHOP_A_DB,close}=await startCleanShopHarness({installProductReceipts:false});
  try{
    await SHOP_A_DB.prepare(`INSERT INTO legacy_product_snapshots
      (source_profile,legacy_sheet_row,product_id,product_name) VALUES ('canonical',2,'PRD-001000','Archived product')`).run();
    const migration=await readFile('staging-migrations/shop-owner-write/0003_owner_product_create_receipts.sql','utf8');
    await assert.rejects(SHOP_A_DB.batch(migration.split('-- next statement').map(sql=>SHOP_A_DB.prepare(sql.trim()))),/CHECK/);
    assert.equal(await SHOP_A_DB.prepare("SELECT name FROM sqlite_master WHERE name='owner_product_create_receipts'").first(),null);
    assert.equal((await SHOP_A_DB.prepare('SELECT product_id FROM legacy_product_snapshots').first()).product_id,'PRD-001000');
  }finally{await close();}
});

test('a live Owner must have a Shop SQL-time lease; old enabled grants cannot post after expiry',async()=>{
  const {worker,ownerA,ownerB,SHOP_A_DB,SHOP_B_DB,close}=await startCleanShopHarness();
  try{
    const active=await SHOP_A_DB.prepare('SELECT expires_at_ms AS expiresAtMs,enabled FROM shop_owner_write_grant').first();
    assert.equal(active.enabled,1);
    assert.ok(Number.isSafeInteger(active.expiresAtMs)&&active.expiresAtMs>Date.now(),
      'a current Control session must grant only a bounded Shop write lease');
    const second=await SHOP_B_DB.prepare('SELECT expires_at_ms AS expiresAtMs FROM shop_owner_write_grant').first();
    assert.ok(second.expiresAtMs>Date.now(),'other Shop has its own lease');
    const draft=(name)=>({operationId:crypto.randomUUID(),name,unit:'pcs',
      purchasePrice:'5.00',sellingPrice:'8.00'});
    const post=(shop,token,input)=>worker.fetch('https://'+shop+'.example.test/__clean_shop__/products',{
      method:'POST',headers:{Origin:'https://'+shop+'.example.test',
        'Content-Type':'application/json',Cookie:'__Host-shererp-owner-session='+token},
      body:JSON.stringify(input),
    });
    assert.equal((await post('a',ownerA.token,draft('Before lease expiry'))).status,201);
    // Simulate the passage of server time by shortening only this Shop lease.
    // An active Control cookie must not silently re-authorize Shop SQL writes.
    await SHOP_A_DB.prepare('UPDATE shop_owner_write_grant SET expires_at_ms=? WHERE singleton=1')
      .bind(Date.now()-1000).run();
    assert.equal((await validateOwnerSession(ownerA.env,ownerA.token)).role,'Owner');
    assert.equal((await post('a',ownerA.token,draft('After lease expiry'))).status,409);
    assert.equal(await publishCurrentOwnerWriteSession(ownerA.env,ownerA.token),false,
      'publishing the same session may not extend an expired lease');
    assert.equal((await SHOP_A_DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n,1);
    assert.equal((await post('b',ownerB.token,draft('Independent Shop still works'))).status,201);
  }finally{await close();}
});
