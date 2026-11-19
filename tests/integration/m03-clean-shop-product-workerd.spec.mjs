import assert from 'node:assert/strict';
import {test} from 'node:test';
import {revokeOwnerSession} from '../../src/auth/platform-owner-sessions.js';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';

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
    assert.equal(await revokeOwnerSession(ownerA.env,ownerA.token),true);
    assert.equal((await request('a',ownerA.token,{...draft,operationId:crypto.randomUUID()})).status,401);
    assert.equal((await SHOP_A_DB.prepare('SELECT count(*) AS n FROM products').first()).n,1);
  }finally{
    await close();
  }
});
