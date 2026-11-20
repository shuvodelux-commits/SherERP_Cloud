/**
 * M01 stacked acceptance proof: compiled Owner Party UI + actual M03 Worker
 * authorization + two disposable local Workerd/D1 Shops.
 *
 * Browser runs against an HTTP bridge because the Worker requires a private
 * HTTPS origin; that bridge injects a TEST Owner session cookie. This is not
 * hosted Cloudflare, live Google sign-in, production D1 or release approval.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {unstable_splitSqlQuery} from 'wrangler';
import ownerWorker from '../src/m03-owner-redemption-worker.js';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';
import {startCleanShopHarness} from '../tests/fixtures/m03-clean-shop-harness.mjs';
import {sourceSupplierCreatePayload} from '../src/ui/hisabiq/party-workspace.mjs';

const origin='https://owner.example.test';
const savePicture='docs/reviews/m01-party-real-d1-e2e/images';
const getCount=async db=>(await db.prepare(
  'SELECT count(*) AS n FROM owner_supplier_master'
).first()).n;

async function migrate(db,path){
  const sql=await readFile(path,'utf8');
  await db.batch(unstable_splitSqlQuery(sql).map(statement=>db.prepare(statement)));
}
async function ready(db){
  await migrate(db,'migrations/0002_party_identity.sql');
  await migrate(db,'staging-migrations/shop-owner-write/0005_owner_supplier_master.sql');
}

test('compiled responsive Owner Party creates real Shop D1 Supplier, persists on reload, isolates another Shop and replays exactly once',{timeout:180000,concurrency:false},async t=>{
  const harness=await startCleanShopHarness();
  t.after(()=>harness.close());
  await ready(harness.SHOP_A_DB);
  await ready(harness.SHOP_B_DB);
  const ownerA=harness.ownerA,ownerB=harness.ownerB;
  const bind=owner=>({
    ...owner.env,
    OWNER_LOGIN_ENABLED:'true',
    OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',
    OWNER_CLEAN_PRODUCTS_ENABLED:'true',
    OWNER_AUTH_ORIGIN:origin,
    PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
    PLATFORM_OWNER_CLIENT_ID:'fixture.apps.googleusercontent.com',
    OWNER_INGRESS:{limit:async()=>({success:true})}
  });
  const ownerEnv=bind(ownerA);
  const requests=[];
  async function realApi(path,{method='GET',body,token=ownerA.token,env=ownerEnv}={}){
    const headers={Cookie:'__Host-shererp-owner-session='+token};
    if(method==='POST'){
      headers.Origin=origin;
      headers['Content-Type']='application/json';
    }
    return ownerWorker.request(origin+path,{method,headers,
      ...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})
    },env);
  }

  const outputDir=await mkdtemp(join(tmpdir(),'shererp-m01-real-d1-browser-'));
  t.after(()=>rm(outputDir,{recursive:true,force:true}));
  await buildOwnerFrontend({outputDir});
  const server=createServer((req,res)=>{
    void (async()=>{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname.startsWith('/api/owner/')){
        const chunks=[];
        for await(const piece of req)chunks.push(piece);
        const body=Buffer.concat(chunks).toString('utf8');
        if(req.method==='POST')requests.push({path:pathname,body});
        const upstream=await realApi(pathname,{method:req.method,body:body||undefined});
        res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('Content-Type')||'application/json','Cache-Control':'no-store'});
        res.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      const filePath=resolve(outputDir,'.'+(pathname==='/app'?'/owner-erp.html':pathname));
      if(!filePath.startsWith(resolve(outputDir)+'/')){
        res.writeHead(404);res.end();return;
      }
      try{
        const file=await readFile(filePath);
        const ext=extname(filePath);
        res.writeHead(200,{'Content-Type':ext==='.html'?'text/html; charset=utf-8':
          ext==='.css'?'text/css; charset=utf-8':
          ext==='.js'||ext==='.mjs'?'text/javascript; charset=utf-8':
          'application/octet-stream'});
        res.end(file);
      }catch{res.writeHead(404);res.end('Not found');}
    })().catch(e=>{
      if(!res.headersSent)res.writeHead(500);
      res.end('Test bridge failure');
    });
  });
  await new Promise((done,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',done);
  });
  t.after(()=>new Promise(done=>server.close(done)));
  const local='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  t.after(()=>browser.close());
  await mkdir(savePicture,{recursive:true});

  assert.equal(await getCount(harness.SHOP_A_DB),0);
  assert.equal(await getCount(harness.SHOP_B_DB),0);
  const page=await browser.newPage({viewport:{width:390,height:844}});
  t.after(()=>page.close());
  await page.route(/^https:\/\/fonts\./,route=>route.abort());
  await page.goto(local+'/app',{waitUntil:'domcontentloaded'});
  await page.locator('#mobileBottomNav [data-mobile-page="more"]').click();
  await page.locator('#mobileMoreList [data-mobile-target="hisabiqParties"]').click();
  await page.locator('#hparty-source-mode').getByText('Supplier-only D1 source view').waitFor();
  assert.equal(await page.locator('#hparty-add-party').isEnabled(),true);
  assert.equal(await page.locator('#hparty-list [role="option"]').count(),0);
  await page.locator('#hparty-add-party').click();
  await page.locator('#hparty-supplier-modal').waitFor({state:'visible'});
  await page.locator('#hparty-supplier-name').fill('Fixture Supplier Real D1');
  await page.locator('#hparty-supplier-phone').fill('01712345678');
  await page.locator('#hparty-supplier-address').fill('Rajshahi');
  await page.locator('#hparty-supplier-save').click();
  await page.locator('#hparty-detail h2').getByText('Fixture Supplier Real D1').waitFor();
  assert.equal(await getCount(harness.SHOP_A_DB),1);
  assert.equal(await getCount(harness.SHOP_B_DB),0);
  assert.match(await page.locator('#hparty-detail').innerText(),/Supplier/);
  assert.match(await page.locator('#hparty-detail').innerText(),/0\.00/);
  const posts=requests.filter(x=>x.path==='/api/owner/suppliers');
  assert.equal(posts.length,1,'UI submits one authoritative Supplier mutation');
  const intent=JSON.parse(posts[0].body);
  assert.equal(intent.openingBalance,'0');
  assert.equal(intent.name,'Fixture Supplier Real D1');
  assert.match(intent.operationId,/^[a-f0-9-]{36}$/);
  await page.screenshot({path:savePicture+'/390-created-real-d1.png',fullPage:true});

  const replay=await realApi('/api/owner/suppliers',{method:'POST',body:posts[0].body});
  assert.equal(replay.status,200,'replay of the exact UI operation');
  assert.equal(await getCount(harness.SHOP_A_DB),1,'no duplicate posting');
  const changed=await realApi('/api/owner/suppliers',{
    method:'POST',body:{...intent,name:'Changed after posting'}
  });
  assert.equal(changed.status,409,'same ID with different intent rejected');
  assert.equal(await getCount(harness.SHOP_A_DB),1);
  const denied=await realApi('/api/owner/suppliers',{
    token:ownerB.token,env:ownerEnv
  });
  assert.equal(denied.status,401,'other Shop session cannot read Shop A');
  const deniedWrite=await realApi('/api/owner/suppliers',{
    method:'POST',body:posts[0].body,token:ownerB.token,env:ownerEnv
  });
  assert.equal(deniedWrite.status,401,'other Shop session cannot post into Shop A');
  const unsupportedOpening=await realApi('/api/owner/suppliers',{
    method:'POST',
    body:{...intent,operationId:crypto.randomUUID(),name:'Historical supplier',openingBalance:'-125.00'}
  });
  assert.equal(unsupportedOpening.status,400,'negative historical opening is not silently posted');
  assert.equal(await getCount(harness.SHOP_A_DB),1);
  const separateShop=await realApi('/api/owner/suppliers',{
    method:'POST',token:ownerB.token,env:bind(ownerB),
    body:sourceSupplierCreatePayload({name:'Fixture Supplier Real D1'},crypto.randomUUID())
  });
  assert.equal(separateShop.status,201,'same Supplier name is independent across Shops');
  assert.equal(await getCount(harness.SHOP_B_DB),1);

  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#mobileBottomNav [data-mobile-page="more"]').click();
  await page.locator('#mobileMoreList [data-mobile-target="hisabiqParties"]').click();
  await page.locator('#hparty-detail h2').getByText('Fixture Supplier Real D1').waitFor();
  assert.equal(await page.locator('#hparty-detail .hparty-badge').count(),1);
  assert.equal(await getCount(harness.SHOP_A_DB),1);

  const desktop=await browser.newPage({viewport:{width:1440,height:900}});
  t.after(()=>desktop.close());
  await desktop.route(/^https:\/\/fonts\./,route=>route.abort());
  await desktop.goto(local+'/app',{waitUntil:'domcontentloaded'});
  await desktop.locator('#navList [data-page="hisabiqParties"]').click();
  await desktop.locator('#hparty-detail h2').getByText('Fixture Supplier Real D1').waitFor();
  assert.equal(await desktop.locator('.hparty-directory').isVisible(),true);
  await desktop.screenshot({path:savePicture+'/1440-created-real-d1.png',fullPage:true});
  const row=(await harness.SHOP_A_DB.prepare(
    'SELECT supplier_id,current_due_paisa,opening_paisa FROM owner_supplier_master'
  ).first());
  assert.equal(row.supplier_id,'SUP-000001');
  assert.equal(row.current_due_paisa,0);
  assert.equal(row.opening_paisa,0);
  assert.equal(await getCount(harness.SHOP_B_DB),1,'Shop B retains its own independent Supplier');
});
