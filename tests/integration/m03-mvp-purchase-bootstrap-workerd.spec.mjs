/**
 * M03 MVP: authenticated original Purchase read bootstrap over actual local
 * two-Shop Workerd/D1. There is NO purchase posting route in this PR.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../../src/auth/platform-shop-binding.js';
import {createOwnerProduct} from '../../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../../src/db/m03-owner-supplier-create.js';
import {
  readMvpOwnerPurchaseBootstrap,
  readMvpOwnerEmptyPurchaseHistory,
} from '../../src/db/m03-owner-purchase-bootstrap.js';
import ownerWorker from '../../src/m03-owner-redemption-worker.js';

const origin='https://owner.example.test';
async function applySupplier(db){
  for(const path of ['migrations/0002_party_identity.sql',
    'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql']){
    const sql=await readFile(path,'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
  }
}
const product=(name)=>({
  operationId:crypto.randomUUID(),name,brand:'Fixture',category:'Electrical',unit:'pcs',
  barcode:'',purchasePrice:'8.25',sellingPrice:'12.50',stock:'0',minStock:'0',
  productType:'Standard',components:[],
});
const supplier=(name)=>({
  operationId:crypto.randomUUID(),name,phone:'01711111111',address:'',notes:'',openingBalance:'0',
});
async function saveProduct(owner,input){
  return createOwnerProduct(pilotShopConfiguration(owner.env),{
    token:owner.token,ownerSubject:'fixture-owner',input,
  });
}
async function saveSupplier(owner,input){
  return createOwnerSupplier(pilotShopConfiguration(owner.env),{
    token:owner.token,ownerSubject:'fixture-owner',input,
  });
}
function bindings(owner){
  return {...owner.env,OWNER_LOGIN_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
    OWNER_CLEAN_PRODUCTS_ENABLED:'true',OWNER_PURCHASE_READ_ENABLED:'true',
    OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
    PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',
    OWNER_INGRESS:{limit:async()=>({success:true})},
  };
}
const request=(path,token,env)=>ownerWorker.request(origin+path,{
  headers:token?{Cookie:'__Host-shererp-owner-session='+token}:{},
},env);

test('clean Shop D1 Purchase bootstrap maps immutable current Product/Supplier source IDs, with no invented stock or banks',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,SHOP_B_DB:b,close}=await startCleanShopHarness();
  try{
    await applySupplier(a);await applySupplier(b);
    assert.equal((await saveProduct(ownerA,product('Cable 1.5mm'))).status,'created');
    assert.equal((await saveSupplier(ownerA,supplier('Fixture Supplier'))).status,'created');
    assert.equal((await saveProduct(ownerB,product('Other Shop Product'))).status,'created');
    const result=await readMvpOwnerPurchaseBootstrap(pilotShopConfiguration(ownerA.env));
    assert.deepEqual(result,{
      products:[{id:'PRD-000001',name:'Cable 1.5mm',brand:'Fixture',category:'Electrical',
        unit:'pcs',barcode:'',stock:0,purchasePrice:'8.25',sellingPrice:'12.50'}],
      suppliers:[{id:'SUP-000001',name:'Fixture Supplier',phone:'01711111111',currentDue:0}],
      categories:[],bankAccounts:[],currencySymbol:'',
    });
    assert.deepEqual(await readMvpOwnerEmptyPurchaseHistory(pilotShopConfiguration(ownerA.env)),[]);
    const other=await readMvpOwnerPurchaseBootstrap(pilotShopConfiguration(ownerB.env));
    assert.deepEqual(other.products.map(x=>x.name),['Other Shop Product']);
    assert.deepEqual(other.suppliers,[]);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM products').first()).n,1);
    assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM products').first()).n,1);
  }finally{await close();}
});

test('Owner-only private Purchase read enforces current cookie, exact Shop binding, opt-in flag and absent financial writers',async()=>{
  const {ownerA,ownerB,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await applySupplier(a);
    assert.equal((await saveProduct(ownerA,product('Shop-A stock zero'))).status,'created');
    const env=bindings(ownerA);
    const path='/api/owner/purchases/bootstrap';
    assert.equal((await request(path,null,env)).status,401);
    assert.equal((await request(path,ownerB.token,env)).status,401);
    assert.equal((await request(path,ownerA.token,{...env,OWNER_PURCHASE_READ_ENABLED:'false'})).status,404);
    assert.equal((await request(path,ownerA.token,{...env,PLATFORM_PILOT_MARKER:crypto.randomUUID()})).status,401);
    assert.equal((await request(path,ownerA.token,env)).status,200);
    const response=await request(path,ownerA.token,env);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual((await response.json()).products.map(x=>x.name),['Shop-A stock zero']);
    const history=await request('/api/owner/purchases/history',ownerA.token,env);
    assert.equal(history.status,200);
    assert.deepEqual(await history.json(),[]);
    const noPost=await ownerWorker.request(origin+'/api/owner/purchases',{
      method:'POST',headers:{Origin:origin,Cookie:'__Host-shererp-owner-session='+ownerA.token,
        'Content-Type':'application/json'},
      body:JSON.stringify({supplierId:'SUP-000001',paidAmount:0}),
    },env);
    assert.equal(noPost.status,404,'Purchase mutation remains unregistered');
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM owner_product_create_receipts').first()).n,1);
  }finally{await close();}
});

test('uninitialized Supplier master, legacy Product snapshot, or missing Shop identity refuses purchase UI data',async()=>{
  const {ownerA,SHOP_A_DB:a,close}=await startCleanShopHarness();
  try{
    await assert.rejects(readMvpOwnerPurchaseBootstrap(pilotShopConfiguration(ownerA.env)),
      /unavailable|incomplete|source/i);
    await applySupplier(a);
    const legacyRow=await a.prepare(`INSERT INTO legacy_product_snapshots(
      source_profile,legacy_sheet_row,product_id,product_name,current_stock_text)
      VALUES('canonical',2,'LEGACY-1','Imported item','100')`).run();
    assert.equal(legacyRow.success,true);
    await assert.rejects(readMvpOwnerPurchaseBootstrap(pilotShopConfiguration(ownerA.env)),
      /unavailable|incomplete|source/i);
    await a.prepare('DELETE FROM legacy_product_snapshots').run();
    await a.prepare('UPDATE shop_identity SET database_marker=? WHERE singleton=1')
      .bind(crypto.randomUUID()).run();
    const response=await request('/api/owner/purchases/bootstrap',ownerA.token,bindings(ownerA));
    assert.notEqual(response.status,200);
  }finally{await close();}
});
