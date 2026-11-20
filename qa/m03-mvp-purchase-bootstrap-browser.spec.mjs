import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {unstable_splitSqlQuery} from 'wrangler';
import {startCleanShopHarness} from '../tests/fixtures/m03-clean-shop-harness.mjs';
import {pilotShopConfiguration} from '../src/auth/platform-shop-binding.js';
import {createOwnerProduct} from '../src/db/m03-owner-product-create.js';
import {createOwnerSupplier} from '../src/db/m03-owner-supplier-create.js';
import ownerWorker from '../src/m03-owner-redemption-worker.js';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

const origin='https://purchase-mvp.example.test';
const cookie='__Host-shererp-owner-session';
async function apply(db,path){
  const ddl=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(ddl).map(s=>db.prepare(s)));
}

test('original Purchase UI loads current Shop D1 Product/Supplier and blocks unreviewed financial submit',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shererp-purchase-mvp-ui-'));
  let harness,browser;
  try{
    harness=await startCleanShopHarness();
    const {ownerA,SHOP_A_DB:a,SHOP_B_DB:b}=harness;
    for(const db of [a,b]){
      await apply(db,'migrations/0002_party_identity.sql');
      await apply(db,'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql');
    }
    const p=await createOwnerProduct(pilotShopConfiguration(ownerA.env),{
      token:ownerA.token,ownerSubject:'fixture-owner',
      input:{operationId:crypto.randomUUID(),name:'Fixture Copper Cable',
        brand:'Fixture',category:'Electrical',unit:'pcs',barcode:'',
        purchasePrice:'8.25',sellingPrice:'12.50',stock:'0',minStock:'0',
        productType:'Standard',components:[]},
    });
    assert.equal(p.status,'created');
    const s=await createOwnerSupplier(pilotShopConfiguration(ownerA.env),{
      token:ownerA.token,ownerSubject:'fixture-owner',
      input:{operationId:crypto.randomUUID(),name:'MVP Supplier',phone:'01711111111',
        address:'',notes:'',openingBalance:'0'},
    });
    assert.equal(s.status,'created');
    await buildOwnerFrontend({outputDir:dir});
    const calls=[];
    const env={...ownerA.env,OWNER_LOGIN_ENABLED:'true',OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
      OWNER_CLEAN_PRODUCTS_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
      OWNER_PURCHASE_READ_ENABLED:'true',
      OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
      PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',
      OWNER_INGRESS:{limit:async()=>({success:true})},
      ASSETS:{async fetch(request){
        const path=resolve(dir,'.'+new URL(request.url).pathname);
        if(!path.startsWith(dir+sep))return new Response(null,{status:404});
        return readFile(path).then(bytes=>new Response(bytes),()=>new Response(null,{status:404}));
      }},
    };
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1280,height:900}});
    await context.addCookies([{name:cookie,value:ownerA.token,url:origin,
      secure:true,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();
    page.setDefaultTimeout(9000);
    page.on('pageerror',e=>{calls.push('JS_ERROR '+e.message);});
    await page.route('**/*',async route=>{
      const request=route.request();
      const url=new URL(request.url());
      if(url.origin!==origin)return route.abort();
      const headers=await request.allHeaders();
      const body=request.postData();
      const response=await ownerWorker.fetch(new Request(request.url(),{
        method:request.method(),headers,...(body?{body}:{})
      }),env);
      calls.push(request.method()+' '+url.pathname+' '+response.status);
      return route.fulfill({status:response.status,
        headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
    await page.goto(origin+'/app',{waitUntil:'domcontentloaded'});
    await page.locator('#navList .nav-item[aria-label="Purchases"]').click();
    await page.waitForFunction(()=>typeof purState!=='undefined'&&
      purState.products?.some(p=>p.name==='Fixture Copper Cable')&&
      purState.suppliers?.some(s=>s.name==='MVP Supplier'));
    const current=await page.evaluate(()=>({
      products:purState.products.map(({id,name,stock})=>({id,name,stock})),
      suppliers:purState.suppliers.map(({id,name,currentDue})=>({id,name,currentDue})),
      banks:purState.bankAccounts,
      history:purState.history,
    }));
    assert.deepEqual(current,{
      products:[{id:'PRD-000001',name:'Fixture Copper Cable',stock:0}],
      suppliers:[{id:'SUP-000001',name:'MVP Supplier',currentDue:0}],
      banks:[],history:[],
    });
    assert.equal(calls.some(c=>c.includes('/api/owner/purchases/bootstrap 200')),true);
    const blocked=await page.evaluate(async()=>{
      try{await serverCall('createPurchase','',{
        supplierId:'SUP-000001',items:[{productId:'PRD-000001',qty:1}],paidAmount:0,
      });return 'unexpected-success';}catch(e){return e.message;}
    });
    assert.match(blocked,/not connected/i);
    assert.equal(calls.some(c=>c.startsWith('POST /api/owner/purchases')),false);
    assert.equal((await a.prepare('SELECT COUNT(*) AS n FROM products').first()).n,1);
    assert.equal((await b.prepare('SELECT COUNT(*) AS n FROM products').first()).n,0);
    assert.equal(calls.filter(s=>s.startsWith('JS_ERROR')).length,0);
  }finally{
    try{await browser?.close();}finally{
      try{await harness?.close();}finally{await rm(dir,{recursive:true,force:true});}
    }
  }
});
