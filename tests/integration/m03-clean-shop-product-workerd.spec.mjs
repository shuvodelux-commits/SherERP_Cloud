import assert from 'node:assert/strict';
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
